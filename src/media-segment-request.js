import videojs from 'video.js';
import { createTransferableMessage } from './bin-utils';

export const REQUEST_ERRORS = {
  ABORTED: -101,
  TIMEOUT: -102,
  FAILURE: 2
};

/**
 * Turns segment byterange into a string suitable for use in
 * HTTP Range requests
 *
 * @param {Object} byterange - an object with two values defining the start and end
 *                             of a byte-range
 */
const byterangeStr = function(byterange) {
  let byterangeStart;
  let byterangeEnd;

  // `byterangeEnd` is one less than `offset + length` because the HTTP range
  // header uses inclusive ranges
  byterangeEnd = byterange.offset + byterange.length - 1;
  byterangeStart = byterange.offset;
  return 'bytes=' + byterangeStart + '-' + byterangeEnd;
};

/**
 * Defines headers for use in the xhr request for a particular segment.
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object from SegmentLoader
 */
const segmentXhrHeaders = function(segment) {
  let headers = {};

  if (segment.byterange) {
    headers.Range = byterangeStr(segment.byterange);
  }
  return headers;
};

/**
 * Abort all requests that have not already returned data
 *
 * @param {Object} activeXhrs - an object that tracks all XHR requests
 */
const abortAll = (activeXhrs) => {
  activeXhrs.forEach((xhr) => {
    // only abort xhrs that haven't had a response
    if (!xhr.responseTime) {
      // set an aborted property so that we can correctly
      // track the request and not treat it as an error
      xhr.aborted = true;
      xhr.abort();
    }
  });
};

/**
 * Gather important bandwidth stats once a request has completed
 *
 * @param {Object} request - the XHR request from which to gather stats
 */
const getRequestStats = (request) => {
  return {
    bandwidth: request.bandwidth,
    bytesReceived: request.bytesReceived || 0,
    roundTripTime: request.roundTripTime || 0
  };
};

/**
 * If possible gather bandwidth stats as a request is in
 * progress
 *
 * @param {Event} progressEvent - an event object from an XHR's progress event
 */
const getProgressStats = (progressEvent) => {
  const request = progressEvent.target;
  const roundTripTime = Date.now() - request.requestTime;
  const stats = {
    bandwidth: Infinity,
    bytesReceived: 0,
    roundTripTime: roundTripTime || 0
  };

  if (progressEvent.lengthComputable) {
    stats.bytesReceived = progressEvent.loaded;
    // This can result in Infinity if stats.roundTripTime is 0 but that is ok
    // because we should only use bandwidth stats on progress to determine when
    // abort a request early due to insufficient bandwidth
    stats.bandwidth = Math.floor((stats.bytesReceived / stats.roundTripTime) * 8 * 1000);
  }
  return stats;
};

/**
 * Handle all error conditions in one place and return an object
 * with all the information
 *
 * @param {Error|null} error - if non-null signals an error occured with the XHR
 * @param {Object} request -  the XHR request that possibly generated the error
 */
const handleErrors = (error, request) => {
  const response = request.response;

  if (!request.aborted && error) {
    return {
      status: request.status,
      message: 'HLS request errored at URL: ' + request.uri,
      code: REQUEST_ERRORS.FAILURE,
      xhr: request
    };
  }

  if (request.timedout) {
    return {
      status: request.status,
      message: 'HLS request timed-out at URL: ' + request.uri,
      code: REQUEST_ERRORS.TIMEOUT,
      xhr: request
    };
  }

  if (!response) {
    return {
      status: request.status,
      message: 'HLS request aborted at URL: ' + request.uri,
      code: REQUEST_ERRORS.ABORTED,
      xhr: request
    };
  }

  return null;
};

/**
 * Handle responses for key data and convert the key data to the correct format
 * for the decryption step later
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object from SegmentLoader
 * @param {Function} finishProcessingFn - a callback to execute to continue processing
 *                                        this request
 */
const handleKeyResponse = (segment, finishProcessingFn) => (error, request) => {
  const response = request.response;
  const errorObj = handleErrors(error, request);

  if (errorObj) {
    return finishProcessingFn(errorObj, segment);
  }

  if (response.byteLength !== 16) {
    return finishProcessingFn({
      status: request.status,
      message: 'Invalid HLS key at URL: ' + request.uri,
      code: REQUEST_ERRORS.FAILURE,
      xhr: request
    }, segment);
  }

  const view = new DataView(response);

  segment.key.bytes = new Uint32Array([
    view.getUint32(0),
    view.getUint32(4),
    view.getUint32(8),
    view.getUint32(12)
  ]);
  return finishProcessingFn(null, segment);
};

/**
 * Handle init-segment responses
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object from SegmentLoader
 * @param {Function} finishProcessingFn - a callback to execute to continue processing
 *                                        this request
 */
const handleInitSegmentResponse = (segment, finishProcessingFn) => (error, request) => {
  const errorObj = handleErrors(error, request);

  if (errorObj) {
    return finishProcessingFn(errorObj, segment);
  }
  segment.map.bytes = new Uint8Array(request.response);
  return finishProcessingFn(null, segment);
};

/**
 * Response handler for segment-requests being sure to set the correct
 * property depending on whether the segment is encryped or not
 * Also records and keeps track of stats that are used for ABR purposes
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object from SegmentLoader
 * @param {Function} finishProcessingFn - a callback to execute to continue processing
 *                                        this request
 */
const handleSegmentResponse = (segment, finishProcessingFn) => (error, request) => {
  const errorObj = handleErrors(error, request);

  if (errorObj) {
    return finishProcessingFn(errorObj, segment);
  }
  segment.stats = getRequestStats(request);

  if (segment.key) {
    segment.encryptedBytes = new Uint8Array(request.response);
  } else {
    segment.bytes = new Uint8Array(request.response);
  }

  return finishProcessingFn(null, segment);
};

/**
 * Decrypt the segment via the decryption web worker
 *
 * @param {WebWorker} decrypter - a WebWorker interface to AES-128 decryption routines
 * @param {Object} segment - a simplified copy of the segmentInfo object from SegmentLoader
 * @param {Function} doneFn - a callback that is executed after decryption has completed
 */
const decryptSegment = (decrypter, segment, doneFn) => {
  const decryptionId = 'segment-request-' + Math.random().toString(36);
  const decryptionHandler = (event) => {
    if (event.data.source === decryptionId) {
      decrypter.removeEventListener('message', decryptionHandler);
      const decrypted = event.data.decrypted;

      segment.bytes = new Uint8Array(decrypted.bytes,
                                     decrypted.byteOffset,
                                     decrypted.byteLength);
      return doneFn(null, segment);
    }
  };

  decrypter.addEventListener('message', decryptionHandler);

  // this is an encrypted segment
  // incrementally decrypt the segment
  decrypter.postMessage(createTransferableMessage({
    source: decryptionId,
    encrypted: segment.encryptedBytes,
    key: segment.key.bytes,
    iv: segment.key.iv
  }), [
    segment.encryptedBytes.buffer,
    segment.key.bytes.buffer
  ]);
};

/**
 * This function waits for all XHRs to finish (with either success or failure)
 * before continueing processing via it's callback. The function gathers errors
 * from each request into a single errors array so that the error status for
 * each request can be examined later.
 *
 * @param {Object} activeXhrs - an object that tracks all XHR requests
 * @param {WebWorker} decrypter - a WebWorker interface to AES-128 decryption routines
 * @param {Function} doneFn - a callback that is executed after all resources have been
 *                            downloaded and any decryption completed
 */
const waitForCompletion = (activeXhrs, decrypter, doneFn) => {
  let errors = [];
  let count = 0;

  return (error, segment) => {
    // errors have to be unshifted to make sure the original error - the one
    // that resulted in several aborts - ends up at the start of the array for
    // ease of use downstream
    if (error) {
      // If there are errors, we have to abort any outstanding requests
      abortAll(activeXhrs);
      errors.unshift(error);
    }
    count += 1;

    if (count === activeXhrs.length) {
      // Keep track of when *all* of the requests have completed
      segment.endOfAllRequests = Date.now();

      if (errors.length > 0) {
        return doneFn(errors, segment);
      }
      if (segment.encryptedBytes) {
        return decryptSegment(decrypter, segment, doneFn);
      }
      // Otherwise, everything is ready just continue
      return doneFn(null, segment);
    }
  };
};

/**
 * Simple progress event callback handler that gathers some stats before
 * executing a provided callback with the `segment` object
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object from SegmentLoader
 * @param {Function} progressFn - a callback that is executed each time a progress event is received
 * @param {Event} event - the progress event object from XMLHttpRequest
 */
const handleProgress = (segment, progressFn) => (event) => {
  segment.stats = getProgressStats(event);
  return progressFn(event, segment);
};

/**
 * Load all resources and does any processing necessary for a media-segment
 *
 * Features:
 *   decrypts the media-segment if it has a key uri and an iv
 *   aborts *all* requests if *any* one request fails
 *
 * The segment object, at minimum, has the following format:
 * {
 *   resolvedUri: String,
 *   [byterange]: {
 *     offset: Number,
 *     length: Number
 *   },
 *   [key]: {
 *     resolvedUri: String
 *     [byterange]: {
 *       offset: Number,
 *       length: Number
 *     },
 *     iv: {
 *       bytes: Uint32Array
 *     }
 *   },
 *   [map]: {
 *     resolvedUri: String,
 *     [byterange]: {
 *       offset: Number,
 *       length: Number
 *     },
 *     [bytes]: Uint8Array
 *   }
 * }
 * ...where [name] denotes optional properties
 *
 * @param {Function} xhr - an instance of the xhr wrapper in xhr.js
 * @param {Object} xhrOptions - the base options to provide to all xhr requests
 * @param {WebWorker} decryptionWorker - a WebWorker interface to AES-128 decryption routines
 * @param {Object} segment - a simplified copy of the segmentInfo object from SegmentLoader
 * @param {Function} progressFn - a callback that receives progress events from the main segment's xhr request
 * @param {Function} doneFn - a callback that is executed only once all requests have succeeded or failed
 * @returns {Function} a function that, when invoked, immediately aborts all outstanding requests
 */
export const mediaSegmentRequest = (xhr, xhrOptions, decryptionWorker, segment, progressFn, doneFn) => {
  const activeXhrs = [];
  const finishProcessingFn = waitForCompletion(activeXhrs, decryptionWorker, doneFn);

  // optionally, request the decryption key
  if (segment.key) {
    const keyRequestOptions = videojs.mergeOptions(xhrOptions, {
      uri: segment.key.resolvedUri,
      responseType: 'arraybuffer'
    });
    const keyRequestCallback = handleKeyResponse(segment, finishProcessingFn);
    const keyXhr = xhr(keyRequestOptions, keyRequestCallback);

    activeXhrs.push(keyXhr);
  }

  // optionally, request the associated media init segment
  if (segment.map &&
    !segment.map.bytes) {
    const initSegmentOptions = videojs.mergeOptions(xhrOptions, {
      uri: segment.map.resolvedUri,
      responseType: 'arraybuffer',
      headers: segmentXhrHeaders(segment.map)
    });
    const initSegmentRequestCallback = handleInitSegmentResponse(segment, finishProcessingFn);
    const initSegmentXhr = xhr(initSegmentOptions, initSegmentRequestCallback);

    activeXhrs.push(initSegmentXhr);
  }

  const segmentRequestOptions = videojs.mergeOptions(xhrOptions, {
    uri: segment.resolvedUri,
    responseType: 'arraybuffer',
    headers: segmentXhrHeaders(segment)
  });
  const segmentRequestCallback = handleSegmentResponse(segment, finishProcessingFn);
  const segmentXhr = xhr(segmentRequestOptions, segmentRequestCallback);

  segmentXhr.addEventListener('progress', handleProgress(segment, progressFn));
  activeXhrs.push(segmentXhr);

  return () => abortAll(activeXhrs);
};

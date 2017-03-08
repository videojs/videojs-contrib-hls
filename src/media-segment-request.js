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
 */
const segmentXhrHeaders = function(segment) {
  let headers = {};

  if (segment.byterange) {
    headers.Range = byterangeStr(segment.byterange);
  }
  return headers;
};

const aborter = (activeXhrs) => () => {
  Object.keys(activeXhrs).forEach((xhrKey) => {
    const xhr = activeXhrs[xhrKey];

    // only abort xhrs that haven't had a response
    if (!xhr.responseTime) {
      // set an aborted property so that we can correctly
      // track the request and not treat it as an error
      xhr.aborted = true;
      xhr.abort();
    }
  });
};

const getRequestStats = (request) => {
  return {
    bandwidth: request.bandwidth,
    bytesReceived: request.bytesReceived || 0,
    roundTripTime: request.roundTripTime || 0
  };
};

const getProgressStats = (progressEvent) => {
  const request = progressEvent.target;
  const roundTripTime = Date.now() - request.requestTime;
  const stats = {
    bandwidth: Infinity,
    bytesReceived: 0,
    roundTripTime: Math.max(roundTripTime, 1)
  };

  if (progressEvent.lengthComputable) {
    stats.bytesReceived = progressEvent.loaded;
    stats.bandwidth = (stats.bytesReceived / roundTripTime) * 8 * 1000;
  }
  return stats;
};

const handleErrors = (callback) => (error, request) => {
  const response = request.response;

  if (!request.aborted && error) {
    return callback({
      status: request.status,
      message: 'HLS request errored at URL: ' + request.uri,
      code: REQUEST_ERRORS.FAILURE,
      xhr: request
    }, request);
  }

  if (request.timedout) {
    return callback({
      status: request.status,
      message: 'HLS request timed-out at URL: ' + request.uri,
      code: REQUEST_ERRORS.TIMEOUT,
      xhr: request
    }, request);
  }

  if (!response) {
    return callback({
      status: request.status,
      message: 'HLS request aborted at URL: ' + request.uri,
      code: REQUEST_ERRORS.ABORTED,
      xhr: request
    }, request);
  }

  return callback(error, request);
};

const handleKeyResponse = (segment, callback) => (error, request) => {
  const response = request.response;

  if (error) {
    return callback(error, segment);
  }

  if (response.byteLength !== 16) {
    return callback({
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
  return callback(null, segment);
};

const handleInitSegmentResponse = (segment, callback) => (error, request) => {
  if (error) {
    return callback(error, segment);
  }
  segment.map.bytes = new Uint8Array(request.response);

  if (!Array.isArray(segment.bandwidth)) {
    segment.bandwidth = [request.bandwidth];
  } else {
    segment.bandwidth.push(request.bandwidth);
  }

  return callback(null, segment);
};

const handleSegmentResponse = (segment, callback) => (error, request) => {
  if (error) {
    return callback(error, segment);
  }
  segment.stats = getRequestStats(request);

  if (segment.key) {
    segment.encryptedBytes = new Uint8Array(request.response);
  } else {
    segment.bytes = new Uint8Array(request.response);
  }

  return callback(null, segment);
};

const maybeAbortAll = (abortAll, callback) => (error, segment) => {
  if (error) {
    abortAll();
  }
  return callback(error, segment);
};

const waitForCompletion = (abortAll, callback) => {
  let errors = [];
  let count = 0;

  return (error, segment) => {
    // errors have to be unshifted to make sure the original error - the one
    // that resulted in several aborts - ends up at the start of the array for
    // ease of use downstream
    if (error) {
      errors.unshift(error);
    }
    count += 1;

    if (count === Object.keys(abortAll).length) {
      if (errors.length > 0) {
        return callback(errors, segment);
      }
      return callback(null, segment);
    }
  };
};

const maybeDecrypt = (decrypter, callback) => (error, segment) => {
  if (error) {
    return callback(error, segment);
  }

  // Keep track of when all of the requests have completed
  segment.endOfAllRequests = Date.now();

  // If the segment is not encrypted, just continue
  if (!segment.encryptedBytes) {
    return callback(error, segment);
  }

  const decryptionId = 'segment-request-' + Math.random().toString(36);
  const decryptionHandler = (event) => {
    if (event.data.source === decryptionId) {
      decrypter.removeEventListener('message', decryptionHandler);
      const decrypted = event.data.decrypted;

      segment.bytes = new Uint8Array(decrypted.bytes,
                                     decrypted.byteOffset,
                                     decrypted.byteLength);
      return callback(error, segment);
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

const handleProgress = (segment, callback) => (event) => {
  segment.stats = getProgressStats(event);
  return callback(event, segment);
};

/**
 * load a specific segment from a request into the buffer
 *
 * @private
 */
export const mediaSegmentRequest = (xhr, xhrOptions, decryptionWorker, segment, progressFn, nextFn) => {
  const activeXhrs = {};
  const abortAll = aborter(activeXhrs);
  const processSegmentCallback = waitForCompletion(activeXhrs,
    maybeDecrypt(decryptionWorker, nextFn));

  // optionally, request the decryption key
  if (segment.key) {
    const keyRequestOptions = videojs.mergeOptions(xhrOptions, {
      uri: segment.key.resolvedUri,
      responseType: 'arraybuffer'
    });

    activeXhrs.keyXhr = xhr(keyRequestOptions,
      handleErrors(handleKeyResponse(segment,
        maybeAbortAll(abortAll, processSegmentCallback))));
  }

  // optionally, request the associated media init segment
  if (segment.map &&
    !segment.map.bytes) {
    const initSegmentOptions = videojs.mergeOptions(xhrOptions, {
      uri: segment.map.resolvedUri,
      responseType: 'arraybuffer',
      headers: segmentXhrHeaders(segment.map)
    });

    activeXhrs.initSegmentXhr = xhr(initSegmentOptions,
      handleErrors(handleInitSegmentResponse(segment,
        maybeAbortAll(abortAll, processSegmentCallback))));
  }

  const segmentRequestOptions = videojs.mergeOptions(xhrOptions, {
    uri: segment.resolvedUri,
    responseType: 'arraybuffer',
    headers: segmentXhrHeaders(segment)
  });

  activeXhrs.segmentXhr = xhr(segmentRequestOptions,
    handleErrors(handleSegmentResponse(segment,
      maybeAbortAll(abortAll, processSegmentCallback))));

  activeXhrs.segmentXhr.addEventListener('progress', handleProgress(segment, progressFn));

  return abortAll;
};

/**
 * @file xhr.js
 */

/**
 * A wrapper for videojs.xhr that tracks bandwidth.
 *
 * @param {Object} options options for the XHR
 * @param {Function} callback the callback to call when done
 * @return {Request} the xhr request that is going to be made
 */
import {
  xhr as videojsXHR,
  mergeOptions,
  default as videojs
} from 'video.js';

const xhrFactory = function() {
  const xhr = function XhrFunction(options, callback) {
    // Add a default timeout for all hls requests
    options = mergeOptions({
      timeout: 45e3
    }, options);

    // Allow an optional user-specified function to modify the option
    // object before we construct the xhr request
    let beforeRequest = XhrFunction.beforeRequest || videojs.Hls.xhr.beforeRequest;

    if (beforeRequest && typeof beforeRequest === 'function') {
      let newOptions = beforeRequest(options);

      if (newOptions) {
        options = newOptions;
      }
    }

    let request = videojsXHR(options, function(error, response) {
      let reqResponse = request.response;

      if (!error && reqResponse) {
        request.responseTime = Date.now();
        request.roundTripTime = request.responseTime - request.requestTime;
        request.bytesReceived = reqResponse.byteLength || reqResponse.length;
        if (!request.bandwidth) {
          request.bandwidth =
            Math.floor((request.bytesReceived / request.roundTripTime) * 8 * 1000);
        }
      }

      // videojs.xhr now uses a specific code on the error
      // object to signal that a request has timed out instead
      // of setting a boolean on the request object
      if (error && error.code === 'ETIMEDOUT') {
        request.timedout = true;
      }

      // videojs.xhr no longer considers status codes outside of 200 and 0
      // (for file uris) to be errors, but the old XHR did, so emulate that
      // behavior. Status 206 may be used in response to byterange requests.
      if (!error &&
          !request.aborted &&
          response.statusCode !== 200 &&
          response.statusCode !== 206 &&
          response.statusCode !== 0) {
        error = new Error('XHR Failed with a response of: ' +
                          (request && (reqResponse || request.responseText)));
      }

      callback(error, request);
    });
    const originalAbort = request.abort;

    request.abort = function() {
      request.aborted = true;
      return originalAbort.apply(request, arguments);
    };
    request.uri = options.uri;
    request.requestTime = Date.now();
    return request;
  };

  return xhr;
};

export default xhrFactory;

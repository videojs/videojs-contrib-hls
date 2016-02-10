/**
 * A wrapper for videojs.xhr that tracks bandwidth.
 */
import {xhr as videojsXHR, mergeOptions} from 'video.js';
const xhr = function(options, callback) {
  // Add a default timeout for all hls requests
  options = mergeOptions({
    timeout: 45e3
  }, options);

  let request = videojsXHR(options, function(error, response) {
    if (!error && request.response) {
      request.responseTime = (new Date()).getTime();
      request.roundTripTime = request.responseTime - request.requestTime;
      request.bytesReceived = request.response.byteLength || request.response.length;
      if (!request.bandwidth) {
        request.bandwidth =
          Math.floor((request.bytesReceived / request.roundTripTime) * 8 * 1000);
      }
    }

    // videojs.xhr now uses a specific code
    // on the error object to signal that a request has
    // timed out errors of setting a boolean on the request object
    if (error || request.timedout) {
      request.timedout = request.timedout || (error.code === 'ETIMEDOUT');
    } else {
      request.timedout = false;
    }

    // videojs.xhr no longer considers status codes outside of 200 and 0
    // (for file uris) to be errors, but the old XHR did, so emulate that
    // behavior. Status 206 may be used in response to byterange requests.
    if (!error &&
        response.statusCode !== 200 &&
        response.statusCode !== 206 &&
        response.statusCode !== 0) {
      error = new Error('XHR Failed with a response of: ' +
                        (request && (request.response || request.responseText)));
    }

    callback(error, request);
  });

  request.requestTime = (new Date()).getTime();
  return request;
};

export default xhr;

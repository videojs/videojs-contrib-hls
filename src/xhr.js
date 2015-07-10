(function(videojs) {
  'use strict';

  /**
   * A wrapper for videojs.xhr that tracks bandwidth.
   */
  videojs.Hls.xhr = function(options, callback) {
    var request = videojs.xhr(options, function(error, request) {
      if (request.response) {
        request.responseTime = (new Date()).getTime();
        request.roundTripTime = request.responseTime - request.requestTime;
        request.bytesReceived = request.response.byteLength || request.response.length;
        request.bandwidth = Math.floor((request.bytesReceived / request.roundTripTime) * 8 * 1000);
      }

      callback(error, request);
    });

    request.requestTime = (new Date()).getTime();
    return request;
  };
})(window.videojs);

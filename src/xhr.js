(function(videojs){
  /**
   * Creates and sends an XMLHttpRequest.
   * TODO - expose video.js core's XHR and use that instead
   *
   * @param options {string | object} if this argument is a string, it
   * is intrepreted as a URL and a simple GET request is
   * inititated. If it is an object, it should contain a `url`
   * property that indicates the URL to request and optionally a
   * `method` which is the type of HTTP request to send.
   * @param callback (optional) {function} a function to call when the
   * request completes. If the request was not successful, the first
   * argument will be falsey.
   * @return {object} the XMLHttpRequest that was initiated.
   */
   videojs.Hls.xhr = function(url, callback) {
    var
      options = {
        method: 'GET',
        timeout: 45 * 1000
      },
      request,
      abortTimeout;

    if (typeof callback !== 'function') {
      callback = function() {};
    }

    if (typeof url === 'object') {
      options = videojs.util.mergeOptions(options, url);
      url = options.url;
    }

    request = new window.XMLHttpRequest();
    request.open(options.method, url);
    request.url = url;
    request.requestTime = new Date().getTime();

    if (options.responseType) {
      request.responseType = options.responseType;
    }
    if (options.withCredentials) {
      request.withCredentials = true;
    }
    if (options.timeout) {
      abortTimeout = window.setTimeout(function() {
        if (request.readyState !== 4) {
          request.timedout = true;
          request.abort();
        }
      }, options.timeout);
    }

    request.onreadystatechange = function() {
      // wait until the request completes
      if (this.readyState !== 4) {
        return;
      }

      // clear outstanding timeouts
      window.clearTimeout(abortTimeout);

      // request timeout
      if (request.timedout) {
        return callback.call(this, 'timeout', url);
      }

      // request aborted or errored
      if (this.status >= 400 || this.status === 0) {
        return callback.call(this, true, url);
      }

      if (this.response) {
        this.responseTime = new Date().getTime();
        this.roundTripTime = this.responseTime - this.requestTime;
        this.bytesReceived = this.response.byteLength || this.response.length;
        this.bandwidth = parseInt((this.bytesReceived / this.roundTripTime) * 8 * 1000,10);
      }

      return callback.call(this, false, url);
    };
    request.send(null);
    return request;
  };

})(window.videojs);

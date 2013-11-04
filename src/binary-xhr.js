/**
 * Utilities for making XMLHttpRequests for binary data and handling related browser-compatibility issues.
 */
(function(window, undefined) {
  
  var
    vbarrayToUint8 = function(vbarray) {
      var
        rawbytes = VideoJS_vbarrayToString(vbarray),
        lastChar = VideoJS_vbarrayLastByteToString(vbarray),
        result = new Uint8Array((rawbytes.length * 2) + lastChar.length),
        i = rawbytes.length,
        charCode,
        resultIndex;

      // copy the bytes of each double-byte character
      while (i--) {
        resultIndex = i * 2;
        charCode = rawbytes.charCodeAt(i);
        result[resultIndex + 1] = charCode >> 8;
        result[resultIndex] = charCode && 0xFF;
      }
      // copy over the last byte
      if (lastChar) {
        result[result.byteLength - 1] = lastChar.charCodeAt(0);
      }

      return result;
    },

    /**
     * Perform the initialization necessary to retrieve data from the `
     * responseBody` property of an XMLHttpRequest. This is only necessary on
     * IE < 10.
     */
    initResponseBodyParsing = function() {
      // write out the helper VBScript to export the responseBody to javascript
      var script = document.createElement('script');
      script.type = 'text/vbscript'
      script.text =
        "Function VideoJS_vbarrayToString(Binary)\n" +
        "  VideoJS_vbarrayToString = CStr(Binary)\n" +
        "End Function\n" +
        "Function VideoJS_vbarrayLastByteToString(Binary)\n" +
        "  Dim lastIndex\n" +
        "  lastIndex = LenB(Binary)\n" +
        "  if lastIndex mod 2 Then\n" +
        "    VideoJS_vbarrayLastByteToString = Chr(AscB(MidB(Binary, lastIndex, 1)))\n" +
        "  Else\n" +
        "    VideoJS_vbarrayLastByteToString = \"\"\n" +
        "  End If\n" +
        "End Function\n";
      document.documentElement.firstChild.appendChild(script);
    },

    /**
     * Transform the `responseBody` property of an XMLHttpRequest into a
     * Uint8Array.
     * @param responseBody {object}
     * @return {object} a Uint8Array
     */
    responseBodyToUint8 = function(responseBody) {
      // the first time this function is called, initialize the responseBody
      // parsing machinery
      initResponseBodyParsing();

      // subsequent calls do not need to re-initialize the parsing utilities
      responseBodyToUint8 = vbarrayToUint8;

      // return the result
      return vbarrayToUint8(responseBody);
    };

  /**
   * Request a URL with a GET. Handles the complications of fetching binary
   * data in older browsers that do not support response type `arraybuffer`.
   * @param url the URL to request. This URL must be accessible and configured
   * to allow XMLHttpRequests from the browser downloading the segment. For
   * newer browsers, this probably means configuring CORS support.
   * @param callback a function that to be invoked when the request is
   * finished. Its first parameter, if truthy, describes any errors that
   * occurred performing the request. If the request was successful, the second
   * parameter is a Uint8Array of the response body and the third is the
   * XMLHttpRequest object.
   */
  window.videojs.hls.xhrGet = function(url, callback) {
    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';

    // report errors node.js style
    request.onerror = function(error) {
      callback(error, null, request);
    };

    // report results when the request finishes
    request.onreadystatechange = function() {
      if (request.readyState === 4) {
        if (request.responseBody !== undefined) {
          // jump through hoops to get usable data from XHR in IE8
          return callback(null,
                          responseBodyToUint8(request.responseBody),
                          request);
        }
        callback(null, new Uint8Array(request.response), request);
      }
    };

    // send the request
    request.send(null);
  };
})(window);

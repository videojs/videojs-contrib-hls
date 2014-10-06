(function(window, videojs, undefined) {
  'use strict';

  /*
    XHR test suite
  */

  var xhr;

  module('XHR', {
    setup: function() {
      xhr = sinon.useFakeXMLHttpRequest();
    },

    teardown: function() {
      xhr.restore();
    }
  });

  test('handles xhr timeouts correctly', function () {
    var error;
    var clock = sinon.useFakeTimers();
    videojs.Hls.xhr({
      url: 'http://example.com',
      timeout: 1
    }, function(innerError) {
      error = innerError;
    });
    clock.tick(1);
    strictEqual(error, 'timeout', 'called with timeout error');
    clock.restore();
  });

})(window, window.videojs);

(function(window, videojs, undefined) {
  'use strict';

  /*
    XHR test suite
  */

  var 
    xhr,
    player,
    oldFlashSupported,

    createPlayer = function(options) {
      var tech, video, player;
      video = document.createElement('video');
      document.querySelector('#qunit-fixture').appendChild(video);
      player = videojs(video, {
        flash: {
          swf: ''
        },
        hls: options || {}
      });

      player.buffered = function() {
        return videojs.createTimeRange(0, 0);
      };

      tech = player.el().querySelector('.vjs-tech');
      tech.vjs_getProperty = function() {};
      tech.vjs_setProperty = function() {};
      tech.vjs_src = function() {};
      tech.vjs_play = function() {};
      tech.vjs_discontinuity = function() {};
      videojs.Flash.onReady(tech.id);

      return player;
    };

  module('XHR', {
    setup: function() {

      // mock out Flash features for phantomjs
      oldFlashSupported = videojs.Flash.isSupported;
      videojs.Flash.isSupported = function() {
        return true;
      };

      xhr = sinon.useFakeXMLHttpRequest();

      // create the test player
      player = createPlayer();
    },

    teardown: function() {
      videojs.Flash.isSupported = oldFlashSupported;
      xhr.restore();
      player.dispose();
    }
  });

  test('handles xhr timeouts correctly', function () {
    var error;
    var clock = sinon.useFakeTimers();
    player.hls.xhr({
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

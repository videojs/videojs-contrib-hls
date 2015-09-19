/**
 * Mock objects and utility functions for testing.
 *
 */
(function(window, videojs, undefined) {
  'use strict';

  window.absoluteUrl = function(relativeUrl) {
    return window.location.protocol + '//' +
      window.location.host +
      (window.location.pathname
       .split('/')
       .slice(0, -1)
       .concat(relativeUrl)
       .join('/'));
  };

})(window, window.videojs);

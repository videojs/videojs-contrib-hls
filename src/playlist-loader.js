/**
 * A state machine that manages the loading, caching, and updating of
 * M3U8 playlists.
 */
(function(window) {
  'use strict';
  var
    
    /* XXX COPIED REMOVE ME */
    /**
     * Constructs a new URI by interpreting a path relative to another
     * URI.
     * @param basePath {string} a relative or absolute URI
     * @param path {string} a path part to combine with the base
     * @return {string} a URI that is equivalent to composing `base`
     * with `path`
     * @see http://stackoverflow.com/questions/470832/getting-an-absolute-url-from-a-relative-one-ie6-issue
   */
    resolveUrl = function(basePath, path) {
      // use the base element to get the browser to handle URI resolution
      var
        oldBase = document.querySelector('base'),
        docHead = document.querySelector('head'),
        a = document.createElement('a'),
        base = oldBase,
        oldHref,
        result;

      // prep the document
      if (oldBase) {
        oldHref = oldBase.href;
      } else {
        base = docHead.appendChild(document.createElement('base'));
      }

      base.href = basePath;
      a.href = path;
      result = a.href;

      // clean up
      if (oldBase) {
        oldBase.href = oldHref;
      } else {
        docHead.removeChild(base);
      }
      return result;
    },

    PlaylistLoader = function(url) {
    var
      loader = this,
      request;
    if (!url) {
      throw new Error('A non-empty playlist URL is required');
    }
    loader.state = 'HAVE_NOTHING';
    request = new window.XMLHttpRequest();
    request.open('GET', url);
    request.onreadystatechange = function() {
      var parser = new videojs.m3u8.Parser();
      parser.push(this.responseText);

      if (parser.manifest.playlists) {
        loader.master = parser.manifest;
      } else {
        // infer a master playlist if none was previously requested
        loader.master = {
          playlists: [parser.manifest]
        };
      }
      loader.state = 'HAVE_MASTER';
      return;
    };
    request.send(null);
  };

  window.videojs.hls.PlaylistLoader = PlaylistLoader;
})(window);

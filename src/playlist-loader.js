/**
 * A state machine that manages the loading, caching, and updating of
 * M3U8 playlists.
 */
(function(window, videojs) {
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

    /* XXX COPIED REMOVE ME */
    /**
     * Creates and sends an XMLHttpRequest.
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
    xhr = function(url, callback) {
      var
        options = {
          method: 'GET'
        },
        request;

      if (typeof callback !== 'function') {
        callback = function() {};
      }

      if (typeof url === 'object') {
        options = videojs.util.mergeOptions(options, url);
        url = options.url;
      }

      request = new window.XMLHttpRequest();
      request.open(options.method, url);

      if (options.responseType) {
        request.responseType = options.responseType;
      }
      if (options.withCredentials) {
        request.withCredentials = true;
      }

      request.onreadystatechange = function() {
        // wait until the request completes
        if (this.readyState !== 4) {
          return;
        }

        // request error
        if (this.status >= 400 || this.status === 0) {
          return callback.call(this, true, url);
        }

        return callback.call(this, false, url);
      };
      request.send(null);
      return request;
    },

    /**
     * Returns a new master playlist that is the result of merging an
     * updated media playlist into the original version. If the
     * updated media playlist does not match any of the playlist
     * entries in the original master playlist, null is returned.
     * @param master {object} a parsed master M3U8 object
     * @param media {object} a parsed media M3U8 object
     * @return {object} a new object that represents the original
     * master playlist with the updated media playlist merged in, or
     * null if the merge produced no change.
     */
    updateMaster = function(master, media) {
      var
        changed = false,
        result = videojs.util.mergeOptions(master, {}),
        i,
        playlist;

      i = master.playlists.length;
      while (i--) {
        playlist = result.playlists[i];
        if (playlist.uri === media.uri) {
          // consider the playlist unchanged if the number of segments
          // are equal and the media sequence number is unchanged
          if (playlist.segments &&
              media.segments &&
              playlist.segments.length === media.segments.length &&
              playlist.mediaSequence === media.mediaSequence) {
            continue;
          }

          result.playlists[i] = videojs.util.mergeOptions(playlist, media);
          changed = true;
        }
      }
      return changed ? result : null;
    },

    PlaylistLoader = function(srcUrl) {
      var
        loader = this,
        request,

        haveMetadata = function(error, url) {
          var parser, refreshDelay, update;
          if (error) {
            loader.error = {
              status: this.status,
              message: 'HLS playlist request error at URL: ' + url,
              code: (this.status >= 500) ? 4 : 2
            };
            return loader.trigger('error');
          }

          loader.state = 'HAVE_METADATA';

          parser = new videojs.m3u8.Parser();
          parser.push(this.responseText);
          parser.manifest.uri = url;

          // merge this playlist into the master
          update = updateMaster(loader.master, parser.manifest);
          refreshDelay = (parser.manifest.targetDuration || 10) * 1000;
          if (update) {
            loader.master = update;
            loader.media = parser.manifest;
          } else {
            // if the playlist is unchanged since the last reload,
            // try again after half the target duration
            refreshDelay /= 2;
          }

          // refresh live playlists after a target duration passes
          if (!loader.media.endList) {
            window.setTimeout(function() {
              loader.trigger('mediaupdatetimeout');
            }, refreshDelay);
          }
        };

      PlaylistLoader.prototype.init.call(this);

      if (!srcUrl) {
        throw new Error('A non-empty playlist URL is required');
      }

      loader.state = 'HAVE_NOTHING';

      // live playlist staleness timeout
      loader.on('mediaupdatetimeout', function() {
        if (loader.state !== 'HAVE_METADATA') {
          // only refresh the media playlist if no other activity is going on
          return;
        }

        loader.state = 'HAVE_CURRENT_METADATA';
        request = xhr(resolveUrl(loader.master.uri, loader.media.uri),
                      function(error) {
                        haveMetadata.call(this, error, loader.media.uri);
                      });
      });

      // request the specified URL
      xhr(srcUrl, function(error) {
        var parser;

        if (error) {
          loader.error = {
            status: this.status,
            message: 'HLS playlist request error at URL: ' + srcUrl,
            code: (this.status >= 500) ? 4 : 2
          };
          return loader.trigger('error');
        }

        parser = new videojs.m3u8.Parser();
        parser.push(this.responseText);

        loader.state = 'HAVE_MASTER';

        parser.manifest.uri = srcUrl;

        // loaded a master playlist
        if (parser.manifest.playlists) {
          loader.master = parser.manifest;
          request = xhr(resolveUrl(srcUrl, parser.manifest.playlists[0].uri),
                        function(error) {
                          // pass along the URL specified in the master playlist
                          haveMetadata.call(this,
                                            error,
                                            parser.manifest.playlists[0].uri);
                        });
          return loader.trigger('loadedplaylist');
        }

        // loaded a media playlist
        // infer a master playlist if none was previously requested
        loader.master = {
          uri: window.location.href,
          playlists: [{
            uri: srcUrl
          }]
        };
        return haveMetadata.call(this, null, srcUrl);
      });
    };
  PlaylistLoader.prototype = new videojs.hls.Stream();

  videojs.hls.PlaylistLoader = PlaylistLoader;
})(window, window.videojs);

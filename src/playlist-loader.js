/**
 * A state machine that manages the loading, caching, and updating of
 * M3U8 playlists.
 */
(function(window, videojs) {
  'use strict';
  var
    resolveUrl = videojs.hls.resolveUrl,
    xhr = videojs.hls.xhr,

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
          result.playlists[media.uri] = result.playlists[i];
          changed = true;
        }
      }
      return changed ? result : null;
    },

    PlaylistLoader = function(srcUrl, withCredentials) {
      var
        loader = this,
        media,
        request,

        haveMetadata = function(error, xhr, url) {
          var parser, refreshDelay, update;

          // any in-flight request is now finished
          request = null;

          if (error) {
            loader.error = {
              status: xhr.status,
              message: 'HLS playlist request error at URL: ' + url,
              code: (xhr.status >= 500) ? 4 : 2
            };
            return loader.trigger('error');
          }

          loader.state = 'HAVE_METADATA';

          parser = new videojs.m3u8.Parser();
          parser.push(xhr.responseText);
          parser.manifest.uri = url;

          // merge this playlist into the master
          update = updateMaster(loader.master, parser.manifest);
          refreshDelay = (parser.manifest.targetDuration || 10) * 1000;
          if (update) {
            loader.master = update;
            media = loader.master.playlists[url];
          } else {
            // if the playlist is unchanged since the last reload,
            // try again after half the target duration
            refreshDelay /= 2;
          }

          // refresh live playlists after a target duration passes
          if (!loader.media().endList) {
            window.setTimeout(function() {
              loader.trigger('mediaupdatetimeout');
            }, refreshDelay);
          }

          loader.trigger('loadedplaylist');
        };

      PlaylistLoader.prototype.init.call(this);

      if (!srcUrl) {
        throw new Error('A non-empty playlist URL is required');
      }

      loader.state = 'HAVE_NOTHING';

      /**
       * When called without any arguments, returns the currently
       * active media playlist. When called with a single argument,
       * triggers the playlist loader to asynchronously switch to the
       * specified media playlist. Calling this method while the
       * loader is in the HAVE_NOTHING or HAVE_MASTER states causes an
       * error to be emitted but otherwise has no effect.
       * @param playlist (optional) {object} the parsed media playlist
       * object to switch to
       */
      loader.media = function(playlist) {
        // getter
        if (!playlist) {
          return media;
        }

        // setter
        if (loader.state === 'HAVE_NOTHING' || loader.state === 'HAVE_MASTER') {
          throw new Error('Cannot switch media playlist from ' + loader.state);
        }

        // find the playlist object if the target playlist has been
        // specified by URI
        if (typeof playlist === 'string') {
          if (!loader.master.playlists[playlist]) {
            throw new Error('Unknown playlist URI: ' + playlist);
          }
          playlist = loader.master.playlists[playlist];
        }

        if (playlist.uri === media.uri) {
          // switching to the currently active playlist is a no-op
          return;
        }

        loader.state = 'SWITCHING_MEDIA';

        // abort any outstanding playlist refreshes
        if (request) {
          request.abort();
          request = null;
        }

        // request the new playlist
        request = xhr({
          url: resolveUrl(loader.master.uri, playlist.uri),
          withCredentials: withCredentials
        }, function(error) {
          haveMetadata(error, this, playlist.uri);
        });
      };

      // live playlist staleness timeout
      loader.on('mediaupdatetimeout', function() {
        if (loader.state !== 'HAVE_METADATA') {
          // only refresh the media playlist if no other activity is going on
          return;
        }

        loader.state = 'HAVE_CURRENT_METADATA';
        request = xhr({
          url: resolveUrl(loader.master.uri, loader.media().uri),
          withCredentials: withCredentials
        }, function(error) {
          haveMetadata(error, this, loader.media().uri);
        });
      });

      // request the specified URL
      xhr({
        url: srcUrl,
        withCredentials: withCredentials
      }, function(error) {
        var parser, i;

        if (error) {
          loader.error = {
            status: this.status,
            message: 'HLS playlist request error at URL: ' + srcUrl,
            code: 2 // MEDIA_ERR_NETWORK
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

          // setup by-URI lookups
          i = loader.master.playlists.length;
          while (i--) {
            loader.master.playlists[loader.master.playlists[i].uri] = loader.master.playlists[i];
          }

          request = xhr({
            url: resolveUrl(srcUrl, parser.manifest.playlists[0].uri),
            withCredentials: withCredentials
          }, function(error) {
            // pass along the URL specified in the master playlist
            haveMetadata(error,
                         this,
                         parser.manifest.playlists[0].uri);
            loader.trigger('loadedmetadata');
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
        loader.master.playlists[srcUrl] = loader.master.playlists[0];
        haveMetadata(null, this, srcUrl);
        return loader.trigger('loadedmetadata');
      });
    };
  PlaylistLoader.prototype = new videojs.hls.Stream();

  videojs.hls.PlaylistLoader = PlaylistLoader;
})(window, window.videojs);

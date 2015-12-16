/**
 * playlist-loader
 *
 * A state machine that manages the loading, caching, and updating of
 * M3U8 playlists.
 *
 */
(function(window, videojs) {
  'use strict';
  var
    resolveUrl = videojs.Hls.resolveUrl,
    xhr = videojs.Hls.xhr,
    mergeOptions = videojs.mergeOptions,

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
        result = mergeOptions(master, {}),
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

          result.playlists[i] = mergeOptions(playlist, media);
          result.playlists[media.uri] = result.playlists[i];

          // if the update could overlap existing segment information,
          // merge the two lists
          if (playlist.segments) {
            result.playlists[i].segments = updateSegments(playlist.segments,
                                                          media.segments,
                                                          media.mediaSequence - playlist.mediaSequence);
          }
          changed = true;
        }
      }
      return changed ? result : null;
    },

    /**
     * Returns a new array of segments that is the result of merging
     * properties from an older list of segments onto an updated
     * list. No properties on the updated playlist will be overridden.
     * @param original {array} the outdated list of segments
     * @param update {array} the updated list of segments
     * @param offset {number} (optional) the index of the first update
     * segment in the original segment list. For non-live playlists,
     * this should always be zero and does not need to be
     * specified. For live playlists, it should be the difference
     * between the media sequence numbers in the original and updated
     * playlists.
     * @return a list of merged segment objects
     */
    updateSegments = function(original, update, offset) {
      var result = update.slice(), length, i;
      offset = offset || 0;
      length = Math.min(original.length, update.length + offset);

      for (i = offset; i < length; i++) {
        result[i - offset] = mergeOptions(original[i], result[i - offset]);
      }
      return result;
    },

    PlaylistLoader = function(srcUrl, withCredentials) {
      var
        loader = this,
        dispose,
        mediaUpdateTimeout,
        request,
        haveMetadata;

      PlaylistLoader.prototype.init.call(this);

      // a flag that disables "expired time"-tracking this setting has
      // no effect when not playing a live stream
      this.trackExpiredTime_ = false;

      if (!srcUrl) {
        throw new Error('A non-empty playlist URL is required');
      }

      // update the playlist loader's state in response to a new or
      // updated playlist.
      haveMetadata = function(error, xhr, url) {
        var parser, refreshDelay, update;

        loader.setBandwidth(request || xhr);

        // any in-flight request is now finished
        request = null;

        if (error) {
          loader.error = {
            playlist: loader.master.playlists[url],
            status: xhr.status,
            message: 'HLS playlist request error at URL: ' + url,
            responseText: xhr.responseText,
            code: (xhr.status >= 500) ? 4 : 2
          };
          return loader.trigger('error');
        }

        loader.state = 'HAVE_METADATA';

        parser = new videojs.m3u8.Parser();
        parser.push(xhr.responseText);
        parser.end();
        parser.manifest.uri = url;

        // merge this playlist into the master
        update = updateMaster(loader.master, parser.manifest);
        refreshDelay = (parser.manifest.targetDuration || 10) * 1000;
        if (update) {
          loader.master = update;
          loader.updateMediaPlaylist_(parser.manifest);
        } else {
          // if the playlist is unchanged since the last reload,
          // try again after half the target duration
          refreshDelay /= 2;
        }

        // refresh live playlists after a target duration passes
        if (!loader.media().endList) {
          window.clearTimeout(mediaUpdateTimeout);
          mediaUpdateTimeout = window.setTimeout(function() {
            loader.trigger('mediaupdatetimeout');
          }, refreshDelay);
        }

        loader.trigger('loadedplaylist');
      };

      // initialize the loader state
      loader.state = 'HAVE_NOTHING';

      // track the time that has expired from the live window
      // this allows the seekable start range to be calculated even if
      // all segments with timing information have expired
      this.expired_ = 0;

      // capture the prototype dispose function
      dispose = this.dispose;

      /**
       * Abort any outstanding work and clean up.
       */
      loader.dispose = function() {
        if (request) {
          request.onreadystatechange = null;
          request.abort();
          request = null;
        }
        window.clearTimeout(mediaUpdateTimeout);
        dispose.call(this);
      };

      /**
       * When called without any arguments, returns the currently
       * active media playlist. When called with a single argument,
       * triggers the playlist loader to asynchronously switch to the
       * specified media playlist. Calling this method while the
       * loader is in the HAVE_NOTHING causes an error to be emitted
       * but otherwise has no effect.
       * @param playlist (optional) {object} the parsed media playlist
       * object to switch to
       */
      loader.media = function(playlist) {
        var startingState = loader.state, mediaChange;
        // getter
        if (!playlist) {
          return loader.media_;
        }

        // setter
        if (loader.state === 'HAVE_NOTHING') {
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

        mediaChange = !loader.media_ || playlist.uri !== loader.media_.uri;

        // switch to fully loaded playlists immediately
        if (loader.master.playlists[playlist.uri].endList) {
          // abort outstanding playlist requests
          if (request) {
            request.onreadystatechange = null;
            request.abort();
            request = null;
          }
          loader.state = 'HAVE_METADATA';
          loader.media_ = playlist;

          // trigger media change if the active media has been updated
          if (mediaChange) {
            loader.trigger('mediachange');
          }
          return;
        }

        // switching to the active playlist is a no-op
        if (!mediaChange) {
          return;
        }

        loader.state = 'SWITCHING_MEDIA';

        // there is already an outstanding playlist request
        if (request) {
          if (resolveUrl(loader.master.uri, playlist.uri) === request.url) {
            // requesting to switch to the same playlist multiple times
            // has no effect after the first
            return;
          }
          request.onreadystatechange = null;
          request.abort();
          request = null;
        }

        // request the new playlist
        request = xhr({
          uri: resolveUrl(loader.master.uri, playlist.uri),
          withCredentials: withCredentials
        }, function(error, request) {
          haveMetadata(error, request, playlist.uri);

          if (error) {
            return;
          }

          // fire loadedmetadata the first time a media playlist is loaded
          if (startingState === 'HAVE_MASTER') {
            loader.trigger('loadedmetadata');
          } else {
            loader.trigger('mediachange');
          }
        });
      };

      loader.setBandwidth = function(xhr) {
        loader.bandwidth = xhr.bandwidth;
      };

      // In a live list, don't keep track of the expired time until
      // HLS tells us that "first play" has commenced
      loader.on('firstplay', function() {
        this.trackExpiredTime_ = true;
      });

      // live playlist staleness timeout
      loader.on('mediaupdatetimeout', function() {
        if (loader.state !== 'HAVE_METADATA') {
          // only refresh the media playlist if no other activity is going on
          return;
        }

        loader.state = 'HAVE_CURRENT_METADATA';
        request = xhr({
          uri: resolveUrl(loader.master.uri, loader.media().uri),
          withCredentials: withCredentials
        }, function(error, request) {
          haveMetadata(error, request, loader.media().uri);
        });
      });

      // request the specified URL
      request = xhr({
        uri: srcUrl,
        withCredentials: withCredentials
      }, function(error, req) {
        var parser, i;

        // clear the loader's request reference
        request = null;

        if (error) {
          loader.error = {
            status: req.status,
            message: 'HLS playlist request error at URL: ' + srcUrl,
            responseText: req.responseText,
            code: 2 // MEDIA_ERR_NETWORK
          };
          return loader.trigger('error');
        }

        parser = new videojs.m3u8.Parser();
        parser.push(req.responseText);
        parser.end();

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

          loader.trigger('loadedplaylist');
          if (!request) {
            // no media playlist was specifically selected so start
            // from the first listed one
            loader.media(parser.manifest.playlists[0]);
          }
          return;
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
        haveMetadata(null, req, srcUrl);
        return loader.trigger('loadedmetadata');
      });
    };
  PlaylistLoader.prototype = new videojs.Hls.Stream();

  /**
   * Update the PlaylistLoader state to reflect the changes in an
   * update to the current media playlist.
   * @param update {object} the updated media playlist object
   */
  PlaylistLoader.prototype.updateMediaPlaylist_ = function(update) {
    var outdated, i, segment;

    outdated = this.media_;
    this.media_ = this.master.playlists[update.uri];

    if (!outdated) {
      return;
    }

    // don't track expired time until this flag is truthy
    if (!this.trackExpiredTime_) {
      return;
    }

    // if the update was the result of a rendition switch do not
    // attempt to calculate expired_ since media-sequences need not
    // correlate between renditions/variants
    if (update.uri !== outdated.uri) {
      return;
    }

    // try using precise timing from first segment of the updated
    // playlist
    if (update.segments.length) {
      if (update.segments[0].start !== undefined) {
        this.expired_ = update.segments[0].start;
        return;
      } else if (update.segments[0].end !== undefined) {
        this.expired_ = update.segments[0].end - update.segments[0].duration;
        return;
      }
    }

    // calculate expired by walking the outdated playlist
    i = update.mediaSequence - outdated.mediaSequence - 1;

    for (; i >= 0; i--) {
      segment = outdated.segments[i];

      if (!segment) {
        // we missed information on this segment completely between
        // playlist updates so we'll have to take an educated guess
        // once we begin buffering again, any error we introduce can
        // be corrected
        this.expired_ += outdated.targetDuration || 10;
        continue;
      }

      if (segment.end !== undefined) {
        this.expired_ = segment.end;
        return;
      }
      if (segment.start !== undefined) {
        this.expired_ = segment.start + segment.duration;
        return;
      }
      this.expired_ += segment.duration;
    }
  };

  /**
   * Determine the index of the segment that contains a specified
   * playback position in the current media playlist. Early versions
   * of the HLS specification require segment durations to be rounded
   * to the nearest integer which means it may not be possible to
   * determine the correct segment for a playback position if that
   * position is within .5 seconds of the segment duration. This
   * function will always return the lower of the two possible indices
   * in those cases.
   *
   * @param time {number} The number of seconds since the earliest
   * possible position to determine the containing segment for
   * @returns {number} The number of the media segment that contains
   * that time position. If the specified playback position is outside
   * the time range of the current set of media segments, the return
   * value will be clamped to the index of the segment containing the
   * closest playback position that is currently available.
   */
  PlaylistLoader.prototype.getMediaIndexForTime_ = function(time) {
    var
      i,
      segment,
      originalTime = time,
      numSegments = this.media_.segments.length,
      lastSegment = numSegments - 1,
      startIndex,
      endIndex,
      knownStart,
      knownEnd;

    if (!this.media_) {
      return 0;
    }

    // when the requested position is earlier than the current set of
    // segments, return the earliest segment index
    if (time < 0) {
      return 0;
    }

    // find segments with known timing information that bound the
    // target time
    for (i = 0; i < numSegments; i++) {
      segment = this.media_.segments[i];
      if (segment.end) {
        if (segment.end > time) {
          knownEnd = segment.end;
          endIndex = i;
          break;
        } else {
          knownStart = segment.end;
          startIndex = i + 1;
        }
      }
    }

    // use the bounds we just found and playlist information to
    // estimate the segment that contains the time we are looking for
    if (startIndex !== undefined) {
      // We have a known-start point that is before our desired time so
      // walk from that point forwards
      time = time - knownStart;
      for (i = startIndex; i < (endIndex || numSegments); i++) {
        segment = this.media_.segments[i];
        time -= segment.duration;

        if (time < 0) {
          return i;
        }
      }

      if (i >= endIndex) {
        // We haven't found a segment but we did hit a known end point
        // so fallback to interpolating between the segment index
        // based on the known span of the timeline we are dealing with
        // and the number of segments inside that span
        return startIndex + Math.floor(
          ((originalTime - knownStart) / (knownEnd - knownStart)) *
          (endIndex - startIndex));
      }

      // We _still_ haven't found a segment so load the last one
      return lastSegment;
    } else if (endIndex !== undefined) {
      // We _only_ have a known-end point that is after our desired time so
      // walk from that point backwards
      time = knownEnd - time;
      for (i = endIndex; i >= 0; i--) {
        segment = this.media_.segments[i];
        time -= segment.duration;

        if (time < 0) {
          return i;
        }
      }

      // We haven't found a segment so load the first one if time is zero
      if (time === 0) {
        return 0;
      } else {
        return -1;
      }
    } else {
      // We known nothing so walk from the front of the playlist,
      // subtracting durations until we find a segment that contains
      // time and return it
      time = time - this.expired_;

      if (time < 0) {
        return -1;
      }

      for (i = 0; i < numSegments; i++) {
        segment = this.media_.segments[i];
        time -= segment.duration;
        if (time < 0) {
          return i;
        }
      }
      // We are out of possible candidates so load the last one...
      // The last one is the least likely to overlap a buffer and therefore
      // the one most likely to tell us something about the timeline
      return lastSegment;
    }
  };

  videojs.Hls.PlaylistLoader = PlaylistLoader;
})(window, window.videojs);

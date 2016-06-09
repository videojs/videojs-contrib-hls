/**
 * @file playlist-loader.js
 *
 * A state machine that manages the loading, caching, and updating of
 * M3U8 playlists.
 *
 */
import resolveUrl from './resolve-url';
import {mergeOptions} from 'video.js';
import Stream from './stream';
import m3u8 from 'm3u8-parser';

/**
  * Returns a new array of segments that is the result of merging
  * properties from an older list of segments onto an updated
  * list. No properties on the updated playlist will be overridden.
  *
  * @param {Array} original the outdated list of segments
  * @param {Array} update the updated list of segments
  * @param {Number=} offset the index of the first update
  * segment in the original segment list. For non-live playlists,
  * this should always be zero and does not need to be
  * specified. For live playlists, it should be the difference
  * between the media sequence numbers in the original and updated
  * playlists.
  * @return a list of merged segment objects
  */
const updateSegments = function(original, update, offset) {
  let result = update.slice();
  let length;
  let i;

  offset = offset || 0;
  length = Math.min(original.length, update.length + offset);

  for (i = offset; i < length; i++) {
    result[i - offset] = mergeOptions(original[i], result[i - offset]);
  }
  return result;
};

/**
  * Returns a new master playlist that is the result of merging an
  * updated media playlist into the original version. If the
  * updated media playlist does not match any of the playlist
  * entries in the original master playlist, null is returned.
  *
  * @param {Object} master a parsed master M3U8 object
  * @param {Object} media a parsed media M3U8 object
  * @return {Object} a new object that represents the original
  * master playlist with the updated media playlist merged in, or
  * null if the merge produced no change.
  */
const updateMaster = function(master, media) {
  let changed = false;
  let result = mergeOptions(master, {});
  let i = master.playlists.length;
  let playlist;
  let segment;
  let j;

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
        result.playlists[i].segments = updateSegments(
          playlist.segments,
          media.segments,
          media.mediaSequence - playlist.mediaSequence
        );
      }
      // resolve any missing segment and key URIs
      j = 0;
      if (result.playlists[i].segments) {
        j = result.playlists[i].segments.length;
      }
      while (j--) {
        segment = result.playlists[i].segments[j];
        if (!segment.resolvedUri) {
          segment.resolvedUri = resolveUrl(playlist.resolvedUri, segment.uri);
        }
        if (segment.key && !segment.key.resolvedUri) {
          segment.key.resolvedUri = resolveUrl(playlist.resolvedUri, segment.key.uri);
        }
      }
      changed = true;
    }
  }
  return changed ? result : null;
};

/**
 * Load a playlist from a remote loacation
 *
 * @class PlaylistLoader
 * @extends Stream
 * @param {String} srcUrl the url to start with
 * @param {Boolean} withCredentials the withCredentials xhr option
 * @constructor
 */
const PlaylistLoader = function(srcUrl, hls, withCredentials) {
  /* eslint-disable consistent-this */
  let loader = this;
  /* eslint-enable consistent-this */
  let dispose;
  let mediaUpdateTimeout;
  let request;
  let playlistRequestError;
  let haveMetadata;

  PlaylistLoader.prototype.constructor.call(this);

  this.hls_ = hls;

  // a flag that disables "expired time"-tracking this setting has
  // no effect when not playing a live stream
  this.trackExpiredTime_ = false;

  if (!srcUrl) {
    throw new Error('A non-empty playlist URL is required');
  }

  playlistRequestError = function(xhr, url, startingState) {
    loader.setBandwidth(request || xhr);

    // any in-flight request is now finished
    request = null;

    if (startingState) {
      loader.state = startingState;
    }

    loader.error = {
      playlist: loader.master.playlists[url],
      status: xhr.status,
      message: 'HLS playlist request error at URL: ' + url,
      responseText: xhr.responseText,
      code: (xhr.status >= 500) ? 4 : 2
    };

    loader.trigger('error');
  };

  // update the playlist loader's state in response to a new or
  // updated playlist.
  haveMetadata = function(xhr, url) {
    let parser;
    let refreshDelay;
    let update;

    loader.setBandwidth(request || xhr);

    // any in-flight request is now finished
    request = null;

    loader.state = 'HAVE_METADATA';

    parser = new m3u8.Parser();
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
    loader.stopRequest();
    window.clearTimeout(mediaUpdateTimeout);
    dispose.call(this);
  };

  loader.stopRequest = () => {
    if (request) {
      let oldRequest = request;

      request = null;
      oldRequest.onreadystatechange = null;
      oldRequest.abort();
    }
  };

   /**
    * When called without any arguments, returns the currently
    * active media playlist. When called with a single argument,
    * triggers the playlist loader to asynchronously switch to the
    * specified media playlist. Calling this method while the
    * loader is in the HAVE_NOTHING causes an error to be emitted
    * but otherwise has no effect.
    *
    * @param {Object=} playlis tthe parsed media playlist
    * object to switch to
    * @return {Playlist} the current loaded media
    */
  loader.media = function(playlist) {
    let startingState = loader.state;
    let mediaChange;

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
        loader.trigger('mediachanging');
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
    if (this.media_) {
      this.trigger('mediachanging');
    }
    request = this.hls_.xhr({
      uri: resolveUrl(loader.master.uri, playlist.uri),
      withCredentials
    }, function(error, req) {
      // disposed
      if (!request) {
        return;
      }

      if (error) {
        return playlistRequestError(request, playlist.uri, startingState);
      }

      haveMetadata(req, playlist.uri);

      // fire loadedmetadata the first time a media playlist is loaded
      if (startingState === 'HAVE_MASTER') {
        loader.trigger('loadedmetadata');
      } else {
        loader.trigger('mediachange');
      }
    });
  };

  /**
   * set the bandwidth on an xhr to the bandwidth on the playlist
   */
  loader.setBandwidth = function(xhr) {
    loader.bandwidth = xhr.bandwidth;
  };

  // In a live playlist, don't keep track of the expired time
  // until HLS tells us that "first play" has commenced
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
    request = this.hls_.xhr({
      uri: resolveUrl(loader.master.uri, loader.media().uri),
      withCredentials
    }, function(error, req) {
      // disposed
      if (!request) {
        return;
      }

      if (error) {
        return playlistRequestError(request, loader.media().uri);
      }
      haveMetadata(request, loader.media().uri);
    });
  });

  /**
   * pause loading of the playlist
   */
  loader.pause = () => {
    loader.stopRequest();
    window.clearTimeout(mediaUpdateTimeout);
  };

  /**
   * start loading of the playlist
   */
  loader.load = () => {
    if (loader.started) {
      if (!loader.media().endList) {
        loader.trigger('mediaupdatetimeout');
      } else {
        loader.trigger('loadedplaylist');
      }
    } else {
      loader.start();
    }
  };

  /**
   * start loading of the playlist
   */
  loader.start = () => {
    loader.started = true;

    // request the specified URL
    request = this.hls_.xhr({
      uri: srcUrl,
      withCredentials
    }, function(error, req) {
      let parser;
      let playlist;
      let i;

      // disposed
      if (!request) {
        return;
      }

      // clear the loader's request reference
      request = null;

      if (error) {
        loader.error = {
          status: req.status,
          message: 'HLS playlist request error at URL: ' + srcUrl,
          responseText: req.responseText,
          // MEDIA_ERR_NETWORK
          code: 2
        };
        return loader.trigger('error');
      }

      parser = new m3u8.Parser();
      parser.push(req.responseText);
      parser.end();

      loader.state = 'HAVE_MASTER';

      parser.manifest.uri = srcUrl;

      // loaded a master playlist
      if (parser.manifest.playlists) {
        loader.master = parser.manifest;

        // setup by-URI lookups and resolve media playlist URIs
        i = loader.master.playlists.length;
        while (i--) {
          playlist = loader.master.playlists[i];
          loader.master.playlists[playlist.uri] = playlist;
          playlist.resolvedUri = resolveUrl(loader.master.uri, playlist.uri);
        }

        // resolve any media group URIs
        for (let groupKey in loader.master.mediaGroups.AUDIO) {
          for (let labelKey in loader.master.mediaGroups.AUDIO[groupKey]) {
            let alternateAudio = loader.master.mediaGroups.AUDIO[groupKey][labelKey];

            if (alternateAudio.uri) {
              alternateAudio.resolvedUri =
                resolveUrl(loader.master.uri, alternateAudio.uri);
            }
          }
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
      loader.master.playlists[0].resolvedUri = srcUrl;
      haveMetadata(req, srcUrl);
      return loader.trigger('loadedmetadata');
    });
  };
};

PlaylistLoader.prototype = new Stream();

 /**
  * Update the PlaylistLoader state to reflect the changes in an
  * update to the current media playlist.
  *
  * @param {Object} update the updated media playlist object
  */
PlaylistLoader.prototype.updateMediaPlaylist_ = function(update) {
  let outdated;
  let i;
  let segment;

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
    if (typeof update.segments[0].start !== 'undefined') {
      this.expired_ = update.segments[0].start;
      return;
    } else if (typeof update.segments[0].end !== 'undefined') {
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

    if (typeof segment.end !== 'undefined') {
      this.expired_ = segment.end;
      return;
    }
    if (typeof segment.start !== 'undefined') {
      this.expired_ = segment.start + segment.duration;
      return;
    }
    this.expired_ += segment.duration;
  }
};

export default PlaylistLoader;

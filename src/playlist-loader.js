/**
 * @file playlist-loader.js
 *
 * A state machine that manages the loading, caching, and updating of
 * M3U8 playlists.
 *
 */
import resolveUrl from './resolve-url';
import {mergeOptions} from 'video.js';
import { isEnabled } from './playlist.js';
import Stream from './stream';
import m3u8 from 'm3u8-parser';
import window from 'global/window';

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
        if (segment.map && !segment.map.resolvedUri) {
          segment.map.resolvedUri = resolveUrl(playlist.resolvedUri, segment.map.uri);
        }
      }
      changed = true;
    }
  }
  return changed ? result : null;
};

/**
 * Load a playlist from a remote location
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
    loader.targetDuration = parser.manifest.targetDuration;
    if (update) {
      loader.master = update;
      loader.media_ = loader.master.playlists[parser.manifest.uri];
    } else {
      // if the playlist is unchanged since the last reload,
      // try again after half the target duration
      refreshDelay /= 2;
      loader.trigger('playlistunchanged');
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
   * Returns the number of enabled playlists on the master playlist object
   *
   * @return {Number} number of eneabled playlists
   */
  loader.enabledPlaylists_ = function() {
    return loader.master.playlists.filter(isEnabled).length;
  };

  /**
   * Returns whether the current playlist is the lowest rendition
   *
   * @return {Boolean} true if on lowest rendition
   */
  loader.isLowestEnabledRendition_ = function() {
    if (loader.master.playlists.length === 1) {
      return true;
    }

    let media = loader.media();

    let currentBandwidth = media.attributes.BANDWIDTH || Number.MAX_VALUE;

    return (loader.master.playlists.filter((playlist) => {
      const enabled = isEnabled(playlist);

      if (!enabled) {
        return false;
      }

      let bandwidth = 0;

      if (playlist && playlist.attributes) {
        bandwidth = playlist.attributes.BANDWIDTH;
      }
      return bandwidth < currentBandwidth;

    }).length === 0);
  };

  /**
   * Returns whether the current playlist is the final available rendition
   *
   * @return {Boolean} true if on final rendition
   */
  loader.isFinalRendition_ = function() {
    return (loader.master.playlists.filter(isEnabled).length === 1);
  };

   /**
    * When called without any arguments, returns the currently
    * active media playlist. When called with a single argument,
    * triggers the playlist loader to asynchronously switch to the
    * specified media playlist. Calling this method while the
    * loader is in the HAVE_NOTHING causes an error to be emitted
    * but otherwise has no effect.
    *
    * @param {Object=} playlist the parsed media playlist
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
        return playlistRequestError(request, loader.media().uri, 'HAVE_METADATA');
      }
      haveMetadata(request, loader.media().uri);
    });
  });

  // setup initial sync info
  loader.on('firstplay', function() {
    let playlist = loader.media();

    if (playlist) {
      playlist.syncInfo = {
        mediaSequence: playlist.mediaSequence,
        time: 0
      };
    }
  });

  /**
   * pause loading of the playlist
   */
  loader.pause = () => {
    loader.stopRequest();
    window.clearTimeout(mediaUpdateTimeout);
    if (loader.state === 'HAVE_NOTHING') {
      // If we pause the loader before any data has been retrieved, its as if we never
      // started, so reset to an unstarted state.
      loader.started = false;
    }
  };

  /**
   * start loading of the playlist
   */
  loader.load = (isFinalRendition) => {
    const media = loader.media();

    window.clearTimeout(mediaUpdateTimeout);

    if (isFinalRendition) {
      let refreshDelay = media ? (media.targetDuration / 2) * 1000 : 5 * 1000;

      mediaUpdateTimeout = window.setTimeout(loader.load.bind(null, false), refreshDelay);
      return;
    }

    if (!loader.started) {
      loader.start();
      return;
    }

    if (media && !media.endList) {
      loader.trigger('mediaupdatetimeout');
    } else {
      loader.trigger('loadedplaylist');
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
        if (loader.state === 'HAVE_NOTHING') {
          loader.started = false;
        }
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
        ['AUDIO', 'SUBTITLES'].forEach((mediaType) => {
          for (let groupKey in loader.master.mediaGroups[mediaType]) {
            for (let labelKey in loader.master.mediaGroups[mediaType][groupKey]) {
              let mediaProperties = loader.master.mediaGroups[mediaType][groupKey][labelKey];

              if (mediaProperties.uri) {
                mediaProperties.resolvedUri =
                  resolveUrl(loader.master.uri, mediaProperties.uri);
              }
            }
          }
        });

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
        mediaGroups: {
          'AUDIO': {},
          'VIDEO': {},
          'CLOSED-CAPTIONS': {},
          'SUBTITLES': {}
        },
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

export default PlaylistLoader;

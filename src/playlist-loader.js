/**
 * playlist-loader
 *
 * A state machine that manages the loading, caching, and updating of
 * M3U8 playlists.
 *
 */
import resolveUrl from './resolve-url';
import XhrModule from './xhr';
import {mergeOptions} from 'video.js';
import Stream from './stream';
import m3u8 from './m3u8';

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
  * @param master {object} a parsed master M3U8 object
  * @param media {object} a parsed media M3U8 object
  * @return {object} a new object that represents the original
  * master playlist with the updated media playlist merged in, or
  * null if the merge produced no change.
  */
const updateMaster = function(master, media) {
  let changed = false;
  let result = mergeOptions(master, {});
  let i = master.playlists.length;
  let playlist;

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
                                                      media.mediaSequence -
                                                      playlist.mediaSequence);
      }
      changed = true;
    }
  }
  return changed ? result : null;
};

export default class PlaylistLoader extends Stream {
  constructor(srcUrl, withCredentials) {
    super();
    this.srcUrl = srcUrl;
    this.withCredentials = withCredentials;

    this.mediaUpdateTimeout = null;

    // initialize the loader state
    this.state = 'HAVE_NOTHING';

    // track the time that has expired from the live window
    // this allows the seekable start range to be calculated even if
    // all segments with timing information have expired
    this.expired_ = 0;

    // a flag that disables "expired time"-tracking this setting has
    // no effect when not playing a live stream
    this.trackExpiredTime_ = false;

    if (!this.srcUrl) {
      throw new Error('A non-empty playlist URL is required');
    }

    // In a live list, don't keep track of the expired time until
    // HLS tells us that "first play" has commenced
    this.on('firstplay', function() {
      this.trackExpiredTime_ = true;
    });

    // live playlist staleness timeout
    this.on('mediaupdatetimeout', () => {
      if (this.state !== 'HAVE_METADATA') {
        // only refresh the media playlist if no other activity is going on
        return;
      }

      this.state = 'HAVE_CURRENT_METADATA';
      this.request = XhrModule({
        uri: resolveUrl(this.master.uri, this.media().uri),
        withCredentials: this.withCredentials
      }, (error, request) => {
        if (error) {
          return this.playlistRequestError(request, this.media().uri);
        }
        this.haveMetadata(request, this.media().uri);
      });
    });

    // request the specified URL
    this.request = XhrModule({
      uri: this.srcUrl,
      withCredentials: this.withCredentials
    }, (error, request) => {
      let parser = new m3u8.Parser();
      let i;

      // clear the loader's request reference
      this.request = null;

      if (error) {
        this.error = {
          status: request.status,
          message: 'HLS playlist request error at URL: ' + this.srcUrl,
          responseText: request.responseText,
          // MEDIA_ERR_NETWORK
          code: 2
        };
        return this.trigger('error');
      }

      parser.push(request.responseText);
      parser.end();

      this.state = 'HAVE_MASTER';

      parser.manifest.uri = this.srcUrl;

      // loaded a master playlist
      if (parser.manifest.playlists) {
        this.master = parser.manifest;

        // setup by-URI lookups
        i = this.master.playlists.length;
        while (i--) {
          this.master.playlists[this.master.playlists[i].uri] =
            this.master.playlists[i];
        }

        this.trigger('loadedplaylist');
        if (!this.request) {
          // no media playlist was specifically selected so start
          // from the first listed one
          this.media(parser.manifest.playlists[0]);
        }
        return;
      }

      // loaded a media playlist
      // infer a master playlist if none was previously requested
      this.master = {
        uri: window.location.href,
        playlists: [{
          uri: this.srcUrl
        }]
      };
      this.master.playlists[this.srcUrl] = this.master.playlists[0];
      this.haveMetadata(request, this.srcUrl);
      return this.trigger('loadedmetadata');
    });
  }

  playlistRequestError(xhr, url, startingState) {
    this.setBandwidth(this.request || xhr);

    // any in-flight request is now finished
    this.request = null;

    if (startingState) {
      this.state = startingState;
    }

    this.error = {
      playlist: this.master.playlists[url],
      status: xhr.status,
      message: 'HLS playlist request error at URL: ' + url,
      responseText: xhr.responseText,
      code: (xhr.status >= 500) ? 4 : 2
    };
    this.trigger('error');
  }

  // update the playlist loader's state in response to a new or
  // updated playlist.
  haveMetadata(xhr, url) {
    let parser;
    let refreshDelay;
    let update;

    this.setBandwidth(this.request || xhr);

    // any in-flight request is now finished
    this.request = null;

    this.state = 'HAVE_METADATA';

    parser = new m3u8.Parser();
    parser.push(xhr.responseText);
    parser.end();
    parser.manifest.uri = url;

    // merge this playlist into the master
    update = updateMaster(this.master, parser.manifest);
    refreshDelay = (parser.manifest.targetDuration || 10) * 1000;
    if (update) {
      this.master = update;
      this.updateMediaPlaylist_(parser.manifest);
    } else {
      // if the playlist is unchanged since the last reload,
      // try again after half the target duration
      refreshDelay /= 2;
    }

    // refresh live playlists after a target duration passes
    if (!this.media().endList) {
      this.clearMediaUpdateTimeout_();
      this.mediaUpdateTimeout = window.setTimeout(() => {
        this.trigger('mediaupdatetimeout');
      }, refreshDelay);
    }

    this.trigger('loadedplaylist');
  }

  clearMediaUpdateTimeout_() {
    if (this.mediaUpdateTimeout) {
      window.clearTimeout(this.mediaUpdateTimeout);
    }
  }

  requestDispose_() {
    if (this.request) {
      this.request.onreadystatechange = null;
      this.request.abort();
      this.request = null;
    }
  }

  /**
   * Abort any outstanding work and clean up.
   */
  dispose() {
    this.requestDispose_();
    this.clearMediaUpdateTimeout_();
    super.dispose();
  }

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
  media(playlist) {
    let startingState = this.state;
    let mediaChange;

    // getter
    if (!playlist) {
      return this.media_;
    }

    // setter
    if (this.state === 'HAVE_NOTHING') {
      throw new Error('Cannot switch media playlist from ' + this.state);
    }

    // find the playlist object if the target playlist has been
    // specified by URI
    if (typeof playlist === 'string') {
      if (!this.master.playlists[playlist]) {
        throw new Error('Unknown playlist URI: ' + playlist);
      }
      playlist = this.master.playlists[playlist];
    }

    mediaChange = !this.media_ || playlist.uri !== this.media_.uri;

    // switch to fully loaded playlists immediately
    if (this.master.playlists[playlist.uri].endList) {
      // abort outstanding playlist requests
      this.requestDispose_();
      this.state = 'HAVE_METADATA';
      this.media_ = playlist;

      // trigger media change if the active media has been updated
      if (mediaChange) {
        this.trigger('mediachange');
      }
      return;
    }

    // switching to the active playlist is a no-op
    if (!mediaChange) {
      return;
    }

    this.state = 'SWITCHING_MEDIA';

    // there is already an outstanding playlist request
    if (this.request) {
      if (resolveUrl(this.master.uri, playlist.uri) === this.request.url) {
        // requesting to switch to the same playlist multiple times
        // has no effect after the first
        return;
      }
      this.requestDispose_();
    }

    // request the new playlist
    this.request = XhrModule({
      uri: resolveUrl(this.master.uri, playlist.uri),
      withCredentials: this.withCredentials
    }, (error, request) => {
      if (error) {
        return this.playlistRequestError(request, playlist.uri, startingState);
      }
      this.haveMetadata(request, playlist.uri);

      if (error) {
        return;
      }

      // fire loadedmetadata the first time a media playlist is loaded
      if (startingState === 'HAVE_MASTER') {
        this.trigger('loadedmetadata');
      } else {
        this.trigger('mediachange');
      }
    });
  }

  setBandwidth(xhr) {
    this.bandwidth = xhr.bandwidth;
  }
  /**
   * Update the PlaylistLoader state to reflect the changes in an
   * update to the current media playlist.
   * @param update {object} the updated media playlist object
   */
  updateMediaPlaylist_(update) {
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
  }

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
  getMediaIndexForTime_(time) {
    let i;
    let segment;
    let originalTime = time;
    let numSegments = this.media_.segments.length;
    let lastSegment = numSegments - 1;
    let startIndex;
    let endIndex;
    let knownStart;
    let knownEnd;

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
    if (typeof startIndex !== 'undefined') {
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
        return startIndex + Math.floor(((originalTime - knownStart) /
                                        (knownEnd - knownStart)) *
                                        (endIndex - startIndex));
      }

      // We _still_ haven't found a segment so load the last one
      return lastSegment;
    } else if (typeof endIndex !== 'undefined') {
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
      }
      return -1;
    }
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
}

/**
 * @file playlist.js
 *
 * Playlist related utilities.
 */
import {createTimeRange} from 'video.js';
import window from 'global/window';

let Playlist = {
  /**
   * The number of segments that are unsafe to start playback at in
   * a live stream. Changing this value can cause playback stalls.
   * See HTTP Live Streaming, "Playing the Media Playlist File"
   * https://tools.ietf.org/html/draft-pantos-http-live-streaming-18#section-6.3.3
   */
  UNSAFE_LIVE_SEGMENTS: 3
};

/**
 * walk backward until we find a duration we can use
 * or return a failure
 *
 * @param {Playlist} playlist the playlist to walk through
 * @param {Number} endSequence the mediaSequence to stop walking on
 */

const backwardDuration = function(playlist, endSequence) {
  let result = 0;
  let i = endSequence - playlist.mediaSequence;
  // if a start time is available for segment immediately following
  // the interval, use it
  let segment = playlist.segments[i];

  // Walk backward until we find the latest segment with timeline
  // information that is earlier than endSequence
  if (segment) {
    if (typeof segment.start !== 'undefined') {
      return { result: segment.start, precise: true };
    }
    if (typeof segment.end !== 'undefined') {
      return {
        result: segment.end - segment.duration,
        precise: true
      };
    }
  }
  while (i--) {
    segment = playlist.segments[i];
    if (typeof segment.end !== 'undefined') {
      return { result: result + segment.end, precise: true };
    }

    result += segment.duration;

    if (typeof segment.start !== 'undefined') {
      return { result: result + segment.start, precise: true };
    }
  }
  return { result, precise: false };
};

/**
 * walk forward until we find a duration we can use
 * or return a failure
 *
 * @param {Playlist} playlist the playlist to walk through
 * @param {Number} endSequence the mediaSequence to stop walking on
 */
const forwardDuration = function(playlist, endSequence) {
  let result = 0;
  let segment;
  let i = endSequence - playlist.mediaSequence;
  // Walk forward until we find the earliest segment with timeline
  // information

  for (; i < playlist.segments.length; i++) {
    segment = playlist.segments[i];
    if (typeof segment.start !== 'undefined') {
      return {
        result: segment.start - result,
        precise: true
      };
    }

    result += segment.duration;

    if (typeof segment.end !== 'undefined') {
      return {
        result: segment.end - result,
        precise: true
      };
    }

  }
  // indicate we didn't find a useful duration estimate
  return { result: -1, precise: false };
};

/**
  * Calculate the media duration from the segments associated with a
  * playlist. The duration of a subinterval of the available segments
  * may be calculated by specifying an end index.
  *
  * @param {Object} playlist a media playlist object
  * @param {Number=} endSequence an exclusive upper boundary
  * for the playlist.  Defaults to playlist length.
  * @param {Number} expired the amount of time that has dropped
  * off the front of the playlist in a live scenario
  * @return {Number} the duration between the first available segment
  * and end index.
  */
const intervalDuration = function(playlist, endSequence, expired) {
  let backward;
  let forward;

  if (typeof endSequence === 'undefined') {
    endSequence = playlist.mediaSequence + playlist.segments.length;
  }

  if (endSequence < playlist.mediaSequence) {
    return 0;
  }

  // do a backward walk to estimate the duration
  backward = backwardDuration(playlist, endSequence);
  if (backward.precise) {
    // if we were able to base our duration estimate on timing
    // information provided directly from the Media Source, return
    // it
    return backward.result;
  }

  // walk forward to see if a precise duration estimate can be made
  // that way
  forward = forwardDuration(playlist, endSequence);
  if (forward.precise) {
    // we found a segment that has been buffered and so it's
    // position is known precisely
    return forward.result;
  }

  // return the less-precise, playlist-based duration estimate
  return backward.result + expired;
};

/**
  * Calculates the duration of a playlist. If a start and end index
  * are specified, the duration will be for the subset of the media
  * timeline between those two indices. The total duration for live
  * playlists is always Infinity.
  *
  * @param {Object} playlist a media playlist object
  * @param {Number=} endSequence an exclusive upper
  * boundary for the playlist. Defaults to the playlist media
  * sequence number plus its length.
  * @param {Number=} expired the amount of time that has
  * dropped off the front of the playlist in a live scenario
  * @return {Number} the duration between the start index and end
  * index.
  */
export const duration = function(playlist, endSequence, expired) {
  if (!playlist) {
    return 0;
  }

  if (typeof expired !== 'number') {
    expired = 0;
  }

  // if a slice of the total duration is not requested, use
  // playlist-level duration indicators when they're present
  if (typeof endSequence === 'undefined') {
    // if present, use the duration specified in the playlist
    if (playlist.totalDuration) {
      return playlist.totalDuration;
    }

    // duration should be Infinity for live playlists
    if (!playlist.endList) {
      return window.Infinity;
    }
  }

  // calculate the total duration based on the segment durations
  return intervalDuration(playlist,
                          endSequence,
                          expired);
};

/**
  * Calculates the interval of time that is currently seekable in a
  * playlist. The returned time ranges are relative to the earliest
  * moment in the specified playlist that is still available. A full
  * seekable implementation for live streams would need to offset
  * these values by the duration of content that has expired from the
  * stream.
  *
  * @param {Object} playlist a media playlist object
  * @param {Number=} expired the amount of time that has
  * dropped off the front of the playlist in a live scenario
  * @return {TimeRanges} the periods of time that are valid targets
  * for seeking
  */
export const seekable = function(playlist, expired) {
  let start;
  let end;
  let endSequence;

  if (typeof expired !== 'number') {
    expired = 0;
  }

  // without segments, there are no seekable ranges
  if (!playlist || !playlist.segments) {
    return createTimeRange();
  }
  // when the playlist is complete, the entire duration is seekable
  if (playlist.endList) {
    return createTimeRange(0, duration(playlist));
  }

  // live playlists should not expose three segment durations worth
  // of content from the end of the playlist
  // https://tools.ietf.org/html/draft-pantos-http-live-streaming-16#section-6.3.3
  start = intervalDuration(playlist, playlist.mediaSequence, expired);
  endSequence = Math.max(0, playlist.segments.length - Playlist.UNSAFE_LIVE_SEGMENTS);
  end = intervalDuration(playlist,
                         playlist.mediaSequence + endSequence,
                         expired);
  return createTimeRange(start, end);
};

/**
 * Determine the index of the segment that contains a specified
 * playback position in a media playlist.
 *
 * @param {Object} playlist the media playlist to query
 * @param {Number} time The number of seconds since the earliest
 * possible position to determine the containing segment for
 * @param {Number=} expired the duration of content, in
 * seconds, that has been removed from this playlist because it
 * expired
 * @return {Number} The number of the media segment that contains
 * that time position.
 */
export const getMediaIndexForTime_ = function(playlist, time, expired) {
  let i;
  let segment;
  let originalTime = time;
  let numSegments = playlist.segments.length;
  let lastSegment = numSegments - 1;
  let startIndex;
  let endIndex;
  let knownStart;
  let knownEnd;

  if (!playlist) {
    return 0;
  }

  // when the requested position is earlier than the current set of
  // segments, return the earliest segment index
  if (time < 0) {
    return 0;
  }

  if (time === 0 && !expired) {
    return 0;
  }

  expired = expired || 0;

  // find segments with known timing information that bound the
  // target time
  for (i = 0; i < numSegments; i++) {
    segment = playlist.segments[i];
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

  // time was equal to or past the end of the last segment in the playlist
  if (startIndex === numSegments) {
    return numSegments;
  }

  // use the bounds we just found and playlist information to
  // estimate the segment that contains the time we are looking for
  if (typeof startIndex !== 'undefined') {
    // We have a known-start point that is before our desired time so
    // walk from that point forwards
    time = time - knownStart;
    for (i = startIndex; i < (endIndex || numSegments); i++) {
      segment = playlist.segments[i];
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
  } else if (typeof endIndex !== 'undefined') {
    // We _only_ have a known-end point that is after our desired time so
    // walk from that point backwards
    time = knownEnd - time;
    for (i = endIndex; i >= 0; i--) {
      segment = playlist.segments[i];
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
  time = time - expired;

  if (time < 0) {
    return -1;
  }

  for (i = 0; i < numSegments; i++) {
    segment = playlist.segments[i];
    time -= segment.duration;
    if (time < 0) {
      return i;
    }
  }
  // We are out of possible candidates so load the last one...
  // The last one is the least likely to overlap a buffer and therefore
  // the one most likely to tell us something about the timeline
  return lastSegment;
};

Playlist.duration = duration;
Playlist.seekable = seekable;
Playlist.getMediaIndexForTime_ = getMediaIndexForTime_;

// exports
export default Playlist;

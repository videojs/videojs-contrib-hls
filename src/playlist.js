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
  * Calculate the time between two indexes in the current playlist
  * neight the start- nor the end-index need to be within the current
  * playlist in which case, the targetDuration of the playlist is used
  * to approximate the durations of the segments
  *
  * @param {Object} playlist a media playlist object
  * @param {Number} startIndex
  * @param {Number} endIndex
  * @return {Number} the number of seconds between startIndex and endIndex
  */
export const sumDurations = function(playlist, startIndex, endIndex) {
  let durations = 0;

  if (startIndex > endIndex) {
    [startIndex, endIndex] = [endIndex, startIndex];
  }

  if (startIndex < 0) {
    for (let i = startIndex; i < Math.min(0, endIndex); i++) {
      durations += playlist.targetDuration;
    }
    startIndex = 0;
  }

  for (let i = startIndex; i < endIndex; i++) {
    durations += playlist.segments[i].duration;
  }

  return durations;
};

/**
 * Returns an array with two sync points. The first being an expired sync point, which is
 * the most recent segment with timing sync data that has fallen off the playlist. The
 * second is a segment sync point, which is the first segment that has timing sync data in
 * the current playlist.
 *
 * @param {Object} playlist a media playlist object
 * @returns {Object} an object containing the two sync points
 * @returns {Object.expiredSync|null} sync point data from an expired segment
 * @returns {Object.segmentSync|null} sync point data from a segment in the playlist
 * @function getPlaylistSyncPoints
 */
const getPlaylistSyncPoints = function(playlist) {
  if (!playlist || !playlist.segments) {
    return [null, null];
  }

  let expiredSync = playlist.syncInfo || null;

  let segmentSync = null;

  // Find the first segment with timing information
  for (let i = 0, l = playlist.segments.length; i < l; i++) {
    let segment = playlist.segments[i];

    if (typeof segment.start !== 'undefined') {
      segmentSync = {
        mediaSequence: playlist.mediaSequence + i,
        time: segment.start
      };
      break;
    }
  }

  return { expiredSync, segmentSync };
};

/**
 * Calculates the amount of time expired from the playlist based on the provided
 * sync points.
 *
 * @param {Object} playlist a media playlist object
 * @param {Object|null} expiredSync sync point representing most recent segment with
 *                                  timing sync data that has fallen off the playlist
 * @param {Object|null} segmentSync sync point representing the first segment that has
 *                                  timing sync data in the playlist
 * @returns {Number} the amount of time expired from the playlist
 * @function calculateExpiredTime
 */
const calculateExpiredTime = function(playlist, expiredSync, segmentSync) {
  // If we have both an expired sync point and a segment sync point
  // determine which sync point is closest to the start of the playlist
  // so the minimal amount of timing estimation is done.
  if (expiredSync && segmentSync) {
    let expiredDiff = expiredSync.mediaSequence - playlist.mediaSequence;
    let segmentDiff = segmentSync.mediaSequence - playlist.mediaSequence;
    let syncIndex;
    let syncTime;

    if (Math.abs(expiredDiff) > Math.abs(segmentDiff)) {
      syncIndex = segmentDiff;
      syncTime = -segmentSync.time;
    } else {
      syncIndex = expiredDiff;
      syncTime = expiredSync.time;
    }

    return Math.abs(syncTime + sumDurations(playlist, syncIndex, 0));
  }

  // We only have an expired sync point, so base expired time on the expired sync point
  // and estimate the time from that sync point to the start of the playlist.
  if (expiredSync) {
    let syncIndex = expiredSync.mediaSequence - playlist.mediaSequence;

    return expiredSync.time + sumDurations(playlist, syncIndex, 0);
  }

  // We only have a segment sync point, so base expired time on the first segment we have
  // sync point data for and estimate the time from that media index to the start of the
  // playlist.
  if (segmentSync) {
    let syncIndex = segmentSync.mediaSequence - playlist.mediaSequence;

    return segmentSync.time - sumDurations(playlist, syncIndex, 0);
  }
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
  * dropped off the front of the playlist in a live scenario
  * @return {TimeRanges} the periods of time that are valid targets
  * for seeking
  */
export const seekable = function(playlist) {
  // without segments, there are no seekable ranges
  if (!playlist || !playlist.segments) {
    return createTimeRange();
  }
  // when the playlist is complete, the entire duration is seekable
  if (playlist.endList) {
    return createTimeRange(0, duration(playlist));
  }

  let { expiredSync, segmentSync } = getPlaylistSyncPoints(playlist);

  // We have no sync information for this playlist so we can't create a seekable range
  if (!expiredSync && !segmentSync) {
    return createTimeRange();
  }

  let expired = calculateExpiredTime(playlist, expiredSync, segmentSync);

  // live playlists should not expose three segment durations worth
  // of content from the end of the playlist
  // https://tools.ietf.org/html/draft-pantos-http-live-streaming-16#section-6.3.3
  let start = expired;
  let endSequence = Math.max(0, playlist.segments.length - Playlist.UNSAFE_LIVE_SEGMENTS);
  let end = intervalDuration(playlist,
                             playlist.mediaSequence + endSequence,
                             expired);

  return createTimeRange(start, end);
};

const isWholeNumber = function(num) {
  return (num - Math.floor(num)) === 0;
};

const roundSignificantDigit = function(increment, num) {
  // If we have a whole number, just add 1 to it
  if (isWholeNumber(num)) {
    return num + (increment * 0.1);
  }

  let numDecimalDigits = num.toString().split('.')[1].length;

  for (let i = 1; i <= numDecimalDigits; i++) {
    let scale = Math.pow(10, i);
    let temp = num * scale;

    if (isWholeNumber(temp) ||
        i === numDecimalDigits) {
      return (temp + increment) / scale;
    }
  }
};

const ceilLeastSignificantDigit = roundSignificantDigit.bind(null, 1);
const floorLeastSignificantDigit = roundSignificantDigit.bind(null, -1);

/**
 * Determine the index and estimated starting time of the segment that
 * contains a specified playback position in a media playlist.
 *
 * @param {Object} playlist the media playlist to query
 * @param {Number} currentTime The number of seconds since the earliest
 * possible position to determine the containing segment for
 * @param {Number} startIndex
 * @param {Number} startTime
 * @return {Object}
 */
export const getMediaInfoForTime_ = function(playlist, currentTime, startIndex, startTime) {
  let i;
  let segment;
  let numSegments = playlist.segments.length;

  let time = currentTime - startTime;

  if (time < 0) {
    // Walk backward from startIndex in the playlist, adding durations
    // until we find a segment that contains `time` and return it
    if (startIndex > 0) {
      for (i = startIndex - 1; i >= 0; i--) {
        segment = playlist.segments[i];
        time += floorLeastSignificantDigit(segment.duration);
        if (time > 0) {
          return {
            mediaIndex: i,
            startTime: startTime - sumDurations(playlist, startIndex, i)
          };
        }
      }
    }
    // We were unable to find a good segment within the playlist
    // so select the first segment
    return {
      mediaIndex: 0,
      startTime: currentTime
    };
  }

  // When startIndex is negative, we first walk forward to first segment
  // adding target durations. If we "run out of time" before getting to
  // the first segment, return the first segment
  if (startIndex < 0) {
    for (i = startIndex; i < 0; i++) {
      time -= playlist.targetDuration;
      if (time < 0) {
        return {
          mediaIndex: 0,
          startTime: currentTime
        };
      }
    }
    startIndex = 0;
  }

  // Walk forward from startIndex in the playlist, subtracting durations
  // until we find a segment that contains `time` and return it
  for (i = startIndex; i < numSegments; i++) {
    segment = playlist.segments[i];
    time -= ceilLeastSignificantDigit(segment.duration);
    if (time < 0) {
      return {
        mediaIndex: i,
        startTime: startTime + sumDurations(playlist, startIndex, i)
      };
    }
  }

  // We are out of possible candidates so load the last one...
  return {
    mediaIndex: numSegments - 1,
    startTime: currentTime
  };
};

Playlist.duration = duration;
Playlist.seekable = seekable;
Playlist.getMediaInfoForTime_ = getMediaInfoForTime_;

// exports
export default Playlist;

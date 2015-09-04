/**
 * Playlist related utilities.
 */
(function(window, videojs) {
  'use strict';

  var DEFAULT_TARGET_DURATION = 10;
  var accumulateDuration, ascendingNumeric, duration, intervalDuration, optionalMin, optionalMax, rangeDuration, seekable;

  // Math.min that will return the alternative input if one of its
  // parameters in undefined
  optionalMin = function(left, right) {
    left = isFinite(left) ? left : Infinity;
    right = isFinite(right) ? right : Infinity;
    return Math.min(left, right);
  };

  // Math.max that will return the alternative input if one of its
  // parameters in undefined
  optionalMax = function(left, right) {
    left = isFinite(left) ? left: -Infinity;
    right = isFinite(right) ? right: -Infinity;
    return Math.max(left, right);
  };

  // Array.sort comparator to sort numbers in ascending order
  ascendingNumeric = function(left, right) {
    return left - right;
  };

  /**
   * Returns the media duration for the segments between a start and
   * exclusive end index. The start and end parameters are interpreted
   * as indices into the currently available segments. This method
   * does not calculate durations for segments that have expired.
   * @param playlist {object} a media playlist object
   * @param start {number} an inclusive lower boundary for the
   * segments to examine.
   * @param end {number} an exclusive upper boundary for the segments
   * to examine.
   * @param includeTrailingTime {boolean} if false, the interval between
   * the final segment and the subsequent segment will not be included
   * in the result
   * @return {number} the duration between the start index and end
   * index in seconds.
   */
  accumulateDuration = function(playlist, start, end, includeTrailingTime) {
    var
      ranges = [],
      rangeEnds = (playlist.discontinuityStarts || []).concat(end),
      result = 0,
      i;

    // short circuit if start and end don't specify a non-empty range
    // of segments
    if (start >= end) {
      return 0;
    }

    // create a range object for each discontinuity sequence
    rangeEnds.sort(ascendingNumeric);
    for (i = 0; i < rangeEnds.length; i++) {
      if (rangeEnds[i] > start) {
        ranges.push({ start: start, end: rangeEnds[i] });
        i++;
        break;
      }
    }
    for (; i < rangeEnds.length; i++) {
      // ignore times ranges later than end
      if (rangeEnds[i] >= end) {
        ranges.push({ start: rangeEnds[i - 1], end: end });
        break;
      }
      ranges.push({ start: ranges[ranges.length - 1].end, end: rangeEnds[i] });
    }

    // add up the durations for each of the ranges
    for (i = 0; i < ranges.length; i++) {
      result += rangeDuration(playlist,
                              ranges[i],
                              i === ranges.length - 1 && includeTrailingTime);
    }

    return result;
  };

  /**
   * Returns the duration of the specified range of segments. The
   * range *must not* cross a discontinuity.
   * @param playlist {object} a media playlist object
   * @param range {object} an object that specifies a starting and
   * ending index into the available segments.
   * @param includeTrailingTime {boolean} if false, the interval between
   * the final segment and the subsequent segment will not be included
   * in the result
   * @return {number} the duration of the range in seconds.
   */
  rangeDuration = function(playlist, range, includeTrailingTime) {
    var
      result = 0,
      targetDuration = playlist.targetDuration || DEFAULT_TARGET_DURATION,
      segment,
      left, right;

    // accumulate while searching for the earliest segment with
    // available PTS information
    for (left = range.start; left < range.end; left++) {
      segment = playlist.segments[left];
      if (segment.minVideoPts !== undefined ||
          segment.minAudioPts !== undefined) {
        break;
      }
      result += segment.duration || targetDuration;
    }

    // see if there's enough information to include the trailing time
    if (includeTrailingTime) {
      segment = playlist.segments[range.end];
      if (segment &&
          (segment.minVideoPts !== undefined ||
           segment.minAudioPts !== undefined)) {
        result += 0.001 *
          (optionalMin(segment.minVideoPts, segment.minAudioPts) -
           optionalMin(playlist.segments[left].minVideoPts,
                    playlist.segments[left].minAudioPts));
        return result;
      }
    }

    // do the same thing while finding the latest segment
    for (right = range.end - 1; right >= left; right--) {
      segment = playlist.segments[right];
      if (segment.maxVideoPts !== undefined ||
          segment.maxAudioPts !== undefined) {
        break;
      }
      result += segment.duration || targetDuration;
    }

    // add in the PTS interval in seconds between them
    if (right >= left) {
      result += 0.001 *
        (optionalMax(playlist.segments[right].maxVideoPts,
                  playlist.segments[right].maxAudioPts) -
         optionalMin(playlist.segments[left].minVideoPts,
                  playlist.segments[left].minAudioPts));
    }

    return result;
  };

  /**
   * Calculate the media duration from the segments associated with a
   * playlist. The duration of a subinterval of the available segments
   * may be calculated by specifying a start and end index.
   *
   * @param playlist {object} a media playlist object
   * @param startSequence {number} (optional) an inclusive lower
   * boundary for the playlist.  Defaults to 0.
   * @param endSequence {number} (optional) an exclusive upper boundary
   * for the playlist.  Defaults to playlist length.
   * @param includeTrailingTime {boolean} if false, the interval between
   * the final segment and the subsequent segment will not be included
   * in the result
   * @return {number} the duration between the start index and end
   * index.
   */
  intervalDuration = function(playlist, startSequence, endSequence, includeTrailingTime) {
    var result = 0, targetDuration, expiredSegmentCount;

    if (startSequence === undefined) {
      startSequence = playlist.mediaSequence || 0;
    }
    if (endSequence === undefined) {
      endSequence = startSequence + (playlist.segments || []).length;
    }
    targetDuration = playlist.targetDuration || DEFAULT_TARGET_DURATION;

    // estimate expired segment duration using the target duration
    expiredSegmentCount = optionalMax(playlist.mediaSequence - startSequence, 0);
    result += expiredSegmentCount * targetDuration;

    // accumulate the segment durations into the result
    result += accumulateDuration(playlist,
                                 startSequence + expiredSegmentCount - playlist.mediaSequence,
                                 endSequence - playlist.mediaSequence,
                                 includeTrailingTime);

    return result;
  };

  /**
   * Calculates the duration of a playlist. If a start and end index
   * are specified, the duration will be for the subset of the media
   * timeline between those two indices. The total duration for live
   * playlists is always Infinity.
   * @param playlist {object} a media playlist object
   * @param startSequence {number} (optional) an inclusive lower
   * boundary for the playlist.  Defaults to 0.
   * @param endSequence {number} (optional) an exclusive upper boundary
   * for the playlist.  Defaults to playlist length.
   * @param includeTrailingTime {boolean} (optional) if false, the interval between
   * the final segment and the subsequent segment will not be included
   * in the result
   * @return {number} the duration between the start index and end
   * index.
   */
  duration = function(playlist, startSequence, endSequence, includeTrailingTime) {
    if (!playlist) {
      return 0;
    }

    if (includeTrailingTime === undefined) {
      includeTrailingTime = true;
    }

    // if a slice of the total duration is not requested, use
    // playlist-level duration indicators when they're present
    if (startSequence === undefined && endSequence === undefined) {
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
                            startSequence,
                            endSequence,
                            includeTrailingTime);
  };

  /**
   * Calculates the interval of time that is currently seekable in a
   * playlist. The returned time ranges are relative to the earliest
   * moment in the specified playlist that is still available. A full
   * seekable implementation for live streams would need to offset
   * these values by the duration of content that has expired from the
   * stream.
   * @param playlist {object} a media playlist object
   * @return {TimeRanges} the periods of time that are valid targets
   * for seeking
   */
  seekable = function(playlist) {
    var start, end, liveBuffer, targetDuration, segment, pending, i;

    // without segments, there are no seekable ranges
    if (!playlist.segments) {
      return videojs.createTimeRange();
    }
    // when the playlist is complete, the entire duration is seekable
    if (playlist.endList) {
      return videojs.createTimeRange(0, duration(playlist));
    }

    start = 0;
    end = intervalDuration(playlist,
                           playlist.mediaSequence,
                           playlist.mediaSequence + playlist.segments.length);
    targetDuration = playlist.targetDuration || DEFAULT_TARGET_DURATION;

    // live playlists should not expose three segment durations worth
    // of content from the end of the playlist
    // https://tools.ietf.org/html/draft-pantos-http-live-streaming-16#section-6.3.3
    if (!playlist.endList) {
      liveBuffer = targetDuration * videojs.Hls.LIVE_SYNC_DURATION_COUNT;
      // walk backward from the last available segment and track how
      // much media time has elapsed until three target durations have
      // been traversed. if a segment is part of the interval being
      // reported, subtract the overlapping portion of its duration
      // from the result.
      for (i = playlist.segments.length - 1; i >= 0 && liveBuffer > 0; i--) {
        segment = playlist.segments[i];
        pending = optionalMin(duration(playlist,
                                       playlist.mediaSequence + i,
                                       playlist.mediaSequence + i + 1),
                           liveBuffer);
        liveBuffer -= pending;
        end -= pending;
      }
    }

    return videojs.createTimeRange(start, end);
  };

  // exports
  videojs.Hls.Playlist = {
    duration: duration,
    seekable: seekable
  };
})(window, window.videojs);

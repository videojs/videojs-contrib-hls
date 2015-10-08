/**
 * Playlist related utilities.
 */
(function(window, videojs) {
  'use strict';

  var DEFAULT_TARGET_DURATION = 10;
  var duration, intervalDuration, optionalMin, optionalMax, seekable;

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
   * @return {number} the duration between the start index and end
   * index.
   */
  intervalDuration = function(playlist, startSequence, endSequence) {
    var result = 0, targetDuration, i, start, end, expiredSegmentCount;

    if (startSequence === undefined) {
      startSequence = playlist.mediaSequence || 0;
    }
    if (endSequence === undefined) {
      endSequence = startSequence + (playlist.segments || []).length;
    }
    targetDuration = playlist.targetDuration || DEFAULT_TARGET_DURATION;

    // accumulate while looking for the latest known segment-timeline mapping
    expiredSegmentCount = optionalMax(playlist.mediaSequence - startSequence, 0);
    start = startSequence + expiredSegmentCount - playlist.mediaSequence;
    end = endSequence - playlist.mediaSequence;
    for (i = end - 1; i >= start; i--) {
      if (playlist.segments[i].end !== undefined) {
        result += playlist.segments[i].end;
        return result;
      }

      result += playlist.segments[i].duration || targetDuration;

      if (playlist.segments[i].start !== undefined) {
        result += playlist.segments[i].start;
        return result;
      }
    }
    // neither a start or end time was found in the interval so we
    // have to estimate the expired duration
    result += expiredSegmentCount * targetDuration;
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
      liveBuffer = targetDuration * 3;
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

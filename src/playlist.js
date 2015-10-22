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
   * may be calculated by specifying an end index.
   *
   * @param playlist {object} a media playlist object
   * @param endSequence {number} (optional) an exclusive upper boundary
   * for the playlist.  Defaults to playlist length.
   * @return {number} the duration between the start index and end
   * index.
   */
  intervalDuration = function(playlist, endSequence) {
    var result = 0, segment, targetDuration, i;

    if (endSequence === undefined) {
      endSequence = playlist.mediaSequence + (playlist.segments || []).length;
    }
    if (endSequence < 0) {
      return 0;
    }
    targetDuration = playlist.targetDuration || DEFAULT_TARGET_DURATION;

    i = endSequence - playlist.mediaSequence;
    // if a start time is available for segment immediately following
    // the interval, use it
    segment = playlist.segments[i];
    // Walk backward until we find the latest segment with timeline
    // information that is earlier than endSequence
    if (segment && segment.start !== undefined) {
      return segment.start;
    }
    while (i--) {
      segment = playlist.segments[i];
      if (segment.end !== undefined) {
        return result + segment.end;
      }

      result += (segment.duration || targetDuration);

      if (segment.start !== undefined) {
        return result + segment.start;
      }
    }
    return result;
  };

  /**
   * Calculates the duration of a playlist. If a start and end index
   * are specified, the duration will be for the subset of the media
   * timeline between those two indices. The total duration for live
   * playlists is always Infinity.
   * @param playlist {object} a media playlist object
   * @param endSequence {number} (optional) an exclusive upper
   * boundary for the playlist.  Defaults to the playlist media
   * sequence number plus its length.
   * @param includeTrailingTime {boolean} (optional) if false, the
   * interval between the final segment and the subsequent segment
   * will not be included in the result
   * @return {number} the duration between the start index and end
   * index.
   */
  duration = function(playlist, endSequence, includeTrailingTime) {
    if (!playlist) {
      return 0;
    }

    if (includeTrailingTime === undefined) {
      includeTrailingTime = true;
    }

    // if a slice of the total duration is not requested, use
    // playlist-level duration indicators when they're present
    if (endSequence === undefined) {
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
    var start, end;

    // without segments, there are no seekable ranges
    if (!playlist.segments) {
      return videojs.createTimeRange();
    }
    // when the playlist is complete, the entire duration is seekable
    if (playlist.endList) {
      return videojs.createTimeRange(0, duration(playlist));
    }

    // live playlists should not expose three segment durations worth
    // of content from the end of the playlist
    // https://tools.ietf.org/html/draft-pantos-http-live-streaming-16#section-6.3.3
    start = intervalDuration(playlist, playlist.mediaSequence);
    end = intervalDuration(playlist,
                           playlist.mediaSequence + playlist.segments.length);
    end -= (playlist.targetDuration || DEFAULT_TARGET_DURATION) * 3;
    end = Math.max(0, end);
    return videojs.createTimeRange(start, end);
  };

  // exports
  videojs.Hls.Playlist = {
    duration: duration,
    seekable: seekable
  };
})(window, window.videojs);

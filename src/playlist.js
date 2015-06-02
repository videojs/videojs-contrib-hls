/**
 * Playlist related utilities.
 */
(function(window, videojs) {
  'use strict';

  var DEFAULT_TARGET_DURATION = 10;
  var duration, seekable, segmentsDuration;

  /**
   * Calculate the media duration from the segments associated with a
   * playlist. The duration of a subinterval of the available segments
   * may be calculated by specifying a start and end index. The
   * minimum recommended live buffer is automatically subtracted for
   * the last segments of live playlists.
   * @param playlist {object} a media playlist object
   * @param startIndex {number} (optional) an inclusive lower
   * boundary for the playlist.  Defaults to 0.
   * @param endIndex {number} (optional) an exclusive upper boundary
   * for the playlist.  Defaults to playlist length.
   * @return {number} the duration between the start index and end
   * index.
   */
  segmentsDuration = function(playlist, startIndex, endIndex) {
    var targetDuration, i, segment, result = 0;

    startIndex = startIndex || 0;
    endIndex = endIndex !== undefined ? endIndex : (playlist.segments || []).length;
    targetDuration = playlist.targetDuration || DEFAULT_TARGET_DURATION;

    for (i = endIndex - 1; i >= startIndex; i--) {
      segment = playlist.segments[i];
      result += segment.preciseDuration ||
                segment.duration ||
                targetDuration;
    }

    // live playlists should not expose three segment durations worth
    // of content from the end of the playlist
    // https://tools.ietf.org/html/draft-pantos-http-live-streaming-16#section-6.3.3
    if (!playlist.endList) {
      result -= targetDuration * (3 - (playlist.segments.length - endIndex));
    }

    return result;
  };

  /**
   * Calculates the duration of a playlist. If a start and end index
   * are specified, the duration will be for the subset of the media
   * timeline between those two indices. The total duration for live
   * playlists is always Infinity.
   * @param playlist {object} a media playlist object
   * @param startIndex {number} (optional) an inclusive lower
   * boundary for the playlist.  Defaults to 0.
   * @param endIndex {number} (optional) an exclusive upper boundary
   * for the playlist.  Defaults to playlist length.
   * @return {number} the duration between the start index and end
   * index.
   */
  duration = function(playlist, startIndex, endIndex) {
    if (!playlist) {
      return 0;
    }

    // if a slice of the total duration is not requested, use
    // playlist-level duration indicators when they're present
    if (startIndex === undefined && endIndex === undefined) {
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
    return segmentsDuration(playlist,
                            startIndex,
                            endIndex);
  };

  /**
   * Calculates the interval of time that is currently seekable in a
   * playlist.
   * @param playlist {object} a media playlist object
   * @return {TimeRanges} the periods of time that are valid targets
   * for seeking
   */
  seekable = function(playlist) {
    var startOffset, targetDuration;
    // without segments, there are no seekable ranges
    if (!playlist.segments) {
      return videojs.createTimeRange();
    }
    // when the playlist is complete, the entire duration is seekable
    if (playlist.endList) {
      return videojs.createTimeRange(0, duration(playlist));
    }

    targetDuration = playlist.targetDuration || DEFAULT_TARGET_DURATION;
    startOffset = targetDuration * (playlist.mediaSequence || 0);
    return videojs.createTimeRange(startOffset,
                                   startOffset + segmentsDuration(playlist));
  };

  // exports
  videojs.Hls.Playlist = {
    duration: duration,
    seekable: seekable
  };
})(window, window.videojs);

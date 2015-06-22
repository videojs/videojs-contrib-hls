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
  segmentsDuration = function(playlist, startSequence, endSequence) {
    var targetDuration, i, j, segment, endSegment, expiredSegmentCount, result = 0;

    startSequence = startSequence || 0;
    i = startSequence;
    endSequence = endSequence !== undefined ? endSequence : (playlist.segments || []).length;
    targetDuration = playlist.targetDuration || DEFAULT_TARGET_DURATION;

    // estimate expired segment duration using the target duration
    expiredSegmentCount = Math.max(playlist.mediaSequence - startSequence, 0);
    result += expiredSegmentCount * targetDuration;
    i += expiredSegmentCount;

    // accumulate the segment durations into the result
    for (; i < endSequence; i++) {
      segment = playlist.segments[i - playlist.mediaSequence];

      // when PTS values aren't available, use information from the playlist
      if (segment.minVideoPts === undefined) {
        result += segment.duration ||
                  targetDuration;
        continue;
      }

      // find the last segment with PTS info and use that to calculate
      // the interval duration
      for(j = i; j < endSequence - 1; j++) {
        endSegment = playlist.segments[j - playlist.mediaSequence + 1];
        if (endSegment.maxVideoPts === undefined ||
            endSegment.discontinuity) {
          break;
        }
      }
      endSegment = playlist.segments[j - playlist.mediaSequence];
      result += (Math.max(endSegment.maxVideoPts, endSegment.maxAudioPts) -
                 Math.min(segment.minVideoPts, segment.minAudioPts)) * 0.001;
      i = j;
    }

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
   * @return {number} the duration between the start index and end
   * index.
   */
  duration = function(playlist, startSequence, endSequence) {
    if (!playlist) {
      return 0;
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
    return segmentsDuration(playlist,
                            startSequence,
                            endSequence);
  };

  /**
   * Calculates the interval of time that is currently seekable in a
   * playlist.
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

    start = segmentsDuration(playlist, 0, playlist.mediaSequence);
    end = start + segmentsDuration(playlist,
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
        pending = Math.min(segment.preciseDuration ||
                           segment.duration ||
                           targetDuration,
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

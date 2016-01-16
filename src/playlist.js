/**
 * Playlist related utilities.
 */
(function(window, videojs) {
  'use strict';

  var duration, intervalDuration, backwardDuration, forwardDuration,
      seekable, getMediaIndexForTime;

  backwardDuration = function(playlist, endSequence) {
    var result = 0, segment, i;

    i = endSequence - playlist.mediaSequence;
    // if a start time is available for segment immediately following
    // the interval, use it
    segment = playlist.segments[i];
    // Walk backward until we find the latest segment with timeline
    // information that is earlier than endSequence
    if (segment) {
      if (segment.start !== undefined) {
        return { result: segment.start, precise: true };
      }
      if (segment.end !== undefined) {
        return {
          result: segment.end - segment.duration,
          precise: true
        };
      }
    }
    while (i--) {
      segment = playlist.segments[i];
      if (segment.end !== undefined) {
        return { result: result + segment.end, precise: true };
      }

      result += segment.duration;

      if (segment.start !== undefined) {
        return { result: result + segment.start, precise: true };
      }
    }
    return { result: result, precise: false };
  };

  forwardDuration = function(playlist, endSequence) {
    var result = 0, segment, i;

    i = endSequence - playlist.mediaSequence;
    // Walk forward until we find the earliest segment with timeline
    // information
    for (; i < playlist.segments.length; i++) {
      segment = playlist.segments[i];
      if (segment.start !== undefined) {
        return {
          result: segment.start - result,
          precise: true
        };
      }

      result += segment.duration;

      if (segment.end !== undefined) {
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
   * @param playlist {object} a media playlist object
   * @param endSequence {number} (optional) an exclusive upper boundary
   * for the playlist.  Defaults to playlist length.
   * @return {number} the duration between the first available segment
   * and end index.
   */
  intervalDuration = function(playlist, endSequence) {
    var backward, forward;

    if (endSequence === undefined) {
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
    return backward.result;
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
                           playlist.mediaSequence + Math.max(0, playlist.segments.length - 3));
    return videojs.createTimeRange(start, end);
  };

  /**
   * Determine the index of the segment that contains a specified
   * playback position in a media playlist.
   *
   * @param playlist {object} the media playlist to query
   * @param time {number} The number of seconds since the earliest
   * possible position to determine the containing segment for
   * @param expired (optional) {number} the duration of content, in
   * seconds, that has been removed from this playlist because it
   * expired
   * @return {number} The number of the media segment that contains
   * that time position.
   */
  getMediaIndexForTime = function(playlist, time, expired) {
    var
      i,
      segment,
      originalTime = time,
      numSegments = playlist.segments.length,
      lastSegment = numSegments - 1,
      startIndex,
      endIndex,
      knownStart,
      knownEnd;

    if (!playlist) {
      return 0;
    }

    // when the requested position is earlier than the current set of
    // segments, return the earliest segment index
    if (time < 0) {
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

    // use the bounds we just found and playlist information to
    // estimate the segment that contains the time we are looking for
    if (startIndex !== undefined) {
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
    } else if (endIndex !== undefined) {
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
      } else {
        return -1;
      }
    } else {
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
    }
  };

  // exports
  videojs.Hls.Playlist = {
    duration: duration,
    seekable: seekable,
    getMediaIndexForTime_: getMediaIndexForTime
  };
})(window, window.videojs);

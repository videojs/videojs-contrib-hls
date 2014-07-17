/**
 * Playlist related functions
 */
(function(window, videojs) {
  'use strict';

  /**
   * The main Playlist object
   * @type {Object}
   */
  videojs.Hls.Playlist = {};

  /**
   * Chooses the appropriate media playlist based on the current
   * bandwidth estimate and the player size.
   * @return the highest bitrate playlist less than the currently detected
   * bandwidth, accounting for some amount of bandwidth variance
   */
  videojs.Hls.Playlist.selectPlaylist = function (playlists, data) {
    var lowestVariant, bandwidthBestVariant, resolutionBestVariant;

    // make a copy of the playlist array so we're not editing the original
    playlists = playlists.slice();
    data = data || {};

    // sort by bandwidth
    playlists.sort(videojs.Hls.Playlist.compareBandwidth);
    // store the lowest variant as a fallback
    lowestVariant = playlists[0];
    // filter out bandwidths that are too high
    playlists = videojs.Hls.Playlist.filterByBandwidth(playlists, data.bandwidth);
    // select the highest bandwidth variant
    bandwidthBestVariant = playlists[playlists.length-1];
    // sort the resulting playlists by resolution
    playlists.sort(videojs.Hls.Playlist.compareResolution);
    // filter out any that are too big
    playlists = videojs.Hls.Playlist.filterByResolution(playlists, data.width, data.height);
    // pick the highest resolution available
    resolutionBestVariant = playlists[playlists.length-1];

    // fallback chain of variants
    return resolutionBestVariant || bandwidthBestVariant || lowestVariant;
  };

  /**
   * A comparator function to sort two playlist object by bandwidth.
   * @param left {object} a media playlist object
   * @param right {object} a media playlist object
   * @return {number} Greater than zero if the bandwidth attribute of
   * left is greater than the corresponding attribute of right. Less
   * than zero if the bandwidth of right is greater than left and
   * exactly zero if the two are equal.
   */
  videojs.Hls.Playlist.compareBandwidth = function(left, right) {
    var leftBandwidth, rightBandwidth;
    if (left.attributes && left.attributes.BANDWIDTH) {
      leftBandwidth = left.attributes.BANDWIDTH;
    }
    leftBandwidth = leftBandwidth || window.Number.MAX_VALUE;
    if (right.attributes && right.attributes.BANDWIDTH) {
      rightBandwidth = right.attributes.BANDWIDTH;
    }
    rightBandwidth = rightBandwidth || window.Number.MAX_VALUE;

    return leftBandwidth - rightBandwidth;
  };

  videojs.Hls.Playlist.filterByBandwidth = function(playlists, maxBandwidth){
    var i, j, variant, bandwidthVariance, filtered;

    // default to no max bandwidth
    maxBandwidth = maxBandwidth || window.Infinity;

    // a fudge factor to apply to advertised playlist bitrates to account for
    // temporary flucations in client bandwidth
    bandwidthVariance = 1.1;

    // filter out any variant that has greater effective bitrate
    // than the current estimated bandwidth
    filtered = [];
    j = playlists.length;
    for (i=0; i<j; i++) {
      variant = playlists[i];

      if (variant.attributes && variant.attributes.BANDWIDTH) {
        if ((variant.attributes.BANDWIDTH * bandwidthVariance) < maxBandwidth) {
          filtered.push(variant);
        }
      }
    }

    return filtered;
  };

  /**
   * A comparator function to sort two playlist object by resolution (width).
   * @param left {object} a media playlist object
   * @param right {object} a media playlist object
   * @return {number} Greater than zero if the resolution.width attribute of
   * left is greater than the corresponding attribute of right. Less
   * than zero if the resolution.width of right is greater than left and
   * exactly zero if the two are equal.
   */
  videojs.Hls.Playlist.compareResolution = function(left, right) {
    var leftWidth, rightWidth;

    if (left.attributes && left.attributes.RESOLUTION && left.attributes.RESOLUTION.width) {
      leftWidth = left.attributes.RESOLUTION.width;
    }

    leftWidth = leftWidth || window.Number.MAX_VALUE;

    if (right.attributes && right.attributes.RESOLUTION && right.attributes.RESOLUTION.width) {
      rightWidth = right.attributes.RESOLUTION.width;
    }

    rightWidth = rightWidth || window.Number.MAX_VALUE;

    // NOTE - Fallback to bandwidth sort as appropriate in cases where multiple renditions
    // have the same media dimensions/ resolution
    if (leftWidth === rightWidth && left.attributes.BANDWIDTH && right.attributes.BANDWIDTH) {
      return left.attributes.BANDWIDTH - right.attributes.BANDWIDTH;
    } else {
      return leftWidth - rightWidth;
    }
  };

  videojs.Hls.Playlist.filterByResolution = function(playlists, maxWidth, maxHeight){
    var i, j, filtered, variant;

    maxWidth = maxWidth || window.Infinity;
    maxHeight = maxHeight || window.Infinity;

    // iterate through the bandwidth-filtered playlists and find
    // best rendition by player dimension
    filtered = [];
    j = playlists.length;
    for (i=0; i<j; i++) {
      variant = playlists[i];

      // ignore playlists without resolution information
      if (variant.attributes && 
          variant.attributes.RESOLUTION &&
          variant.attributes.RESOLUTION.width &&
          variant.attributes.RESOLUTION.height &&
          variant.attributes.RESOLUTION.width <= maxWidth &&
          variant.attributes.RESOLUTION.height <= maxHeight) {
            filtered.push(variant);
      }
    }

    return filtered;
  };

  /**
   * TODO - Document this great feature.
   *
   * @param playlist
   * @param time
   * @returns int
   */
  videojs.Hls.Playlist.getSegmentIndexByTime = function(playlist, time) {
    var index, counter, timeRanges, currentSegmentRange;

    timeRanges = [];
    for (index = 0; index < playlist.segments.length; index++) {
      currentSegmentRange = {};
      currentSegmentRange.start = (index === 0) ? 0 : timeRanges[index - 1].end;
      currentSegmentRange.end = currentSegmentRange.start + playlist.segments[index].duration;
      timeRanges.push(currentSegmentRange);
    }

    for (counter = 0; counter < timeRanges.length; counter++) {
      if (time >= timeRanges[counter].start && time < timeRanges[counter].end) {
        return counter;
      }
    }

    return -1;
  };

  /**
   * Determine the segment index in one playlist that corresponds to a
   * specified segment index in another. This function can be used to
   * calculate a new segment position when a playlist is reloaded or a
   * variant playlist is becoming active.
   * @param segmentIndex {number} the index into the original playlist
   * to translate
   * @param original {object} the playlist to translate the media
   * index from
   * @param update {object} the playlist to translate the segment index
   * to
   * @param {number} the corresponding segment index in the updated
   * playlist
   */
  videojs.Hls.Playlist.translateSegmentIndex = function(segmentIndex, original, update) {
    var
      i,
      originalSegment;

    // no segments have been loaded from the original playlist
    if (segmentIndex === 0) {
      return 0;
    }

    // let the segment index be zero when there are no segments defined
    if (!update || !update.segments) {
      return 0;
    }

    // try to sync based on URI for live streams where the index may be shifting
    i = update.segments.length;
    originalSegment = original.segments[segmentIndex - 1];
    while (i--) {
      if (originalSegment.uri === update.segments[i].uri) {
        return i + 1;
      }
    }

    // sync based on media sequence -- the number of segments before this playlist
    return (original.mediaSequence + segmentIndex) - update.mediaSequence;
  };

  /**
   * Calculate the duration of a playlist from a given start index to a given
   * end index.
   * @param playlist {object} a media playlist object
   * @param startIndex {number} an inclusive lower boundary for the playlist.
   * Defaults to 0.
   * @param endIndex {number} an exclusive upper boundary for the playlist.
   * Defaults to playlist length.
   * @return {number} the duration between the start index and end index.
   */
  videojs.Hls.Playlist.getDuration = function(playlist, startIndex, endIndex) {
    var dur = 0,
        segment,
        i;

    startIndex = startIndex || 0;
    endIndex = endIndex !== undefined ? endIndex : (playlist.segments || []).length;
    i = endIndex - 1;

    for (; i >= startIndex; i--) {
      segment = playlist.segments[i];
      dur += segment.duration || playlist.targetDuration || 0;
    }

    return dur;
  };

  /**
   * Calculate the total duration for a playlist based on segment metadata.
   * @param playlist {object} a media playlist object
   * @return {number} the currently known duration, in seconds
   */
  videojs.Hls.Playlist.getTotalDuration = function(playlist) {
    if (!playlist) {
      return 0;
    }

    // if present, use the duration specified in the playlist
    if (playlist.totalDuration) {
      return playlist.totalDuration;
    }

    // duration should be Infinity for live playlists
    if (!playlist.endList) {
      return window.Infinity;
    }

    return videojs.Hls.Playlist.getDuration(playlist);
  };

})(window, window.videojs);
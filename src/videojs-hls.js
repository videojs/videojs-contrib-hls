/*
 * videojs-hls
 *
 * Copyright (c) 2014 Brightcove
 * All rights reserved.
 */

(function(window, videojs, document, undefined) {
'use strict';

var
  // a fudge factor to apply to advertised playlist bitrates to account for
  // temporary flucations in client bandwidth
  bandwidthVariance = 1.1,
  keyXhr,
  keyFailed,
  resolveUrl;

// returns true if a key has failed to download within a certain amount of retries
keyFailed = function(key) {
  return key.retries && key.retries >= 2;
};

videojs.Hls = videojs.Flash.extend({
  init: function(player, options, ready) {
    var
      source = options.source,
      settings = player.options();

    player.hls = this;
    delete options.source;
    options.swf = settings.flash.swf;
    videojs.Flash.call(this, player, options, ready);
    options.source = source;
    this.bytesReceived = 0;

    // TODO: After video.js#1347 is pulled in remove these lines
    this.currentTime = videojs.Hls.prototype.currentTime;
    this.setCurrentTime = videojs.Hls.prototype.setCurrentTime;

    videojs.Hls.prototype.src.call(this, options.source && options.source.src);
  }
});

// Add HLS to the standard tech order
videojs.options.techOrder.unshift('hls');

// the desired length of video to maintain in the buffer, in seconds
videojs.Hls.GOAL_BUFFER_LENGTH = 30;

videojs.Hls.prototype.src = function(src) {
  var
    tech = this,
    mediaSource,
    source;

  // do nothing if the src is falsey
  if (!src) {
    return;
  }

  // if there is already a source loaded, clean it up
  if (this.src_) {
    this.resetSrc_();
  }

  this.src_ = src;

  mediaSource = new videojs.MediaSource();
  source = {
    src: videojs.URL.createObjectURL(mediaSource),
    type: "video/flv"
  };
  this.mediaSource = mediaSource;

  this.segmentBuffer_ = [];
  this.segmentParser_ = new videojs.Hls.SegmentParser();

  // load the MediaSource into the player
  this.mediaSource.addEventListener('sourceopen', videojs.bind(this, this.handleSourceOpen));

  this.player().ready(function() {
    // do nothing if the tech has been disposed already
    // this can occur if someone sets the src in player.ready(), for instance
    if (!tech.el()) {
      return;
    }
    tech.el().vjs_src(source.src);
  });
};

videojs.Hls.prototype.handleSourceOpen = function() {
  // construct the video data buffer and set the appropriate MIME type
  var
    player = this.player(),
    settings = player.options().hls || {},
    sourceBuffer = this.mediaSource.addSourceBuffer('video/flv; codecs="vp6,aac"'),
    oldMediaPlaylist;

  this.sourceBuffer = sourceBuffer;
  sourceBuffer.appendBuffer(this.segmentParser_.getFlvHeader());

  this.mediaIndex = 0;
  this.playlists = new videojs.Hls.PlaylistLoader(this.src_, settings.withCredentials);

  this.playlists.on('loadedmetadata', videojs.bind(this, function() {
    oldMediaPlaylist = this.playlists.media();

    // periodically check if new data needs to be downloaded or
    // buffered data should be appended to the source buffer
    this.fillBuffer();
    player.on('timeupdate', videojs.bind(this, this.fillBuffer));
    player.on('timeupdate', videojs.bind(this, this.drainBuffer));
    player.on('waiting', videojs.bind(this, this.drainBuffer));

    player.trigger('loadedmetadata');
  }));

  this.playlists.on('error', videojs.bind(this, function() {
    player.error(this.playlists.error);
  }));

  this.playlists.on('loadedplaylist', videojs.bind(this, function() {
    var updatedPlaylist = this.playlists.media();

    if (!updatedPlaylist) {
      // do nothing before an initial media playlist has been activated
      return;
    }

    this.updateDuration(this.playlists.media());
    this.mediaIndex = videojs.Hls.translateMediaIndex(this.mediaIndex, oldMediaPlaylist, updatedPlaylist);
    oldMediaPlaylist = updatedPlaylist;

    this.fetchKeys(updatedPlaylist, this.mediaIndex);
  }));

  this.playlists.on('mediachange', videojs.bind(this, function() {
    // abort outstanding key requests and check if new keys need to be retrieved
    if (keyXhr) {
      keyXhr.abort();
      keyXhr = null;
      this.fetchKeys(this.playlists.media(), this.mediaIndex);
    }

    player.trigger('mediachange');
  }));

  // if autoplay is enabled, begin playback. This is duplicative of
  // code in video.js but is required because play() must be invoked
  // *after* the media source has opened.
  if (player.options().autoplay) {
    player.play();
  }
};

/**
 * Reset the mediaIndex if play() is called after the video has
 * ended.
 */
videojs.Hls.prototype.play = function() {
  if (this.ended()) {
    this.mediaIndex = 0;
  }

  // delegate back to the Flash implementation
  return videojs.Flash.prototype.play.apply(this, arguments);
};

videojs.Hls.prototype.currentTime = function() {
  if (this.lastSeekedTime_) {
    return this.lastSeekedTime_;
  }
  // currentTime is zero while the tech is initializing
  if (!this.el() || !this.el().vjs_getProperty) {
    return 0;
  }
  return this.el().vjs_getProperty('currentTime');
};

videojs.Hls.prototype.setCurrentTime = function(currentTime) {
  if (!(this.playlists && this.playlists.media())) {
    // return immediately if the metadata is not ready yet
    return 0;
  }

  // save the seek target so currentTime can report it correctly
  // while the seek is pending
  this.lastSeekedTime_ = currentTime;

  // determine the requested segment
  this.mediaIndex = videojs.Hls.getMediaIndexByTime(this.playlists.media(), currentTime);

  // abort any segments still being decoded
  this.sourceBuffer.abort();

  // cancel outstanding requests and buffer appends
  if (this.segmentXhr_) {
    this.segmentXhr_.onreadystatechange = null;
    this.segmentXhr_.abort();
    this.segmentXhr_ = null;
  }

  // fetch new encryption keys, if necessary
  if (keyXhr) {
    keyXhr.aborted = true;
    keyXhr.abort();
    keyXhr = null;
    this.fetchKeys(this.playlists.media(), this.mediaIndex);
  }

  // clear out any buffered segments
  this.segmentBuffer_ = [];

  // begin filling the buffer at the new position
  this.fillBuffer(currentTime * 1000);
};

videojs.Hls.prototype.duration = function() {
  var playlists = this.playlists;
  if (playlists) {
    return videojs.Hls.getPlaylistTotalDuration(playlists.media());
  }
  return 0;
};

/**
 * Update the player duration
 */
videojs.Hls.prototype.updateDuration = function(playlist) {
  var player = this.player(),
      oldDuration = player.duration(),
      newDuration = videojs.Hls.getPlaylistTotalDuration(playlist);

  // if the duration has changed, invalidate the cached value
  if (oldDuration !== newDuration) {
    player.trigger('durationchange');
  }
};

/**
 * Clear all buffers and reset any state relevant to the current
 * source. After this function is called, the tech should be in a
 * state suitable for switching to a different video.
 */
videojs.Hls.prototype.resetSrc_ = function() {
  if (this.segmentXhr_) {
    this.segmentXhr_.onreadystatechange = null;
    this.segmentXhr_.abort();
    this.segmentXhr_ = null;
  }
  if (keyXhr) {
    keyXhr.onreadystatechange = null;
    keyXhr.abort();
    keyXhr = null;
  }
  if (this.sourceBuffer) {
    this.sourceBuffer.abort();
  }
};

/**
 * Abort all outstanding work and cleanup.
 */
videojs.Hls.prototype.dispose = function() {
  var player = this.player();

  // remove event handlers
  player.off('timeupdate', this.fillBuffer);
  player.off('timeupdate', this.drainBuffer);
  player.off('waiting', this.drainBuffer);

  if (this.playlists) {
    this.playlists.dispose();
  }

  this.resetSrc_();

  videojs.Flash.prototype.dispose.call(this);
};

/**
 * Chooses the appropriate media playlist based on the current
 * bandwidth estimate and the player size.
 * @return the highest bitrate playlist less than the currently detected
 * bandwidth, accounting for some amount of bandwidth variance
 */
videojs.Hls.prototype.selectPlaylist = function () {
  var
    player = this.player(),
    effectiveBitrate,
    sortedPlaylists = this.playlists.master.playlists.slice(),
    bandwidthPlaylists = [],
    i = sortedPlaylists.length,
    variant,
    bandwidthBestVariant,
    resolutionBestVariant;

  sortedPlaylists.sort(videojs.Hls.comparePlaylistBandwidth);

  // filter out any variant that has greater effective bitrate
  // than the current estimated bandwidth
  while (i--) {
    variant = sortedPlaylists[i];

    // ignore playlists without bandwidth information
    if (!variant.attributes || !variant.attributes.BANDWIDTH) {
      continue;
    }

    effectiveBitrate = variant.attributes.BANDWIDTH * bandwidthVariance;

    if (effectiveBitrate < player.hls.bandwidth) {
      bandwidthPlaylists.push(variant);

      // since the playlists are sorted in ascending order by
      // bandwidth, the first viable variant is the best
      if (!bandwidthBestVariant) {
        bandwidthBestVariant = variant;
      }
    }
  }

  i = bandwidthPlaylists.length;

  // sort variants by resolution
  bandwidthPlaylists.sort(videojs.Hls.comparePlaylistResolution);

  // iterate through the bandwidth-filtered playlists and find
  // best rendition by player dimension
  while (i--) {
    variant = bandwidthPlaylists[i];

    // ignore playlists without resolution information
    if (!variant.attributes ||
        !variant.attributes.RESOLUTION ||
        !variant.attributes.RESOLUTION.width ||
        !variant.attributes.RESOLUTION.height) {
      continue;
    }

    // since the playlists are sorted, the first variant that has
    // dimensions less than or equal to the player size is the
    // best
    if (variant.attributes.RESOLUTION.width <= player.width() &&
        variant.attributes.RESOLUTION.height <= player.height()) {
      resolutionBestVariant = variant;
      break;
    }
  }

  // fallback chain of variants
  return resolutionBestVariant || bandwidthBestVariant || sortedPlaylists[0];
};

/**
 * Determines whether there is enough video data currently in the buffer
 * and downloads a new segment if the buffered time is less than the goal.
 * @param offset (optional) {number} the offset into the downloaded segment
 * to seek to, in milliseconds
 */
videojs.Hls.prototype.fillBuffer = function(offset) {
  var
    player = this.player(),
    buffered = player.buffered(),
    bufferedTime = 0,
    segment,
    segmentUri;

  // if there is a request already in flight, do nothing
  if (this.segmentXhr_) {
    return;
  }

  // if no segments are available, do nothing
  if (this.playlists.state === "HAVE_NOTHING" ||
      !this.playlists.media().segments) {
    return;
  }

  // if the video has finished downloading, stop trying to buffer
  segment = this.playlists.media().segments[this.mediaIndex];
  if (!segment) {
    return;
  }

  if (buffered) {
    // assuming a single, contiguous buffer region
    bufferedTime = player.buffered().end(0) - player.currentTime();
  }

  // if there is plenty of content in the buffer and we're not
  // seeking, relax for awhile
  if (typeof offset !== 'number' && bufferedTime >= videojs.Hls.GOAL_BUFFER_LENGTH) {
    return;
  }

  // resolve the segment URL relative to the playlist
  if (this.playlists.media().uri === this.src_) {
    segmentUri = resolveUrl(this.src_, segment.uri);
  } else {
    segmentUri = resolveUrl(resolveUrl(this.src_, this.playlists.media().uri || ''), segment.uri);
  }

  this.loadSegment(segmentUri, offset);
};

videojs.Hls.prototype.loadSegment = function(segmentUri, offset) {
  var
    tech = this,
    player = this.player(),
    settings = player.options().hls || {},
    startTime = +new Date();

  // request the next segment
  this.segmentXhr_ = videojs.Hls.xhr({
    url: segmentUri,
    responseType: 'arraybuffer',
    withCredentials: settings.withCredentials
  }, function(error, url) {
    // the segment request is no longer outstanding
    tech.segmentXhr_ = null;

    if (error) {
      // if a segment request times out, we may have better luck with another playlist
      if (error === 'timeout') {
        tech.bandwidth = 1;
        return tech.playlists.media(tech.selectPlaylist());
      }
      // otherwise, try jumping ahead to the next segment
      tech.error = {
        status: this.status,
        message: 'HLS segment request error at URL: ' + url,
        code: (this.status >= 500) ? 4 : 2
      };

      // try moving on to the next segment
      tech.mediaIndex++;
      return;
    }

    // stop processing if the request was aborted
    if (!this.response) {
      return;
    }

    // calculate the download bandwidth
    tech.segmentXhrTime = (+new Date()) - startTime;
    tech.bandwidth = (this.response.byteLength / tech.segmentXhrTime) * 8 * 1000;
    tech.bytesReceived += this.response.byteLength;

    // package up all the work to append the segment
    // if the segment is the start of a timestamp discontinuity,
    // we have to wait until the sourcebuffer is empty before
    // aborting the source buffer processing
    tech.segmentBuffer_.push({
      mediaIndex: tech.mediaIndex,
      playlist: tech.playlists.media(),
      offset: offset,
      bytes: new Uint8Array(this.response)
    });
    tech.drainBuffer();

    tech.mediaIndex++;

    // figure out what stream the next segment should be downloaded from
    // with the updated bandwidth information
    tech.playlists.media(tech.selectPlaylist());
  });
};

videojs.Hls.prototype.drainBuffer = function(event) {
  var
    i = 0,
    mediaIndex,
    playlist,
    offset,
    tags,
    bytes,
    segment,

    ptsTime,
    segmentOffset,
    segmentBuffer = this.segmentBuffer_;

  if (!segmentBuffer.length) {
    return;
  }

  mediaIndex = segmentBuffer[0].mediaIndex;
  playlist = segmentBuffer[0].playlist;
  offset = segmentBuffer[0].offset;
  bytes = segmentBuffer[0].bytes;
  segment = playlist.segments[mediaIndex];

  if (segment.key) {
    // this is an encrypted segment
    // if the key download failed, we want to skip this segment
    // but if the key hasn't downloaded yet, we want to try again later
    if (keyFailed(segment.key)) {
      return segmentBuffer.shift();
    } else if (!segment.key.bytes) {
      return;
    } else {
      // if the media sequence is greater than 2^32, the IV will be incorrect
      // assuming 10s segments, that would be about 1300 years
      bytes = videojs.Hls.decrypt(bytes,
                                  segment.key.bytes,
                                  new Uint32Array([
                                    0, 0, 0,
                                    mediaIndex + playlist.mediaSequence]));
    }
  }

  event = event || {};
  segmentOffset = videojs.Hls.getPlaylistDuration(playlist, 0, mediaIndex) * 1000;

  // abort() clears any data queued in the source buffer so wait
  // until it empties before calling it when a discontinuity is
  // next in the buffer
  if (segment.discontinuity) {
    if (event.type !== 'waiting') {
      return;
    }
    this.sourceBuffer.abort();
    // tell the SWF where playback is continuing in the stitched timeline
    this.el().vjs_setProperty('currentTime', segmentOffset * 0.001);
  }

  // transmux the segment data from MP2T to FLV
  this.segmentParser_.parseSegmentBinaryData(bytes);
  this.segmentParser_.flushTags();

  tags = [];
  while (this.segmentParser_.tagsAvailable()) {
    tags.push(this.segmentParser_.getNextTag());
  }

  // if we're refilling the buffer after a seek, scan through the muxed
  // FLV tags until we find the one that is closest to the desired
  // playback time
  if (typeof offset === 'number') {
    ptsTime = offset - segmentOffset + tags[0].pts;

    while (tags[i].pts < ptsTime) {
      i++;
    }

    // tell the SWF where we will be seeking to
    this.el().vjs_setProperty('currentTime', (tags[i].pts - tags[0].pts + segmentOffset) * 0.001);

    tags = tags.slice(i);

    this.lastSeekedTime_ = null;
  }

  for (i = 0; i < tags.length; i++) {
    // queue up the bytes to be appended to the SourceBuffer
    // the queue gives control back to the browser between tags
    // so that large segments don't cause a "hiccup" in playback

    this.sourceBuffer.appendBuffer(tags[i].bytes, this.player());
  }

  // we're done processing this segment
  segmentBuffer.shift();

  // transition the sourcebuffer to the ended state if we've hit the end of
  // the playlist
  if (mediaIndex + 1 === playlist.segments.length) {
    this.mediaSource.endOfStream();
  }
};

videojs.Hls.prototype.fetchKeys = function(playlist, index) {
  var i, key, tech, player, settings, view;

  // if there is a pending XHR or no segments, don't do anything
  if (keyXhr || !playlist.segments) {
    return;
  }

  tech = this;
  player = this.player();
  settings = player.options().hls || {};

  // jshint -W083
  for (i = index; i < playlist.segments.length; i++) {
    key = playlist.segments[i].key;
    if (key && !key.bytes && !keyFailed(key)) {
      keyXhr = videojs.Hls.xhr({
        url: resolveUrl(playlist.uri, key.uri),
        responseType: 'arraybuffer',
        withCredentials: settings.withCredentials
      }, function(err, url) {
        keyXhr = null;

        if (err || !this.response || this.response.byteLength !== 16) {
          key.retries = key.retries || 0;
          key.retries++;
          if (!this.aborted) {
            tech.fetchKeys(playlist, i);
          }
          return;
        }

        view = new DataView(this.response);
        key.bytes = new Uint32Array([
          view.getUint32(0),
          view.getUint32(4),
          view.getUint32(8),
          view.getUint32(12)
        ]);
        tech.fetchKeys(playlist, i++, url);
      });
      break;
    }
  }
  // jshint +W083
};

/**
 * Whether the browser has built-in HLS support.
 */
videojs.Hls.supportsNativeHls = (function() {
  var
    video = document.createElement('video'),
    xMpegUrl,
    vndMpeg;

  // native HLS is definitely not supported if HTML5 video isn't
  if (!videojs.Html5.isSupported()) {
    return false;
  }

  xMpegUrl = video.canPlayType('application/x-mpegURL');
  vndMpeg = video.canPlayType('application/vnd.apple.mpegURL');
  return (/probably|maybe/).test(xMpegUrl) ||
    (/probably|maybe/).test(vndMpeg);
})();

videojs.Hls.isSupported = function() {

  // Only use the HLS tech if native HLS isn't available
  return !videojs.Hls.supportsNativeHls &&
    // Flash must be supported for the fallback to work
    videojs.Flash.isSupported() &&
    // Media sources must be available to stream bytes to Flash
    videojs.MediaSource &&
    // Typed arrays are used to repackage the segments
    window.Uint8Array;
};

videojs.Hls.canPlaySource = function(srcObj) {
  var mpegurlRE = /^application\/(?:x-|vnd\.apple\.)mpegurl/i;
  return mpegurlRE.test(srcObj.type);
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
videojs.Hls.getPlaylistDuration = function(playlist, startIndex, endIndex) {
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
videojs.Hls.getPlaylistTotalDuration = function(playlist) {
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

  return videojs.Hls.getPlaylistDuration(playlist);
};

/**
 * Determine the media index in one playlist that corresponds to a
 * specified media index in another. This function can be used to
 * calculate a new segment position when a playlist is reloaded or a
 * variant playlist is becoming active.
 * @param mediaIndex {number} the index into the original playlist
 * to translate
 * @param original {object} the playlist to translate the media
 * index from
 * @param update {object} the playlist to translate the media index
 * to
 * @param {number} the corresponding media index in the updated
 * playlist
 */
videojs.Hls.translateMediaIndex = function(mediaIndex, original, update) {
  var
    i,
    originalSegment;

  // no segments have been loaded from the original playlist
  if (mediaIndex === 0) {
    return 0;
  }
  if (!(update && update.segments)) {
    // let the media index be zero when there are no segments defined
    return 0;
  }

  // try to sync based on URI
  i = update.segments.length;
  originalSegment = original.segments[mediaIndex - 1];
  while (i--) {
    if (originalSegment.uri === update.segments[i].uri) {
      return i + 1;
    }
  }

  // sync on media sequence
  return (original.mediaSequence + mediaIndex) - update.mediaSequence;
};

/**
 * Determine the media index in one playlist by a time in seconds. This
 * function iterates through the segments of a playlist and creates TimeRange
 * objects for each and then returns the most appropriate segment index by
 * checking the time value versus each range.
 *
 * @param playlist {object} The playlist of the segments being searched.
 * @param time {number} The time in seconds of what segment you want.
 * @returns {number} The media index, or -1 if none appropriate.
 */
videojs.Hls.getMediaIndexByTime = function(playlist, time) {
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
 * A comparator function to sort two playlist object by bandwidth.
 * @param left {object} a media playlist object
 * @param right {object} a media playlist object
 * @return {number} Greater than zero if the bandwidth attribute of
 * left is greater than the corresponding attribute of right. Less
 * than zero if the bandwidth of right is greater than left and
 * exactly zero if the two are equal.
 */
videojs.Hls.comparePlaylistBandwidth = function(left, right) {
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

/**
 * A comparator function to sort two playlist object by resolution (width).
 * @param left {object} a media playlist object
 * @param right {object} a media playlist object
 * @return {number} Greater than zero if the resolution.width attribute of
 * left is greater than the corresponding attribute of right. Less
 * than zero if the resolution.width of right is greater than left and
 * exactly zero if the two are equal.
 */
videojs.Hls.comparePlaylistResolution = function(left, right) {
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

/**
 * Constructs a new URI by interpreting a path relative to another
 * URI.
 * @param basePath {string} a relative or absolute URI
 * @param path {string} a path part to combine with the base
 * @return {string} a URI that is equivalent to composing `base`
 * with `path`
 * @see http://stackoverflow.com/questions/470832/getting-an-absolute-url-from-a-relative-one-ie6-issue
 */
resolveUrl = videojs.Hls.resolveUrl = function(basePath, path) {
  // use the base element to get the browser to handle URI resolution
  var
    oldBase = document.querySelector('base'),
    docHead = document.querySelector('head'),
    a = document.createElement('a'),
    base = oldBase,
    oldHref,
    result;

  // prep the document
  if (oldBase) {
    oldHref = oldBase.href;
  } else {
    base = docHead.appendChild(document.createElement('base'));
  }

  base.href = basePath;
  a.href = path;
  result = a.href;

  // clean up
  if (oldBase) {
    oldBase.href = oldHref;
  } else {
    docHead.removeChild(base);
  }
  return result;
};

})(window, window.videojs, document);

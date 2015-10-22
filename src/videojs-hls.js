/*
 * videojs-hls
 * The main file for the HLS project.
 * License: https://github.com/videojs/videojs-contrib-hls/blob/master/LICENSE
 */
(function(window, videojs, document, undefined) {
'use strict';

var
  // a fudge factor to apply to advertised playlist bitrates to account for
  // temporary flucations in client bandwidth
  bandwidthVariance = 1.1,
  Component = videojs.getComponent('Component'),

  // the amount of time to wait between checking the state of the buffer
  bufferCheckInterval = 500,

  keyFailed,
  resolveUrl;

// returns true if a key has failed to download within a certain amount of retries
keyFailed = function(key) {
  return key.retries && key.retries >= 2;
};

videojs.Hls = videojs.extend(Component, {
  constructor: function(tech, options) {
    var self = this, _player;

    Component.call(this, tech);

    // tech.player() is deprecated but setup a reference to HLS for
    // backwards-compatibility
    if (tech.options_ && tech.options_.playerId) {
      _player = videojs(tech.options_.playerId);
      if (!_player.hls) {
        Object.defineProperty(_player, 'hls', {
          get: function() {
            videojs.log.warn('player.hls is deprecated. Use player.tech.hls instead.');
            return self;
          }
        });
      }
    }
    this.tech_ = tech;
    this.source_ = options.source;
    this.mode_ = options.mode;
    // the segment info object for a segment that is in the process of
    // being downloaded or processed
    this.pendingSegment_ = null;

    this.bytesReceived = 0;

    // loadingState_ tracks how far along the buffering process we
    // have been given permission to proceed. There are three possible
    // values:
    // - none: do not load playlists or segments
    // - meta: load playlists but not segments
    // - segments: load everything
    this.loadingState_ = 'none';
    if (this.tech_.preload() !== 'none') {
      this.loadingState_ = 'meta';
    }

    // periodically check if new data needs to be downloaded or
    // buffered data should be appended to the source buffer
    this.startCheckingBuffer_();

    this.on(this.tech_, 'seeking', function() {
      this.setCurrentTime(this.tech_.currentTime());
    });
    this.on(this.tech_, 'error', function() {
      this.stopCheckingBuffer_();
    });

    this.on(this.tech_, 'play', this.play);
  }
});

// HLS is a source handler, not a tech. Make sure attempts to use it
// as one do not cause exceptions.
videojs.Hls.canPlaySource = function() {
  return videojs.log.warn('HLS is no longer a tech. Please remove it from ' +
                          'your player\'s techOrder.');
};

/**
 * The Source Handler object, which informs video.js what additional
 * MIME types are supported and sets up playback. It is registered
 * automatically to the appropriate tech based on the capabilities of
 * the browser it is running in. It is not necessary to use or modify
 * this object in normal usage.
 */
videojs.HlsSourceHandler = function(mode) {
  return {
    canHandleSource: function(srcObj) {
      var mpegurlRE = /^application\/(?:x-|vnd\.apple\.)mpegurl/i;

      // favor native HLS support if it's available
      if (videojs.Hls.supportsNativeHls) {
        return false;
      }
      return mpegurlRE.test(srcObj.type);
    },
    handleSource: function(source, tech) {
      if (mode === 'flash') {
        // We need to trigger this asynchronously to give others the chance
        // to bind to the event when a source is set at player creation
        tech.setTimeout(function() {
          tech.trigger('loadstart');
        }, 1);
      }
      tech.hls = new videojs.Hls(tech, {
        source: source,
        mode: mode
      });
      tech.hls.src(source.src);
      return tech.hls;
    }
  };
};

// register source handlers with the appropriate techs
if (videojs.MediaSource.supportsNativeMediaSources()) {
  videojs.getComponent('Html5').registerSourceHandler(videojs.HlsSourceHandler('html5'));
}
videojs.getComponent('Flash').registerSourceHandler(videojs.HlsSourceHandler('flash'));

// the desired length of video to maintain in the buffer, in seconds
videojs.Hls.GOAL_BUFFER_LENGTH = 30;

videojs.Hls.prototype.src = function(src) {
  var oldMediaPlaylist;

  // do nothing if the src is falsey
  if (!src) {
    return;
  }

  this.mediaSource = new videojs.MediaSource({ mode: this.mode_ });

  // load the MediaSource into the player
  this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen.bind(this));

  this.options_ = {};
  if (this.source_.withCredentials !== undefined) {
    this.options_.withCredentials = this.source_.withCredentials;
  } else if (videojs.options.hls) {
    this.options_.withCredentials = videojs.options.hls.withCredentials;
  }
  this.playlists = new videojs.Hls.PlaylistLoader(this.source_.src, this.options_.withCredentials);

  this.playlists.on('loadedmetadata', function() {
    oldMediaPlaylist = this.playlists.media();

    // if this isn't a live video and preload permits, start
    // downloading segments
    if (oldMediaPlaylist.endList &&
        this.tech_.preload() !== 'metadata' &&
        this.tech_.preload() !== 'none') {
      this.loadingState_ = 'segments';
    }

    this.setupSourceBuffer_();
    this.setupFirstPlay();
    this.fillBuffer();
    this.tech_.trigger('loadedmetadata');
  }.bind(this));

  this.playlists.on('error', function() {
    // close the media source with the appropriate error type
    if (this.playlists.error.code === 2) {
      this.mediaSource.endOfStream('network');
    } else if (this.playlists.error.code === 4) {
      this.mediaSource.endOfStream('decode');
    }

    // if this error is unrecognized, pass it along to the tech
    this.tech_.error(this.playlists.error);
  }.bind(this));

  this.playlists.on('loadedplaylist', function() {
    var updatedPlaylist = this.playlists.media();

    if (!updatedPlaylist) {
      // select the initial variant
      this.playlists.media(this.selectPlaylist());
      return;
    }

    this.updateDuration(this.playlists.media());
    oldMediaPlaylist = updatedPlaylist;
  }.bind(this));

  this.playlists.on('mediachange', function() {
    this.tech_.trigger({
      type: 'mediachange',
      bubbles: true
    });
  }.bind(this));

  // do nothing if the tech has been disposed already
  // this can occur if someone sets the src in player.ready(), for instance
  if (!this.tech_.el()) {
    return;
  }

  this.tech_.src(videojs.URL.createObjectURL(this.mediaSource));
};

videojs.Hls.prototype.handleSourceOpen = function() {
  // Only attempt to create the source buffer if none already exist.
  // handleSourceOpen is also called when we are "re-opening" a source buffer
  // after `endOfStream` has been called (in response to a seek for instance)
  if (!this.sourceBuffer) {
    this.setupSourceBuffer_();
  }

  // if autoplay is enabled, begin playback. This is duplicative of
  // code in video.js but is required because play() must be invoked
  // *after* the media source has opened.
  // NOTE: moving this invocation of play() after
  // sourceBuffer.appendBuffer() below caused live streams with
  // autoplay to stall
  if (this.tech_.autoplay()) {
    this.play();
  }
};

// Returns the array of time range edge objects that were additively
// modified between two TimeRanges.
videojs.Hls.bufferedAdditions_ = function(original, update) {
  var result = [], edges = [],
      i, inOriginalRanges;

  // if original or update are falsey, return an empty list of
  // additions
  if (!original || !update) {
    return result;
  }

  // create a sorted array of time range start and end times
  for (i = 0; i < original.length; i++) {
    edges.push({ original: true, start: original.start(i) });
    edges.push({ original: true, end: original.end(i) });
  }
  for (i = 0; i < update.length; i++) {
    edges.push({ start: update.start(i) });
    edges.push({ end: update.end(i) });
  }
  edges.sort(function(left, right) {
    var leftTime, rightTime;
    leftTime = left.start !== undefined ? left.start : left.end;
    rightTime = right.start !== undefined ? right.start : right.end;

    // when two times are equal, ensure the original edge covers the
    // update
    if (leftTime === rightTime) {
      if (left.original) {
        return left.start !== undefined ? -1 : 1;
      }
      return right.start !== undefined ? -1 : 1;
    }
    return leftTime - rightTime;
  });

  // filter out all time range edges that occur during a period that
  // was already covered by `original`
  inOriginalRanges = false;
  for (i = 0; i < edges.length; i++) {
    // if this is a transition point for `original`, track whether
    // subsequent edges are additions
    if (edges[i].original) {
      inOriginalRanges = edges[i].start !== undefined;
      continue;
    }
    // if we're in a time range that was in `original`, ignore this edge
    if (inOriginalRanges) {
      continue;
    }
    // this edge occurred outside the range of `original`
    result.push(edges[i]);
  }
  return result;
};

videojs.Hls.prototype.setupSourceBuffer_ = function() {
  var media = this.playlists.media(), mimeType;

  // wait until a media playlist is available and the Media Source is
  // attached
  if (!media || this.mediaSource.readyState !== 'open') {
    return;
  }

  // if the codecs were explicitly specified, pass them along to the
  // source buffer
  mimeType = 'video/mp2t';
  if (media.attributes && media.attributes.CODECS) {
    mimeType += '; codecs="' + media.attributes.CODECS + '"';
  }
  this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);

  // transition the sourcebuffer to the ended state if we've hit the end of
  // the playlist
  this.sourceBuffer.addEventListener('updateend', function() {
    var segmentInfo = this.pendingSegment_, segment, currentBuffered, timelineUpdates;

    this.pendingSegment_ = null;

    // if we've buffered to the end of the video, let the MediaSource know
    currentBuffered = this.findCurrentBuffered_();
    if (currentBuffered.length && this.duration() === currentBuffered.end(0)) {
      this.mediaSource.endOfStream();
    }

    // stop here if the update errored or was aborted
    if (!segmentInfo) {
      return;
    }

    // annotate the segment with any start and end time information
    // added by the media processing
    segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
    timelineUpdates = videojs.Hls.bufferedAdditions_(segmentInfo.buffered,
                                                     this.tech_.buffered());
    timelineUpdates.forEach(function(update) {
      if (update.start !== undefined) {
        segment.start = update.start;
      }
      if (update.end !== undefined) {
        segment.end = update.end;
      }
    });

    if (timelineUpdates.length) {
      this.updateDuration(segmentInfo.playlist);
    }

    // check if it's time to download the next segment
    this.checkBuffer_();
  }.bind(this));
};

/**
 * Seek to the latest media position if this is a live video and the
 * player and video are loaded and initialized.
 */
videojs.Hls.prototype.setupFirstPlay = function() {
  var seekable, media;
  media = this.playlists.media();

  // check that everything is ready to begin buffering

  // 1) the video is a live stream of unknown duration
  if (this.duration() === Infinity &&

      // 2) the player has not played before and is not paused
      this.tech_.played().length === 0 &&
      !this.tech_.paused() &&

      // 3) the Media Source and Source Buffers are ready
      this.sourceBuffer &&

      // 4) the active media playlist is available
      media) {

    // seek to the latest media position for live videos
    seekable = this.seekable();
    if (seekable.length) {
      this.tech_.setCurrentTime(seekable.end(0));
    }
  }
};

/**
 * Begin playing the video.
 */
videojs.Hls.prototype.play = function() {
  this.loadingState_ = 'segments';

  if (this.tech_.ended()) {
    this.tech_.setCurrentTime(0);
  }

  if (this.tech_.played().length === 0) {
    return this.setupFirstPlay();
  }

  // if the viewer has paused and we fell out of the live window,
  // seek forward to the earliest available position
  if (this.duration() === Infinity) {
    if (this.tech_.currentTime() < this.tech_.seekable().start(0)) {
      this.tech_.setCurrentTime(this.tech_.seekable().start(0));
    }
  }
};

videojs.Hls.prototype.setCurrentTime = function(currentTime) {
  var
    buffered = this.findCurrentBuffered_();

  if (!(this.playlists && this.playlists.media())) {
    // return immediately if the metadata is not ready yet
    return 0;
  }

  // it's clearly an edge-case but don't thrown an error if asked to
  // seek within an empty playlist
  if (!this.playlists.media().segments) {
    return 0;
  }

  // if the seek location is already buffered, continue buffering as
  // usual
  if (buffered && buffered.length) {
    return currentTime;
  }

  // cancel outstanding requests and buffer appends
  this.cancelSegmentXhr();

  // abort outstanding key requests, if necessary
  if (this.keyXhr_) {
    this.keyXhr_.aborted = true;
    this.cancelKeyXhr();
  }

  // clear out the segment being processed
  this.pendingSegment_ = null;

  // begin filling the buffer at the new position
  this.fillBuffer(currentTime);
};

videojs.Hls.prototype.duration = function() {
  var playlists = this.playlists;
  if (playlists) {
    return videojs.Hls.Playlist.duration(playlists.media());
  }
  return 0;
};

videojs.Hls.prototype.seekable = function() {
  var media;

  if (!this.playlists) {
    return videojs.createTimeRanges();
  }
  media = this.playlists.media();
  if (!media) {
    return videojs.createTimeRanges();
  }

  return videojs.Hls.Playlist.seekable(media);
};

/**
 * Update the player duration
 */
videojs.Hls.prototype.updateDuration = function(playlist) {
  var oldDuration = this.mediaSource.duration,
      newDuration = videojs.Hls.Playlist.duration(playlist),
      setDuration = function() {
        this.mediaSource.duration = newDuration;
        this.tech_.trigger('durationchange');
        this.mediaSource.removeEventListener('sourceopen', setDuration);
      }.bind(this);

  // if the duration has changed, invalidate the cached value
  if (oldDuration !== newDuration) {
    if (this.mediaSource.readyState === 'open') {
      this.mediaSource.duration = newDuration;
      this.tech_.trigger('durationchange');
    } else {
      this.mediaSource.addEventListener('sourceopen', setDuration);
    }
  }
};

/**
 * Clear all buffers and reset any state relevant to the current
 * source. After this function is called, the tech should be in a
 * state suitable for switching to a different video.
 */
videojs.Hls.prototype.resetSrc_ = function() {
  this.cancelSegmentXhr();
  this.cancelKeyXhr();

  if (this.sourceBuffer) {
    this.sourceBuffer.abort();
  }
};

videojs.Hls.prototype.cancelKeyXhr = function() {
  if (this.keyXhr_) {
    this.keyXhr_.onreadystatechange = null;
    this.keyXhr_.abort();
    this.keyXhr_ = null;
  }
};

videojs.Hls.prototype.cancelSegmentXhr = function() {
  if (this.segmentXhr_) {
    // Prevent error handler from running.
    this.segmentXhr_.onreadystatechange = null;
    this.segmentXhr_.abort();
    this.segmentXhr_ = null;
  }
};

/**
 * Abort all outstanding work and cleanup.
 */
videojs.Hls.prototype.dispose = function() {
  this.stopCheckingBuffer_();

  if (this.playlists) {
    this.playlists.dispose();
  }

  this.resetSrc_();
  Component.prototype.dispose.call(this);
};

/**
 * Chooses the appropriate media playlist based on the current
 * bandwidth estimate and the player size.
 * @return the highest bitrate playlist less than the currently detected
 * bandwidth, accounting for some amount of bandwidth variance
 */
videojs.Hls.prototype.selectPlaylist = function () {
  var
    effectiveBitrate,
    sortedPlaylists = this.playlists.master.playlists.slice(),
    bandwidthPlaylists = [],
    i = sortedPlaylists.length,
    variant,
    oldvariant,
    bandwidthBestVariant,
    resolutionPlusOne,
    resolutionBestVariant,
    width,
    height;

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

    if (effectiveBitrate < this.bandwidth) {
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

  // forget our old variant from above, or we might choose that in high-bandwidth scenarios
  // (this could be the lowest bitrate rendition as  we go through all of them above)
  variant = null;

  width = parseInt(getComputedStyle(this.tech_.el()).width, 10);
  height = parseInt(getComputedStyle(this.tech_.el()).height, 10);

  // iterate through the bandwidth-filtered playlists and find
  // best rendition by player dimension
  while (i--) {
    oldvariant = variant;
    variant = bandwidthPlaylists[i];

    // ignore playlists without resolution information
    if (!variant.attributes ||
        !variant.attributes.RESOLUTION ||
        !variant.attributes.RESOLUTION.width ||
        !variant.attributes.RESOLUTION.height) {
      continue;
    }


    // since the playlists are sorted, the first variant that has
    // dimensions less than or equal to the player size is the best
    if (variant.attributes.RESOLUTION.width === width &&
        variant.attributes.RESOLUTION.height === height) {
      // if we have the exact resolution as the player use it
      resolutionPlusOne = null;
      resolutionBestVariant = variant;
      break;
    } else if (variant.attributes.RESOLUTION.width < width &&
        variant.attributes.RESOLUTION.height < height) {
      // if we don't have an exact match, see if we have a good higher quality variant to use
      if (oldvariant && oldvariant.attributes && oldvariant.attributes.RESOLUTION &&
          oldvariant.attributes.RESOLUTION.width && oldvariant.attributes.RESOLUTION.height) {
        resolutionPlusOne = oldvariant;
      }
      resolutionBestVariant = variant;
      break;
    }
  }

  // fallback chain of variants
  return resolutionPlusOne || resolutionBestVariant || bandwidthBestVariant || sortedPlaylists[0];
};

/**
 * Periodically request new segments and append video data.
 */
videojs.Hls.prototype.checkBuffer_ = function() {
  // calling this method directly resets any outstanding buffer checks
  if (this.checkBufferTimeout_) {
    window.clearTimeout(this.checkBufferTimeout_);
    this.checkBufferTimeout_ = null;
  }

  this.fillBuffer();
  this.drainBuffer();

  // wait awhile and try again
  this.checkBufferTimeout_ = window.setTimeout((this.checkBuffer_).bind(this),
                                               bufferCheckInterval);
};

/**
 * Setup a periodic task to request new segments if necessary and
 * append bytes into the SourceBuffer.
 */
videojs.Hls.prototype.startCheckingBuffer_ = function() {
  // if the player ever stalls, check if there is video data available
  // to append immediately
  this.tech_.on('waiting', (this.drainBuffer).bind(this));

  this.checkBuffer_();
};

/**
 * Stop the periodic task requesting new segments and feeding the
 * SourceBuffer.
 */
videojs.Hls.prototype.stopCheckingBuffer_ = function() {
  if (this.checkBufferTimeout_) {
    window.clearTimeout(this.checkBufferTimeout_);
    this.checkBufferTimeout_ = null;
  }
  this.tech_.off('waiting', this.drainBuffer);
};

/**
 * Attempts to find the buffered TimeRange where playback is currently
 * happening. Returns a new TimeRange with one or zero ranges.
 */
videojs.Hls.prototype.findCurrentBuffered_ = function() {
  var
    tech = this.tech_,
    currentTime = tech.currentTime(),
    buffered = this.tech_.buffered(),
    ranges,
    i;

  if (buffered && buffered.length) {
    // Search for a range containing the play-head
    for (i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= currentTime &&
          buffered.end(i) >= currentTime) {
        ranges = videojs.createTimeRanges(buffered.start(i), buffered.end(i));
        ranges.indexOf = i;
        return ranges;
      }
    }
  }

  // Return an empty range if no ranges exist
  ranges = videojs.createTimeRanges();
  ranges.indexOf = -1;
  return ranges;
};

/**
 * Determines whether there is enough video data currently in the buffer
 * and downloads a new segment if the buffered time is less than the goal.
 * @param seekToTime (optional) {number} the offset into the downloaded segment
 * to seek to, in seconds
 */
videojs.Hls.prototype.fillBuffer = function(seekToTime) {
  var
    tech = this.tech_,
    currentTime = tech.currentTime(),
    currentBuffered = this.findCurrentBuffered_(),
    bufferedTime = 0,
    mediaIndex = 0,
    segment,
    segmentInfo;

  // if preload is set to "none", do not download segments until playback is requested
  if (this.loadingState_ !== 'segments') {
    return;
  }

  // if a video has not been specified, do nothing
  if (!tech.currentSrc() || !this.playlists) {
    return;
  }

  // if there is a request already in flight, do nothing
  if (this.segmentXhr_) {
    return;
  }

  // wait until the buffer is up to date
  if (this.pendingSegment_) {
    return;
  }

  // if no segments are available, do nothing
  if (this.playlists.state === "HAVE_NOTHING" ||
      !this.playlists.media() ||
      !this.playlists.media().segments) {
    return;
  }

  // if a playlist switch is in progress, wait for it to finish
  if (this.playlists.state === 'SWITCHING_MEDIA') {
    return;
  }

  // find the next segment to download
  if (typeof seekToTime === 'number') {
    mediaIndex = this.playlists.getMediaIndexForTime_(seekToTime);
  } else if (currentBuffered && currentBuffered.length) {
    mediaIndex = this.playlists.getMediaIndexForTime_(currentBuffered.end(0));
    bufferedTime = Math.max(0, currentBuffered.end(0) - currentTime);
  } else {
    mediaIndex = this.playlists.getMediaIndexForTime_(this.tech_.currentTime());
  }
  segment = this.playlists.media().segments[mediaIndex];

  // if the video has finished downloading, stop trying to buffer
  if (!segment) {
    return;
  }

  // if there is plenty of content in the buffer and we're not
  // seeking, relax for awhile
  if (typeof seekToTime !== 'number' &&
      bufferedTime >= videojs.Hls.GOAL_BUFFER_LENGTH) {
    return;
  }

  // package up all the work to append the segment
  segmentInfo = {
    // resolve the segment URL relative to the playlist
    uri: this.playlistUriToUrl(segment.uri),
    // the segment's mediaIndex at the time it was received
    mediaIndex: mediaIndex,
    // the segment's playlist
    playlist: this.playlists.media(),
    // optionally, a time offset to seek to within the segment
    offset: seekToTime,
    // unencrypted bytes of the segment
    bytes: null,
    // when a key is defined for this segment, the encrypted bytes
    encryptedBytes: null,
    // optionally, the decrypter that is unencrypting the segment
    decrypter: null,
    // the state of the buffer before a segment is appended will be
    // stored here so that the actual segment duration can be
    // determined after it has been appended
    buffered: null
  };

  this.loadSegment(segmentInfo);
};

videojs.Hls.prototype.playlistUriToUrl = function(segmentRelativeUrl) {
  var playListUrl;
    // resolve the segment URL relative to the playlist
  if (this.playlists.media().uri === this.source_.src) {
    playListUrl = resolveUrl(this.source_.src, segmentRelativeUrl);
  } else {
    playListUrl = resolveUrl(resolveUrl(this.source_.src, this.playlists.media().uri || ''), segmentRelativeUrl);
  }
  return playListUrl;
};

/*
 * Sets `bandwidth`, `segmentXhrTime`, and appends to the `bytesReceived.
 * Expects an object with:
 *  * `roundTripTime` - the round trip time for the request we're setting the time for
 *  * `bandwidth` - the bandwidth we want to set
 *  * `bytesReceived` - amount of bytes downloaded
 * `bandwidth` is the only required property.
 */
videojs.Hls.prototype.setBandwidth = function(xhr) {
  // calculate the download bandwidth
  this.segmentXhrTime = xhr.roundTripTime;
  this.bandwidth = xhr.bandwidth;
  this.bytesReceived += xhr.bytesReceived || 0;

  this.tech_.trigger('bandwidthupdate');
};

videojs.Hls.prototype.loadSegment = function(segmentInfo) {
  var
    self = this,
    segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

  // if the segment is encrypted, request the key
  if (segment.key) {
    this.fetchKey_(segment);
  }

  // request the next segment
  this.segmentXhr_ = videojs.Hls.xhr({
    uri: segmentInfo.uri,
    responseType: 'arraybuffer',
    withCredentials: this.source_.withCredentials
  }, function(error, request) {
    // the segment request is no longer outstanding
    self.segmentXhr_ = null;

    // if a segment request times out, we may have better luck with another playlist
    if (request.timedout) {
      self.bandwidth = 1;
      return self.playlists.media(self.selectPlaylist());
    }

    // otherwise, trigger a network error
    if (!request.aborted && error) {
      self.error = {
        status: request.status,
        message: 'HLS segment request error at URL: ' + segmentInfo.uri,
        code: (request.status >= 500) ? 4 : 2
      };

      return self.mediaSource.endOfStream('network');
    }

    // stop processing if the request was aborted
    if (!request.response) {
      return;
    }

    self.setBandwidth(request);

    if (segment.key) {
      segmentInfo.encryptedBytes = new Uint8Array(request.response);
    } else {
      segmentInfo.bytes = new Uint8Array(request.response);
    }
    self.pendingSegment_ = segmentInfo;
    self.tech_.trigger('progress');
    self.drainBuffer();

    // figure out what stream the next segment should be downloaded from
    // with the updated bandwidth information
    self.playlists.media(self.selectPlaylist());
  });
};

videojs.Hls.prototype.drainBuffer = function(event) {
  var
    segmentInfo,
    mediaIndex,
    playlist,
    offset,
    bytes,
    segment,
    decrypter,
    segIv,
    segmentTimestampOffset = 0,
    hasBufferedContent = (this.tech_.buffered().length !== 0),
    currentBuffered = this.findCurrentBuffered_(),
    outsideBufferedRanges = !(currentBuffered && currentBuffered.length);

  // if the buffer is empty or the source buffer hasn't been created
  // yet, do nothing
  if (!this.pendingSegment_ || !this.sourceBuffer) {
    return;
  }

  // we can't append more data if the source buffer is busy processing
  // what we've already sent
  if (this.sourceBuffer.updating) {
    return;
  }

  segmentInfo = this.pendingSegment_;
  mediaIndex = segmentInfo.mediaIndex;
  playlist = segmentInfo.playlist;
  offset = segmentInfo.offset;
  bytes = segmentInfo.bytes;
  segment = playlist.segments[mediaIndex];

  if (segment.key && !bytes) {

    // this is an encrypted segment
    // if the key download failed, we want to skip this segment
    // but if the key hasn't downloaded yet, we want to try again later
    if (keyFailed(segment.key)) {
      videojs.log.warn('Network error retrieving key from "' +
                       segment.key.uri + '"');
      return this.mediaSource.endOfStream('network');
    } else if (!segment.key.bytes) {

      // waiting for the key bytes, try again later
      return;
    } else if (segmentInfo.decrypter) {

      // decryption is in progress, try again later
      return;
    } else {

      // if the media sequence is greater than 2^32, the IV will be incorrect
      // assuming 10s segments, that would be about 1300 years
      segIv = segment.key.iv || new Uint32Array([0, 0, 0, mediaIndex + playlist.mediaSequence]);

      // create a decrypter to incrementally decrypt the segment
      decrypter = new videojs.Hls.Decrypter(segmentInfo.encryptedBytes,
                                            segment.key.bytes,
                                            segIv,
                                            function(err, bytes) {
                                              segmentInfo.bytes = bytes;
                                            });
      segmentInfo.decrypter = decrypter;
      return;
    }
  }

  event = event || {};

  // If we have seeked into a non-buffered time-range, remove all buffered
  // time-ranges because they could have been incorrectly placed originally
  if (this.tech_.seeking() && outsideBufferedRanges) {
    if (hasBufferedContent) {
      // In Chrome, it seems that too many independent buffered time-ranges can
      // cause playback to fail to resume when seeking so just kill all of them
      this.sourceBuffer.remove(0, Infinity);
      return;
    }

    // If there are discontinuities in the playlist, we can't be sure of anything
    // related to time so we reset the timestamp offset and start appending data
    // anew on every seek
    if (segmentInfo.playlist.discontinuityStarts.length) {
      if (segmentInfo.mediaIndex > 0) {
        segmentTimestampOffset = videojs.Hls.Playlist.duration(segmentInfo.playlist, segmentInfo.mediaIndex);
      }

      // Now that the forward buffer is clear, we have to set timestamp offset to
      // the start of the buffered region
      this.sourceBuffer.timestampOffset = segmentTimestampOffset;
    }
  } else if (segment.discontinuity) {
    // If we aren't seeking and are crossing a discontinuity, we should set
    // timestampOffset for new segments to be appended the end of the current
    // buffered time-range
    this.sourceBuffer.timestampOffset = currentBuffered.end(0);
  }

  if (currentBuffered.length) {
    // Chrome 45 stalls if appends overlap the playhead
    this.sourceBuffer.appendWindowStart = Math.min(this.tech_.currentTime(), currentBuffered.end(0));
  } else {
    this.sourceBuffer.appendWindowStart = 0;
  }
  this.pendingSegment_.buffered = this.tech_.buffered();

  // the segment is asynchronously added to the current buffered data
  this.sourceBuffer.appendBuffer(bytes);
};

/**
 * Attempt to retrieve the key for a particular media segment.
 */
videojs.Hls.prototype.fetchKey_ = function(segment) {
  var key, self, settings, receiveKey;

  // if there is a pending XHR or no segments, don't do anything
  if (this.keyXhr_) {
    return;
  }

  self = this;
  settings = this.options_;

  /**
   * Handle a key XHR response.
   */
  receiveKey = function(key) {
    return function(error, request) {
      var view;
      self.keyXhr_ = null;

      if (error || !request.response || request.response.byteLength !== 16) {
        key.retries = key.retries || 0;
        key.retries++;
        if (!request.aborted) {
          // try fetching again
          self.fetchKey_(segment);
        }
        return;
      }

      view = new DataView(request.response);
      key.bytes = new Uint32Array([
        view.getUint32(0),
        view.getUint32(4),
        view.getUint32(8),
        view.getUint32(12)
      ]);

      // check to see if this allows us to make progress buffering now
      self.checkBuffer_();
    };
  };

  key = segment.key;

  // nothing to do if this segment is unencrypted
  if (!key) {
    return;
  }

  // request the key if the retry limit hasn't been reached
  if (!key.bytes && !keyFailed(key)) {
    this.keyXhr_ = videojs.Hls.xhr({
      uri: this.playlistUriToUrl(key.uri),
      responseType: 'arraybuffer',
      withCredentials: settings.withCredentials
    }, receiveKey(key));
    return;
  }
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
  if (!videojs.getComponent('Html5').isSupported()) {
    return false;
  }

  xMpegUrl = video.canPlayType('application/x-mpegURL');
  vndMpeg = video.canPlayType('application/vnd.apple.mpegURL');
  return (/probably|maybe/).test(xMpegUrl) ||
    (/probably|maybe/).test(vndMpeg);
})();

// HLS is a source handler, not a tech. Make sure attempts to use it
// as one do not cause exceptions.
videojs.Hls.isSupported = function() {
  return videojs.log.warn('HLS is no longer a tech. Please remove it from ' +
                          'your player\'s techOrder.');
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

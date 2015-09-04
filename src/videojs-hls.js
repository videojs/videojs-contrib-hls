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

  // the amount of time to wait between checking the state of the buffer
  bufferCheckInterval = 500,
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

    this.hasPlayed_ = false;
    this.on(player, 'loadstart', function() {
      this.hasPlayed_ = false;
      this.one(this.mediaSource, 'sourceopen', this.setupFirstPlay);
    });
    this.on(player, ['play', 'loadedmetadata'], this.setupFirstPlay);


    // TODO: After video.js#1347 is pulled in remove these lines
    this.currentTime = videojs.Hls.prototype.currentTime;
    this.setCurrentTime = videojs.Hls.prototype.setCurrentTime;

    // a queue of segments that need to be transmuxed and processed,
    // and then fed to the source buffer
    this.segmentBuffer_ = [];
    // periodically check if new data needs to be downloaded or
    // buffered data should be appended to the source buffer
    this.startCheckingBuffer_();

    videojs.Hls.prototype.src.call(this, options.source && options.source.src);
  }
});

// Add HLS to the standard tech order
videojs.options.techOrder.unshift('hls');

// the desired length of video to maintain in the buffer, in seconds
videojs.Hls.GOAL_BUFFER_LENGTH = 30;

// The number of target durations to exclude from the seekable window
// for live playlists. Decreasing this value is likely to cause
// playback stalls.
videojs.Hls.LIVE_SYNC_DURATION_COUNT = 3;

videojs.Hls.prototype.src = function(src) {
  var
    tech = this,
    player = this.player(),
    settings = player.options().hls || {},
    mediaSource,
    oldMediaPlaylist,
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

  // if the stream contains ID3 metadata, expose that as a metadata
  // text track
  this.setupMetadataCueTranslation_();

  // load the MediaSource into the player
  this.mediaSource.addEventListener('sourceopen', videojs.bind(this, this.handleSourceOpen));

  // cleanup the old playlist loader, if necessary
  if (this.playlists) {
    this.playlists.dispose();
  }

  // The index of the next segment to be downloaded in the current
  // media playlist. When the current media playlist is live with
  // expiring segments, it may be a different value from the media
  // sequence number for a segment.
  this.mediaIndex = 0;

  this.playlists = new videojs.Hls.PlaylistLoader(this.src_, settings.withCredentials);

  this.playlists.on('loadedmetadata', videojs.bind(this, function() {
    var selectedPlaylist, loaderHandler, oldBitrate, newBitrate, segmentDuration,
        segmentDlTime, threshold;

    oldMediaPlaylist = this.playlists.media();

    // the bandwidth estimate for the first segment is based on round
    // trip time for the master playlist. the master playlist is
    // almost always tiny so the round-trip time is dominated by
    // latency and the computed bandwidth is much lower than
    // steady-state. if the the downstream developer has a better way
    // of detecting bandwidth and provided a number, use that instead.
    if (this.bandwidth === undefined) {
      // we're going to have to estimate initial bandwidth
      // ourselves. scale the bandwidth estimate to account for the
      // relatively high round-trip time from the master playlist.
      this.setBandwidth({
        bandwidth: this.playlists.bandwidth * 5
      });
    }

    selectedPlaylist = this.selectPlaylist();
    oldBitrate = oldMediaPlaylist.attributes &&
                 oldMediaPlaylist.attributes.BANDWIDTH || 0;
    newBitrate = selectedPlaylist.attributes &&
                 selectedPlaylist.attributes.BANDWIDTH || 0;
    segmentDuration = oldMediaPlaylist.segments &&
                      oldMediaPlaylist.segments[this.mediaIndex].duration ||
                      oldMediaPlaylist.targetDuration;

    segmentDlTime = (segmentDuration * newBitrate) / this.bandwidth;

    if (!segmentDlTime) {
      segmentDlTime = Infinity;
    }

    // this threshold is to account for having a high latency on the manifest
    // request which is a somewhat small file.
    threshold = 10;

    if (newBitrate > oldBitrate && segmentDlTime <= threshold) {
      this.playlists.media(selectedPlaylist);
      loaderHandler = videojs.bind(this, function() {
        this.setupFirstPlay();
        this.fillBuffer();
        player.trigger('loadedmetadata');
        this.playlists.off('loadedplaylist', loaderHandler);
      });
      this.playlists.on('loadedplaylist', loaderHandler);
    } else {
      this.setupFirstPlay();
      this.fillBuffer();
      player.trigger('loadedmetadata');
    }
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

    this.fetchKeys_();
  }));

  this.playlists.on('mediachange', videojs.bind(this, function() {
    // abort outstanding key requests and check if new keys need to be retrieved
    if (keyXhr) {
      this.cancelKeyXhr();
    }

    player.trigger('mediachange');
  }));

  this.player().ready(function() {
    // do nothing if the tech has been disposed already
    // this can occur if someone sets the src in player.ready(), for instance
    if (!tech.el()) {
      return;
    }
    tech.el().vjs_src(source.src);
  });
};

/* Returns the media index for the live point in the current playlist, and updates
   the current time to go along with it.
 */
videojs.Hls.getMediaIndexForLive_ = function(selectedPlaylist) {
  if (!selectedPlaylist.segments) {
    return 0;
  }

  var tailIterator = selectedPlaylist.segments.length,
      tailDuration = 0,
      targetTail = (selectedPlaylist.targetDuration || 10) * videojs.Hls.LIVE_SYNC_DURATION_COUNT;

  while (tailDuration < targetTail && tailIterator > 0) {
    tailDuration += selectedPlaylist.segments[tailIterator - 1].duration;
    tailIterator--;
  }

  return tailIterator;
};

videojs.Hls.prototype.handleSourceOpen = function() {
  // construct the video data buffer and set the appropriate MIME type
  var
    player = this.player(),
    sourceBuffer = this.mediaSource.addSourceBuffer('video/flv; codecs="vp6,aac"');

  this.sourceBuffer = sourceBuffer;

  // if autoplay is enabled, begin playback. This is duplicative of
  // code in video.js but is required because play() must be invoked
  // *after* the media source has opened.
  // NOTE: moving this invocation of play() after
  // sourceBuffer.appendBuffer() below caused live streams with
  // autoplay to stall
  if (player.options().autoplay) {
    player.play();
  }

  sourceBuffer.appendBuffer(this.segmentParser_.getFlvHeader());
};

// register event listeners to transform in-band metadata events into
// VTTCues on a text track
videojs.Hls.prototype.setupMetadataCueTranslation_ = function() {
  var
    tech = this,
    metadataStream = tech.segmentParser_.metadataStream,
    textTrack;

  // only expose metadata tracks to video.js versions that support
  // dynamic text tracks (4.12+)
  if (!tech.player().addTextTrack) {
    return;
  }

  // add a metadata cue whenever a metadata event is triggered during
  // segment parsing
  metadataStream.on('data', function(metadata) {
    var i, hexDigit;

    // create the metadata track if this is the first ID3 tag we've
    // seen
    if (!textTrack) {
      textTrack = tech.player().addTextTrack('metadata', 'Timed Metadata');

      // build the dispatch type from the stream descriptor
      // https://html.spec.whatwg.org/multipage/embedded-content.html#steps-to-expose-a-media-resource-specific-text-track
      textTrack.inBandMetadataTrackDispatchType = videojs.Hls.SegmentParser.STREAM_TYPES.metadata.toString(16).toUpperCase();
      for (i = 0; i < metadataStream.descriptor.length; i++) {
        hexDigit = ('00' + metadataStream.descriptor[i].toString(16).toUpperCase()).slice(-2);
        textTrack.inBandMetadataTrackDispatchType += hexDigit;
      }
    }

    // store this event for processing once the muxing has finished
    tech.segmentBuffer_[0].pendingMetadata.push({
      textTrack: textTrack,
      metadata: metadata
    });
  });

  // when seeking, clear out all cues ahead of the earliest position
  // in the new segment. keep earlier cues around so they can still be
  // programmatically inspected even though they've already fired
  tech.on(tech.player(), 'seeking', function() {
    var media, startTime, i;
    if (!textTrack) {
      return;
    }
    media = tech.playlists.media();
    startTime = tech.playlists.expiredPreDiscontinuity_ + tech.playlists.expiredPostDiscontinuity_;
    startTime += videojs.Hls.Playlist.duration(media, media.mediaSequence, media.mediaSequence + tech.mediaIndex);

    i = textTrack.cues.length;
    while (i--) {
      if (textTrack.cues[i].startTime >= startTime) {
        textTrack.removeCue(textTrack.cues[i]);
      }
    }
  });
};

videojs.Hls.prototype.addCuesForMetadata_ = function(segmentInfo) {
  var i, cue, frame, metadata, minPts, segment, segmentOffset, textTrack, time;
  segmentOffset = this.playlists.expiredPreDiscontinuity_;
  segmentOffset += this.playlists.expiredPostDiscontinuity_;
  segmentOffset += videojs.Hls.Playlist.duration(segmentInfo.playlist,
                                                 segmentInfo.playlist.mediaSequence,
                                                 segmentInfo.playlist.mediaSequence + segmentInfo.mediaIndex);
  segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
  minPts = Math.min(isFinite(segment.minVideoPts) ? segment.minVideoPts : Infinity,
                    isFinite(segment.minAudioPts) ? segment.minAudioPts : Infinity);

  while (segmentInfo.pendingMetadata.length) {
    metadata = segmentInfo.pendingMetadata[0].metadata;
    textTrack = segmentInfo.pendingMetadata[0].textTrack;

    // create cue points for all the ID3 frames in this metadata event
    for (i = 0; i < metadata.frames.length; i++) {
      frame = metadata.frames[i];
      time = segmentOffset + ((metadata.pts - minPts) * 0.001);
      cue = new window.VTTCue(time, time, frame.value || frame.url || '');
      cue.frame = frame;
      cue.pts_ = metadata.pts;
      textTrack.addCue(cue);
    }
    segmentInfo.pendingMetadata.shift();
  }
};

/**
 * Seek to the latest media position if this is a live video and the
 * player and video are loaded and initialized.
 */
videojs.Hls.prototype.setupFirstPlay = function() {
  var seekable, media;
  media = this.playlists.media();

  // check that everything is ready to begin buffering
  if (!this.hasPlayed_ &&
      this.sourceBuffer &&
      media &&
      this.paused() === false) {

    // only run this block once per video
    this.hasPlayed_ = true;

    if (this.duration() === Infinity) {
      // seek to the latest media position for live videos
      seekable = this.seekable();
      if (seekable.length) {
        this.setCurrentTime(seekable.end(0));
      }
    }
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

  if (!this.hasPlayed_) {
    videojs.Flash.prototype.play.apply(this, arguments);
    return this.setupFirstPlay();
  }

  // if the viewer has paused and we fell out of the live window,
  // seek forward to the earliest available position
  if (this.duration() === Infinity &&
      this.currentTime() < this.seekable().start(0)) {
    this.setCurrentTime(this.seekable().start(0));
  }

  // delegate back to the Flash implementation
  videojs.Flash.prototype.play.apply(this, arguments);
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

  // it's clearly an edge-case but don't thrown an error if asked to
  // seek within an empty playlist
  if (!this.playlists.media().segments) {
    return 0;
  }

  // clamp seeks to the available seekable time range
  if (currentTime < this.seekable().start(0)) {
    currentTime = this.seekable().start(0);
  } else if (currentTime > this.seekable().end(0)) {
    currentTime = this.seekable().end(0);
  }

  // save the seek target so currentTime can report it correctly
  // while the seek is pending
  this.lastSeekedTime_ = currentTime;

  // determine the requested segment
  this.mediaIndex = this.playlists.getMediaIndexForTime_(currentTime);

  // abort any segments still being decoded
  if (this.sourceBuffer) {
    this.sourceBuffer.abort();
  }

  // cancel outstanding requests and buffer appends
  this.cancelSegmentXhr();

  // abort outstanding key requests, if necessary
  if (keyXhr) {
    keyXhr.aborted = true;
    this.cancelKeyXhr();
  }

  // clear out any buffered segments
  this.segmentBuffer_ = [];

  // begin filling the buffer at the new position
  this.fillBuffer(currentTime * 1000);
};

videojs.Hls.prototype.duration = function() {
  var playlists = this.playlists;
  if (playlists) {
    return videojs.Hls.Playlist.duration(playlists.media());
  }
  return 0;
};

videojs.Hls.prototype.seekable = function() {
  var currentSeekable, startOffset, media;

  if (!this.playlists) {
    return videojs.createTimeRange();
  }
  media = this.playlists.media();
  if (!media) {
    return videojs.createTimeRange();
  }

  // report the seekable range relative to the earliest possible
  // position when the stream was first loaded
  currentSeekable = videojs.Hls.Playlist.seekable(media);
  if (!currentSeekable.length) {
    return currentSeekable;
  }

  startOffset = this.playlists.expiredPostDiscontinuity_ - this.playlists.expiredPreDiscontinuity_;
  return videojs.createTimeRange(startOffset,
                                 startOffset + (currentSeekable.end(0) - currentSeekable.start(0)));
};

/**
 * Update the player duration
 */
videojs.Hls.prototype.updateDuration = function(playlist) {
  var player = this.player(),
      oldDuration = player.duration(),
      newDuration = videojs.Hls.Playlist.duration(playlist);

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
  this.cancelSegmentXhr();
  this.cancelKeyXhr();

  if (this.sourceBuffer) {
    this.sourceBuffer.abort();
  }
};

videojs.Hls.prototype.cancelKeyXhr = function() {
  if (keyXhr) {
    keyXhr.onreadystatechange = null;
    keyXhr.abort();
    keyXhr = null;
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
    oldvariant,
    bandwidthBestVariant,
    resolutionPlusOne,
    resolutionBestVariant,
    playerWidth,
    playerHeight;

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

  // forget our old variant from above, or we might choose that in high-bandwidth scenarios
  // (this could be the lowest bitrate rendition as  we go through all of them above)
  variant = null;

  playerWidth = parseInt(getComputedStyle(player.el()).width, 10);
  playerHeight = parseInt(getComputedStyle(player.el()).height, 10);

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
    if (variant.attributes.RESOLUTION.width === playerWidth &&
        variant.attributes.RESOLUTION.height === playerHeight) {
      // if we have the exact resolution as the player use it
      resolutionPlusOne = null;
      resolutionBestVariant = variant;
      break;
    } else if (variant.attributes.RESOLUTION.width < playerWidth &&
        variant.attributes.RESOLUTION.height < playerHeight) {
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
  this.checkBufferTimeout_ = window.setTimeout(videojs.bind(this, this.checkBuffer_),
                                               bufferCheckInterval);
};

/**
 * Setup a periodic task to request new segments if necessary and
 * append bytes into the SourceBuffer.
 */
videojs.Hls.prototype.startCheckingBuffer_ = function() {
  // if the player ever stalls, check if there is video data available
  // to append immediately
  this.player().on('waiting', videojs.bind(this, this.drainBuffer));

  this.checkBuffer_();
};

/**
 * Stop the periodic task requesting new segments and feeding the
 * SourceBuffer.
 */
videojs.Hls.prototype.stopCheckingBuffer_ = function() {
  window.clearTimeout(this.checkBufferTimeout_);
  this.checkBufferTimeout_ = null;
  this.player().off('waiting', this.drainBuffer);
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

  // if preload is set to "none", do not download segments until playback is requested
  if (!player.hasClass('vjs-has-started') &&
      player.options().preload === 'none') {
    return;
  }

  // if a video has not been specified, do nothing
  if (!player.currentSrc() || !this.playlists) {
    return;
  }

  // if there is a request already in flight, do nothing
  if (this.segmentXhr_) {
    return;
  }

  // if no segments are available, do nothing
  if (this.playlists.state === "HAVE_NOTHING" ||
      !this.playlists.media() ||
      !this.playlists.media().segments) {
    return;
  }

  // if this is a live video wait until playback has been requested to
  // being buffering so we don't preload data that will never be
  // played
  if (!this.playlists.media().endList &&
      !player.hasClass('vjs-has-started') &&
      offset === undefined) {
    return;
  }

  // if a playlist switch is in progress, wait for it to finish
  if (this.playlists.state === 'SWITCHING_MEDIA') {
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
  segmentUri = this.playlistUriToUrl(segment.uri);

  this.loadSegment(segmentUri, offset);
};

videojs.Hls.prototype.playlistUriToUrl = function(segmentRelativeUrl) {
  var playListUrl;
    // resolve the segment URL relative to the playlist
  if (this.playlists.media().uri === this.src_) {
    playListUrl = resolveUrl(this.src_, segmentRelativeUrl);
  } else {
    playListUrl = resolveUrl(resolveUrl(this.src_, this.playlists.media().uri || ''), segmentRelativeUrl);
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
  var tech = this;
  // calculate the download bandwidth
  tech.segmentXhrTime = xhr.roundTripTime;
  tech.bandwidth = xhr.bandwidth;
  tech.bytesReceived += xhr.bytesReceived || 0;

  tech.trigger('bandwidthupdate');
};

videojs.Hls.prototype.loadSegment = function(segmentUri, offset) {
  var
    tech = this,
    player = this.player(),
    settings = player.options().hls || {};

  // request the next segment
  this.segmentXhr_ = videojs.Hls.xhr({
    url: segmentUri,
    responseType: 'arraybuffer',
    withCredentials: settings.withCredentials
  }, function(error, url) {
    var segmentInfo;

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

    tech.setBandwidth(this);

    // package up all the work to append the segment
    segmentInfo = {
      // the segment's mediaIndex at the time it was received
      mediaIndex: tech.mediaIndex,
      // the segment's playlist
      playlist: tech.playlists.media(),
      // optionally, a time offset to seek to within the segment
      offset: offset,
      // unencrypted bytes of the segment
      bytes: null,
      // when a key is defined for this segment, the encrypted bytes
      encryptedBytes: null,
      // optionally, the decrypter that is unencrypting the segment
      decrypter: null,
      // metadata events discovered during muxing that need to be
      // translated into cue points
      pendingMetadata: []
    };
    if (segmentInfo.playlist.segments[segmentInfo.mediaIndex].key) {
      segmentInfo.encryptedBytes = new Uint8Array(this.response);
    } else {
      segmentInfo.bytes = new Uint8Array(this.response);
    }
    tech.segmentBuffer_.push(segmentInfo);
    player.trigger('progress');
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
    segmentInfo,
    mediaIndex,
    playlist,
    offset,
    tags,
    bytes,
    segment,
    decrypter,
    segIv,
    ptsTime,
    segmentOffset = 0,
    segmentBuffer = this.segmentBuffer_;

  // if the buffer is empty or the source buffer hasn't been created
  // yet, do nothing
  if (!segmentBuffer.length || !this.sourceBuffer) {
    return;
  }

  // we can't append more data if the source buffer is busy processing
  // what we've already sent
  if (this.sourceBuffer.updating) {
    return;
  }

  segmentInfo = segmentBuffer[0];

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
      return segmentBuffer.shift();
    } else if (!segment.key.bytes) {

      // trigger a key request if one is not already in-flight
      return this.fetchKeys_();

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

  // transmux the segment data from MP2T to FLV
  this.segmentParser_.parseSegmentBinaryData(bytes);
  this.segmentParser_.flushTags();

  tags = [];

  if (this.segmentParser_.tagsAvailable()) {
    // record PTS information for the segment so we can calculate
    // accurate durations and seek reliably
    if (this.segmentParser_.stats.h264Tags()) {
      segment.minVideoPts = this.segmentParser_.stats.minVideoPts();
      segment.maxVideoPts = this.segmentParser_.stats.maxVideoPts();
    }
    if (this.segmentParser_.stats.aacTags()) {
      segment.minAudioPts = this.segmentParser_.stats.minAudioPts();
      segment.maxAudioPts = this.segmentParser_.stats.maxAudioPts();
    }
  }

  while (this.segmentParser_.tagsAvailable()) {
    tags.push(this.segmentParser_.getNextTag());
  }

  this.addCuesForMetadata_(segmentInfo);
  this.updateDuration(this.playlists.media());

  // if we're refilling the buffer after a seek, scan through the muxed
  // FLV tags until we find the one that is closest to the desired
  // playback time
  if (typeof offset === 'number') {
    if (tags.length) {
      // determine the offset within this segment we're seeking to
      segmentOffset = this.playlists.expiredPostDiscontinuity_ + this.playlists.expiredPreDiscontinuity_;
      segmentOffset += videojs.Hls.Playlist.duration(playlist,
                                                     playlist.mediaSequence,
                                                     playlist.mediaSequence + mediaIndex);
      segmentOffset = offset - (segmentOffset * 1000);
      ptsTime = segmentOffset + tags[0].pts;

      while (tags[i + 1] && tags[i].pts < ptsTime) {
        i++;
      }

      // tell the SWF the media position of the first tag we'll be delivering
      this.el().vjs_setProperty('currentTime', ((tags[i].pts - ptsTime + offset) * 0.001));

      tags = tags.slice(i);
    }

    this.lastSeekedTime_ = null;
  }

  // when we're crossing a discontinuity, inject metadata to indicate
  // that the decoder should be reset appropriately
  if (segment.discontinuity && tags.length) {
    this.el().vjs_discontinuity();
  }

  (function() {
    var segmentByteLength = 0, j, segment;
    for (i = 0; i < tags.length; i++) {
      segmentByteLength += tags[i].bytes.byteLength;
    }
    segment = new Uint8Array(segmentByteLength);
    for (i = 0, j = 0; i < tags.length; i++) {
      segment.set(tags[i].bytes, j);
      j += tags[i].bytes.byteLength;
    }
    this.sourceBuffer.appendBuffer(segment);
  }).call(this);

  // we're done processing this segment
  segmentBuffer.shift();

  // transition the sourcebuffer to the ended state if we've hit the end of
  // the playlist
  if (this.duration() !== Infinity && mediaIndex + 1 === playlist.segments.length) {
    this.mediaSource.endOfStream();
  }
};

/**
 * Attempt to retrieve keys starting at a particular media
 * segment. This method has no effect if segments are not yet
 * available or a key request is already in progress.
 *
 * @param playlist {object} the media playlist to fetch keys for
 * @param index {number} the media segment index to start from
 */
videojs.Hls.prototype.fetchKeys_ = function() {
  var i, key, tech, player, settings, segment, view, receiveKey;

  // if there is a pending XHR or no segments, don't do anything
  if (keyXhr || !this.segmentBuffer_.length) {
    return;
  }

  tech = this;
  player = this.player();
  settings = player.options().hls || {};

  /**
   * Handle a key XHR response. This function needs to lookup the
   */
  receiveKey = function(key) {
    return function(error) {
      keyXhr = null;

      if (error || !this.response || this.response.byteLength !== 16) {
        key.retries = key.retries || 0;
        key.retries++;
        if (!this.aborted) {
          // try fetching again
          tech.fetchKeys_();
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

      // check to see if this allows us to make progress buffering now
      tech.checkBuffer_();
    };
  };

  for (i = 0; i < tech.segmentBuffer_.length; i++) {
    segment = tech.segmentBuffer_[i].playlist.segments[tech.segmentBuffer_[i].mediaIndex];
    key = segment.key;

    // continue looking if this segment is unencrypted
    if (!key) {
      continue;
    }

    // request the key if the retry limit hasn't been reached
    if (!key.bytes && !keyFailed(key)) {
      keyXhr = videojs.Hls.xhr({
        url: this.playlistUriToUrl(key.uri),
        responseType: 'arraybuffer',
        withCredentials: settings.withCredentials
      }, receiveKey(key));
      break;
    }
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
  videojs.log.warn('videojs.Hls.getPlaylistDuration is deprecated. ' +
                   'Use videojs.Hls.Playlist.duration instead');
  return videojs.Hls.Playlist.duration(playlist, startIndex, endIndex);
};

/**
 * Calculate the total duration for a playlist based on segment metadata.
 * @param playlist {object} a media playlist object
 * @return {number} the currently known duration, in seconds
 */
videojs.Hls.getPlaylistTotalDuration = function(playlist) {
  videojs.log.warn('videojs.Hls.getPlaylistTotalDuration is deprecated. ' +
                   'Use videojs.Hls.Playlist.duration instead');
  return videojs.Hls.Playlist.duration(playlist);
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
  var translatedMediaIndex;

  // no segments have been loaded from the original playlist
  if (mediaIndex === 0) {
    return 0;
  }

  if (!(update && update.segments)) {
    // let the media index be zero when there are no segments defined
    return 0;
  }

  // translate based on media sequence numbers. syncing up across
  // bitrate switches should be happening here.
  translatedMediaIndex = (mediaIndex + (original.mediaSequence - update.mediaSequence));

  if (translatedMediaIndex > update.segments.length || translatedMediaIndex < 0) {
    // recalculate the live point if the streams are too far out of sync
    return videojs.Hls.getMediaIndexForLive_(update) + 1;
  }

  return translatedMediaIndex;
};

/**
 * Deprecated.
 *
 * @deprecated use player.hls.playlists.getMediaIndexForTime_() instead
 */
videojs.Hls.getMediaIndexByTime = function() {
  videojs.log.warn('getMediaIndexByTime is deprecated. ' +
                   'Use PlaylistLoader.getMediaIndexForTime_ instead.');
  return 0;
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

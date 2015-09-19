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

  keyXhr,
  keyFailed,
  resolveUrl;

// returns true if a key has failed to download within a certain amount of retries
keyFailed = function(key) {
  return key.retries && key.retries >= 2;
};

videojs.Hls = videojs.extends(Component, {
  constructor: function(tech, source) {
    var self = this, _player;

    Component.call(this, tech);

    // tech.player() is deprecated but setup a reference to HLS for
    // backwards-compatibility
    if (tech.options_ && tech.options_.playerId) {
      _player = videojs(tech.options_.playerId);
      if (!_player.hasOwnProperty('hls')) {
        Object.defineProperty(_player, 'hls', {
          get: function() {
            videojs.log.warn('player.hls is deprecated. Use player.tech.hls instead.');
            return self;
          }
        });
      }
    }
    this.tech_ = tech;
    this.source_ = source;
    this.bytesReceived = 0;

    // deprecated properties
    Object.defineProperty(this, 'bandwidth', {
      get: function() {
        videojs.log.warn('hls.bandwidth is deprecated. Use hls.segments.bandwidth instead.');
        return self.segments.bandwidth;
      },
      set: function(bandwidth) {
        videojs.log.warn('hls.bandwidth is deprecated. Use hls.segments.bandwidth instead.');
        self.segments.bandwidth = bandwidth;
        return bandwidth;
      }
    });
    Object.defineProperty(this, 'mediaIndex', {
      get: function() {
        videojs.log.warn('hls.mediaIndex is deprecated. Use hls.segments.mediaIndex() instead.');
        return self.segments.mediaIndex();
      }
    });

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

    // create a SegmentLoader to fetch segments when we're ready
    this.segments = new videojs.Hls.SegmentLoader();
    this.segments.on(['progress', 'timeout'], function() {
      // figure out what stream the next segment should be downloaded from
      // with the updated bandwidth information
      self.playlists.media(self.selectPlaylist());

      // pause buffering if we're switching playlists
      if (self.playlists.state === 'SWITCHING_MEDIA') {
        self.segments.load(null);
      }
    });
    this.segments.on('progress', function() {
      self.tech_.trigger('progress');
      self.tech_.trigger('bandwidthupdate');

      self.drainBuffer();
    });
    this.segments.on('error', function() {
      self.error = this.error;
    });

    // periodically check if new data needs to be downloaded or
    // buffered data should be appended to the source buffer
    this.startCheckingBuffer_();

    this.on(this.tech_, 'seeking', function() {
      this.setCurrentTime(this.tech_.currentTime());
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
videojs.HlsSourceHandler = {
  canHandleSource: function(srcObj) {
    var mpegurlRE = /^application\/(?:x-|vnd\.apple\.)mpegurl/i;

    // favor native HLS support if it's available
    if (videojs.Hls.supportsNativeHls) {
      return false;
    }
    return mpegurlRE.test(srcObj.type);
  },
  handleSource: function(source, tech) {
    tech.hls = new videojs.Hls(tech, source);
    tech.hls.src(source.src);
    return tech.hls;
  }
};
// register with the appropriate tech
if (videojs.MediaSource.supportsNativeMediaSources()) {
  videojs.getComponent('Html5').registerSourceHandler(videojs.HlsSourceHandler);
} else {
  videojs.getComponent('Flash').registerSourceHandler(videojs.HlsSourceHandler);
}

// the desired length of video to maintain in the buffer, in seconds
videojs.Hls.GOAL_BUFFER_LENGTH = 30;

// the amount of time to wait between checking the state of the buffer
videojs.Hls.BUFFER_CHECK_INTERVAL = 500;

videojs.Hls.prototype.src = function(src) {
  var oldMediaPlaylist;

  // do nothing if the src is falsey
  if (!src) {
    return;
  }

  this.mediaSource = new videojs.MediaSource();

  // if the stream contains ID3 metadata, expose that as a metadata
  // text track
  //this.setupMetadataCueTranslation_();

  // load the MediaSource into the player
  this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen.bind(this));

  // We need to trigger this asynchronously to give others the chance
  // to bind to the event when a source is set at player creation
  this.setTimeout(function() {
    this.tech_.trigger('loadstart');
  }.bind(this), 1);

  this.options_ = {};
  if (this.source_.withCredentials !== undefined) {
    this.options_.withCredentials = this.source_.withCredentials;
  } else if (videojs.options.hls) {
    this.options_.withCredentials = videojs.options.hls.withCredentials;
  }
  this.playlists = new videojs.Hls.PlaylistLoader(this.source_.src, this.options_.withCredentials);

  this.playlists.on('loadedmetadata', function() {
    var selectedPlaylist, loaderHandler, oldBitrate, newBitrate, segmentDuration,
        segmentDlTime, threshold;

    oldMediaPlaylist = this.playlists.media();

    // if this isn't a live video and preload permits, start
    // downloading segments
    if (oldMediaPlaylist.endList &&
        this.tech_.preload() !== 'metadata' &&
        this.tech_.preload() !== 'none') {
      this.loadingState_ = 'segments';
    }

    // the bandwidth estimate for the first segment is based on round
    // trip time for the master playlist. the master playlist is
    // almost always tiny so the round-trip time is dominated by
    // latency and the computed bandwidth is much lower than
    // steady-state. if the the downstream developer has a better way
    // of detecting bandwidth and provided a number, use that instead.
    if (this.segments.bandwidth === undefined) {
      // we're going to have to estimate initial bandwidth
      // ourselves. scale the bandwidth estimate to account for the
      // relatively high round-trip time from the master playlist.
      this.segments.bandwidth = this.playlists.bandwidth * 5;
    }

    this.setupSourceBuffer_();

    selectedPlaylist = this.selectPlaylist();
    oldBitrate = oldMediaPlaylist.attributes &&
                 oldMediaPlaylist.attributes.BANDWIDTH || 0;
    newBitrate = selectedPlaylist.attributes &&
                 selectedPlaylist.attributes.BANDWIDTH || 0;
    segmentDuration = oldMediaPlaylist.segments &&
                      oldMediaPlaylist.segments[this.segments.mediaIndex()].duration ||
                      oldMediaPlaylist.targetDuration;

    segmentDlTime = (segmentDuration * newBitrate) / this.segments.bandwidth;

    if (!segmentDlTime) {
      segmentDlTime = Infinity;
    }

    // this threshold is to account for having a high latency on the manifest
    // request which is a somewhat small file.
    threshold = 10;

    if (newBitrate > oldBitrate && segmentDlTime <= threshold) {
      this.playlists.media(selectedPlaylist);
      loaderHandler = function() {
        this.setupFirstPlay();
        this.tech_.trigger('loadedmetadata');
        this.playlists.off('loadedplaylist', loaderHandler);
      }.bind(this);
      this.playlists.on('loadedplaylist', loaderHandler);
    } else {
      this.setupFirstPlay();
      this.tech_.trigger('loadedmetadata');
    }
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
      // do nothing before an initial media playlist has been activated
      return;
    }

    // get ready to start buffering the new set of segments
    this.segments.baseUrl(resolveUrl(this.playlists.master.uri, updatedPlaylist.uri));
    if (oldMediaPlaylist) {
      this.segments.load(updatedPlaylist);
    }

    this.updateDuration(this.playlists.media());
    oldMediaPlaylist = updatedPlaylist;
  }.bind(this));

  this.playlists.on('mediachange', function() {
    // abort outstanding key requests and check if new keys need to be retrieved
    if (keyXhr) {
      this.cancelKeyXhr();
    }

    this.tech_.trigger({ type: 'mediachange', bubbles: true });
  }.bind(this));

  // do nothing if the tech has been disposed already
  // this can occur if someone sets the src in player.ready(), for instance
  if (!this.tech_.el()) {
    return;
  }

  this.tech_.src(videojs.URL.createObjectURL(this.mediaSource));
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
      targetTail = (selectedPlaylist.targetDuration || 10) * 3;

  while (tailDuration < targetTail && tailIterator > 0) {
    tailDuration += selectedPlaylist.segments[tailIterator - 1].duration;
    tailIterator--;
  }

  return tailIterator;
};

videojs.Hls.prototype.handleSourceOpen = function() {
  this.setupSourceBuffer_();

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

videojs.Hls.prototype.setupSourceBuffer_ = function() {
  var media = this.playlists.media(), mimeType;

  // wait until a media playlist is available and the Media Source is
  // attached
  if (!media || this.mediaSource.readyState !== 'open') {
    return;
  }

  mimeType = 'video/mp2t';
  if (media.attributes && media.attributes.CODECS) {
    mimeType += '; codecs="' + media.attributes.CODECS + '"';
  }
  this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);

  // transition the sourcebuffer to the ended state if we've hit the end of
  // the playlist
  this.sourceBuffer.addEventListener('updateend', function() {
    if (this.duration() !== Infinity &&
        this.segments.mediaIndex() === this.playlists.media().segments.length) {
      this.mediaSource.endOfStream();
    }
  }.bind(this));
};

// register event listeners to transform in-band metadata events into
// VTTCues on a text track
videojs.Hls.prototype.setupMetadataCueTranslation_ = function() {
  var
    metadataStream = this.segmentParser_.metadataStream,
    textTrack;

  // add a metadata cue whenever a metadata event is triggered during
  // segment parsing
  metadataStream.on('data', function(metadata) {
    var i, hexDigit;

    // create the metadata track if this is the first ID3 tag we've
    // seen
    if (!textTrack) {
      textTrack = this.tech_.addTextTrack('metadata', 'Timed Metadata');

      // build the dispatch type from the stream descriptor
      // https://html.spec.whatwg.org/multipage/embedded-content.html#steps-to-expose-a-media-resource-specific-text-track
      textTrack.inBandMetadataTrackDispatchType = videojs.Hls.SegmentParser.STREAM_TYPES.metadata.toString(16).toUpperCase();
      for (i = 0; i < metadataStream.descriptor.length; i++) {
        hexDigit = ('00' + metadataStream.descriptor[i].toString(16).toUpperCase()).slice(-2);
        textTrack.inBandMetadataTrackDispatchType += hexDigit;
      }
    }

    // store this event for processing once the muxing has finished
    this.segments.peek().pendingMetadata.push({
      textTrack: textTrack,
      metadata: metadata
    });
  }.bind(this));

  // when seeking, clear out all cues ahead of the earliest position
  // in the new segment. keep earlier cues around so they can still be
  // programmatically inspected even though they've already fired
  this.on(this.tech_, 'seeking', function() {
    var media, startTime, i;
    if (!textTrack) {
      return;
    }
    media = this.playlists.media();
    startTime = this.tech_.playlists.expiredPreDiscontinuity_ + this.tech_.playlists.expiredPostDiscontinuity_;
    startTime += videojs.Hls.Playlist.duration(media, media.mediaSequence, media.mediaSequence + this.tech_.mediaIndex);

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

  // if the media playlist isn't available yet, we'll need to check
  // again later once it is
  if (!media) {
    return;
  }

  // check that everything is ready to begin buffering

  // For VOD streams, begin buffering as soon as the loadingState_ is
  // "segments" and a media playlist is available
  if (this.duration() !== Infinity) {
    if (this.loadingState_ === 'segments') {
      this.segments.load(media);
    }
    return;
  }

  // For live streams, check:
  // 1) the player has not played before and is not paused
  // 2) the Media Source and Source Buffers are ready
  if (this.tech_.played().length === 0 &&
      this.tech_.paused() === false &&
      this.sourceBuffer) {

    // seek to the latest media position for live videos
    seekable = this.seekable();
    if (seekable.length) {
      this.tech_.setCurrentTime(seekable.end(0));
    }
  }
};

/**
 * Reset the mediaIndex if play() is called after the video has
 * ended.
 */
videojs.Hls.prototype.play = function() {
  this.loadingState_ = 'segments';

  if (this.tech_.ended()) {
    this.segments.mediaIndex(this.playlists.media(), 0);
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
  var buffered, mediaIndex, i;

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
  buffered = this.tech_.buffered();
  for (i = 0; i < buffered.length; i++) {
    if (this.tech_.buffered().start(i) <= currentTime &&
        this.tech_.buffered().end(i) > currentTime) {
      return currentTime;
    }
  }

  // determine the requested segment
  mediaIndex = this.playlists.getMediaIndexForTime_(currentTime);

  // abort outstanding key requests, if necessary
  if (keyXhr) {
    keyXhr.aborted = true;
    this.cancelKeyXhr();
  }

  // begin filling the buffer at the new position
  this.segments.mediaIndex(this.playlists.media(), mediaIndex, currentTime);
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

videojs.Hls.prototype.cancelKeyXhr = function() {
  if (keyXhr) {
    keyXhr.onreadystatechange = null;
    keyXhr.abort();
    keyXhr = null;
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

  this.segments.dispose();
  this.cancelKeyXhr();

  if (this.sourceBuffer) {
    this.sourceBuffer.abort();
  }
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

    if (effectiveBitrate < this.segments.bandwidth) {
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

  this.drainBuffer();

  // wait awhile and try again
  this.checkBufferTimeout_ = window.setTimeout((this.checkBuffer_).bind(this),
                                               videojs.Hls.BUFFER_CHECK_INTERVAL);
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

videojs.Hls.prototype.drainBuffer = function(event) {
  var
    bufferedTime,
    segmentInfo,
    mediaIndex,
    playlist,
    offset,
    bytes,
    segment,
    decrypter,
    segIv,
    segmentOffset = 0;
    // ptsTime,

  // if the buffer is empty or the source buffer hasn't been created
  // yet, do nothing
  if (!this.segments.length() || !this.sourceBuffer) {
    return;
  }

  if (this.tech_.buffered() &&
      this.tech_.buffered().length) {
    // assuming a single, contiguous buffer region
    bufferedTime = this.tech_.buffered().end(0) - this.tech_.currentTime();
  }

  // if there is plenty of content in the buffer, relax for awhile
  if (bufferedTime >= videojs.Hls.GOAL_BUFFER_LENGTH) {
    return;
  }

  // we can't append more data if the source buffer is busy processing
  // what we've already sent
  if (this.sourceBuffer.updating) {
    return;
  }

  segmentInfo = this.segments.peek();
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
      return this.segments.shift();
    } else if (!segment.key.bytes) {

      // trigger a key request if one is not already in-flight
      return this.fetchKey_();

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

  // if (this.segmentParser_.tagsAvailable()) {
  //   // record PTS information for the segment so we can calculate
  //   // accurate durations and seek reliably
  //   if (this.segmentParser_.stats.h264Tags()) {
  //     segment.minVideoPts = this.segmentParser_.stats.minVideoPts();
  //     segment.maxVideoPts = this.segmentParser_.stats.maxVideoPts();
  //   }
  //   if (this.segmentParser_.stats.aacTags()) {
  //     segment.minAudioPts = this.segmentParser_.stats.minAudioPts();
  //     segment.maxAudioPts = this.segmentParser_.stats.maxAudioPts();
  //   }
  // }

  // while (this.segmentParser_.tagsAvailable()) {
  //   tags.push(this.segmentParser_.getNextTag());
  // }

  this.addCuesForMetadata_(segmentInfo);
  //this.updateDuration(this.playlists.media());

  // // when we're crossing a discontinuity, inject metadata to indicate
  // // that the decoder should be reset appropriately
  // if (segment.discontinuity && tags.length) {
  //   this.tech_.el().vjs_discontinuity();
  // }

  // determine the timestamp offset for the start of this segment
  segmentOffset = this.playlists.expiredPostDiscontinuity_ + this.playlists.expiredPreDiscontinuity_;
  segmentOffset += videojs.Hls.Playlist.duration(playlist,
                                                 playlist.mediaSequence,
                                                 playlist.mediaSequence + mediaIndex);

  this.sourceBuffer.appendBuffer(bytes);

  // we're done processing this segment
  this.segments.shift();
};

/**
 * Attempt to retrieve the key for the next media segment. This method
 * has no effect if segments are not yet available, a key request is
 * already in progress, or the next segment does not require a key.
 */
videojs.Hls.prototype.fetchKey_ = function() {
  var segment, segmentInfo, receiveKey;

  // if there is a pending XHR or no segments, don't do anything
  if (keyXhr || !this.segments.length()) {
    return;
  }

  /**
   * Handle a key XHR response. This function needs to lookup the
   */
  receiveKey = function(key) {
    return function(error, request) {
      var view;
      keyXhr = null;

      if (error || !request.response || request.response.byteLength !== 16) {
        key.retries = key.retries || 0;
        key.retries++;
        if (!request.aborted) {
          // try fetching again
          this.fetchKey_();
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
      this.checkBuffer_();
    }.bind(this);
  }.bind(this);

  segmentInfo = this.segments.peek();
  segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
  if (!segment.key) {
    return;
  }

  // request the key if the retry limit hasn't been reached
  if (!segment.key.bytes && !keyFailed(segment.key)) {
    keyXhr = videojs.Hls.xhr({
      uri: this.playlistUriToUrl(segment.key.uri),
      responseType: 'arraybuffer',
      withCredentials: this.options_.withCredentials
    }, receiveKey(segment.key));
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

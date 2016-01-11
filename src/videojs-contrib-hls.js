/*
 * videojs-hls
 * The main file for the HLS project.
 * License: https://github.com/videojs/videojs-contrib-hls/blob/master/LICENSE
 */
(function(window, videojs, document, undefined) {
'use strict';

var
  // A fudge factor to apply to advertised playlist bitrates to account for
  // temporary flucations in client bandwidth
  bandwidthVariance = 1.2,
  blacklistDuration = 5 * 60 * 1000, // 5 minute blacklist
  Component = videojs.getComponent('Component'),

  // The amount of time to wait between checking the state of the buffer
  bufferCheckInterval = 500,

  keyFailed,
  resolveUrl;

// returns true if a key has failed to download within a certain amount of retries
keyFailed = function(key) {
  return key.retries && key.retries >= 2;
};

videojs.Hls = {};
videojs.HlsHandler = videojs.extend(Component, {
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

    // start playlist selection at a reasonable bandwidth for
    // broadband internet
    this.bandwidth = options.bandwidth || 4194304; // 0.5 Mbps
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

    this.on(this.tech_, 'seeking', function() {
      this.setCurrentTime(this.tech_.currentTime());
    });
    this.on(this.tech_, 'error', function() {
      this.segments.pause();
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
      return videojs.HlsSourceHandler.canPlayType(srcObj.type);
    },
    handleSource: function(source, tech) {
      if (mode === 'flash') {
        // We need to trigger this asynchronously to give others the chance
        // to bind to the event when a source is set at player creation
        tech.setTimeout(function() {
          tech.trigger('loadstart');
        }, 1);
      }
      tech.hls = new videojs.HlsHandler(tech, {
        source: source,
        mode: mode
      });
      tech.hls.src(source.src);
      return tech.hls;
    },
    canPlayType: function(type) {
      return videojs.HlsSourceHandler.canPlayType(type);
    }
  };
};

videojs.HlsSourceHandler.canPlayType = function(type) {
  var mpegurlRE = /^application\/(?:x-|vnd\.apple\.)mpegurl/i;

  // favor native HLS support if it's available
  if (videojs.Hls.supportsNativeHls) {
    return false;
  }
  return mpegurlRE.test(type);
};

// register source handlers with the appropriate techs
if (videojs.MediaSource.supportsNativeMediaSources()) {
  videojs.getComponent('Html5').registerSourceHandler(videojs.HlsSourceHandler('html5'));
}
if (window.Uint8Array) {
  videojs.getComponent('Flash').registerSourceHandler(videojs.HlsSourceHandler('flash'));
}

// the desired length of video to maintain in the buffer, in seconds
videojs.Hls.GOAL_BUFFER_LENGTH = 30;
// Fudge factor to account for TimeRanges rounding
videojs.Hls.TIME_FUDGE_FACTOR = 1 / 30;

videojs.HlsHandler.prototype.src = function(src) {
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

  this.tech_.one('canplay', this.setupFirstPlay.bind(this));

  this.playlists = new videojs.Hls.PlaylistLoader(this.source_.src, this.options_.withCredentials);

  this.playlists.on('loadedmetadata', function() {
    oldMediaPlaylist = this.playlists.media();

    // if this isn't a live video and preload permits, start
    // downloading segments
    if (oldMediaPlaylist.endList &&
        this.tech_.preload() !== 'metadata' &&
        this.tech_.preload() !== 'none') {
      this.loadingState_ = 'segments';

      this.segments.playlist(this.playlists.media());
      this.segments.load();
    }

    this.setupSourceBuffer_();
    this.setupFirstPlay();
    this.tech_.trigger('loadedmetadata');
  }.bind(this));

  this.playlists.on('error', function() {
    this.blacklistCurrentPlaylist_(this.playlists.error);
  }.bind(this));

  this.playlists.on('loadedplaylist', function() {
    var updatedPlaylist = this.playlists.media(), seekable;

    if (!updatedPlaylist) {
      // select the initial variant
      this.playlists.media(this.selectPlaylist());
      return;
    }

    this.segments.playlist(updatedPlaylist);
    this.updateDuration(updatedPlaylist);

    // update seekable
    seekable = this.seekable();
    if (this.duration() === Infinity &&
        seekable.length !== 0) {
      this.mediaSource.addSeekableRange_(seekable.start(0), seekable.end(0));
    }

    oldMediaPlaylist = updatedPlaylist;
  }.bind(this));

  this.playlists.on('mediachanging', function() {
    this.segments.pause();
  }.bind(this));
  this.playlists.on('mediachange', function() {
    this.segments.abort();
    this.segments.load();
    this.tech_.trigger({
      type: 'mediachange',
      bubbles: true
    });
  }.bind(this));

  this.segments = new videojs.Hls.SegmentLoader({
    currentTime: this.tech_.currentTime.bind(this.tech_),
    mediaSource: this.mediaSource,
    withCredentials: this.options_.withCredentials
  });

  this.segments.on('progress', function() {
    // figure out what stream the next segment should be downloaded from
    // with the updated bandwidth information
    this.bandwidth = this.segments.bandwidth;
    this.playlists.media(this.selectPlaylist());
  }.bind(this));
  this.segments.on('error', function() {
    this.blacklistCurrentPlaylist_(this.segments.error());
  }.bind(this));

  // do nothing if the tech has been disposed already
  // this can occur if someone sets the src in player.ready(), for instance
  if (!this.tech_.el()) {
    return;
  }

  this.tech_.src(videojs.URL.createObjectURL(this.mediaSource));
};

videojs.HlsHandler.prototype.handleSourceOpen = function() {
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

var parseCodecs = function(codecs) {
  var result = {
    codecCount: 0,
    videoCodec: null,
    audioProfile: null
  };

  result.codecCount = codecs.split(',').length;
  result.codecCount = result.codecCount || 2;

  // parse the video codec but ignore the version
  result.videoCodec = /(^|\s|,)+(avc1)[^ ,]*/i.exec(codecs);
  result.videoCodec = result.videoCodec && result.videoCodec[2];

  // parse the last field of the audio codec
  result.audioProfile = /(^|\s|,)+mp4a.\d+\.(\d+)/i.exec(codecs);
  result.audioProfile = result.audioProfile && result.audioProfile[2];

  return result;
};

/**
 * Blacklist playlists that are known to be codec or
 * stream-incompatible with the SourceBuffer configuration. For
 * instance, Media Source Extensions would cause the video element to
 * stall waiting for video data if you switched from a variant with
 * video and audio to an audio-only one.
 *
 * @param media {object} a media playlist compatible with the current
 * set of SourceBuffers. Variants in the current master playlist that
 * do not appear to have compatible codec or stream configurations
 * will be excluded from the default playlist selection algorithm
 * indefinitely.
 */
videojs.HlsHandler.prototype.excludeIncompatibleVariants_ = function(media) {
  var
    master = this.playlists.master,
    codecCount = 2,
    videoCodec = null,
    audioProfile = null,
    codecs;

  if (media.attributes && media.attributes.CODECS) {
    codecs = parseCodecs(media.attributes.CODECS);
    videoCodec = codecs.videoCodec;
    audioProfile = codecs.audioProfile;
    codecCount = codecs.codecCount;
  }
  master.playlists.forEach(function(variant) {
    var variantCodecs = {
      codecCount: 2,
      videoCodec: null,
      audioProfile: null
    };

    if (variant.attributes && variant.attributes.CODECS) {
      variantCodecs = parseCodecs(variant.attributes.CODECS);
    }

    // if the streams differ in the presence or absence of audio or
    // video, they are incompatible
    if (variantCodecs.codecCount !== codecCount) {
      variant.excludeUntil = Infinity;
    }

    // if h.264 is specified on the current playlist, some flavor of
    // it must be specified on all compatible variants
    if (variantCodecs.videoCodec !== videoCodec) {
      variant.excludeUntil = Infinity;
    }
    // HE-AAC ("mp4a.40.5") is incompatible with all other versions of
    // AAC audio in Chrome 46. Don't mix the two.
    if ((variantCodecs.audioProfile === '5' && audioProfile !== '5') ||
        (audioProfile === '5' && variantCodecs.audioProfile !== '5')) {
      variant.excludeUntil = Infinity;
    }
  });
};

videojs.HlsHandler.prototype.setupSourceBuffer_ = function() {
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

  // exclude any incompatible variant streams from future playlist
  // selection
  this.excludeIncompatibleVariants_(media);
};

/**
 * Seek to the latest media position if this is a live video and the
 * player and video are loaded and initialized.
 */
videojs.HlsHandler.prototype.setupFirstPlay = function() {
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
      media &&

      // 5) the video element or flash player is in a readyState of
      // at least HAVE_FUTURE_DATA
      this.tech_.readyState() >= 1) {

    // trigger the playlist loader to start "expired time"-tracking
    this.playlists.trigger('firstplay');

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
videojs.HlsHandler.prototype.play = function() {
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
    if (this.tech_.currentTime() < this.seekable().start(0)) {
      this.tech_.setCurrentTime(this.seekable().start(0));
    }
  }
};

videojs.HlsHandler.prototype.setCurrentTime = function(currentTime) {
  var buffered = videojs.Hls.Ranges.findRange_(this.tech_.buffered(), currentTime);

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

  // if we are in the middle of appending a segment, let it finish up
  if (this.pendingSegment_ && this.pendingSegment_.buffered) {
    return currentTime;
  }

  this.lastSegmentLoaded_ = null;

  // cancel outstanding requests so we begin buffering at the new
  // location
  this.segments.abort();

  if (!this.tech_.paused()) {
    this.segments.load();
  }

  // abort outstanding key requests, if necessary
  if (this.keyXhr_) {
    this.keyXhr_.aborted = true;
    this.cancelKeyXhr();
  }
};

videojs.HlsHandler.prototype.duration = function() {
  var
    playlists = this.playlists,
    playlistDuration;

  if (playlists) {
    playlistDuration = videojs.Hls.Playlist.duration(playlists.media());
  } else {
    return 0;
  }

  if (playlistDuration === Infinity) {
    return playlistDuration;
  } else if (this.mediaSource) {
    return this.mediaSource.duration;
  } else {
    return playlistDuration;
  }
};

videojs.HlsHandler.prototype.seekable = function() {
  var media, seekable;

  if (!this.playlists) {
    return videojs.createTimeRanges();
  }
  media = this.playlists.media();
  if (!media) {
    return videojs.createTimeRanges();
  }

  seekable = videojs.Hls.Playlist.seekable(media);
  if (seekable.length === 0) {
    return seekable;
  }

  // if the seekable start is zero, it may be because the player has
  // been paused for a long time and stopped buffering. in that case,
  // fall back to the playlist loader's running estimate of expired
  // time
  if (seekable.start(0) === 0) {
   return videojs.createTimeRanges([[
      this.playlists.expired_,
      this.playlists.expired_ + seekable.end(0)
    ]]);
  }

  // seekable has been calculated based on buffering video data so it
  // can be returned directly
  return seekable;
};

/**
 * Update the player duration
 */
videojs.HlsHandler.prototype.updateDuration = function(playlist) {
  var oldDuration = this.mediaSource.duration,
      newDuration = videojs.Hls.Playlist.duration(playlist),
      setDuration = function() {
        this.mediaSource.duration = newDuration;
        this.tech_.trigger('durationchange');

        this.mediaSource.removeEventListener('sourceopen', setDuration);
      }.bind(this);

  // if the duration has changed, invalidate the cached value
  if (oldDuration !== newDuration) {
    // update the duration
    if (this.mediaSource.readyState !== 'open') {
      this.mediaSource.addEventListener('sourceopen', setDuration);
    } else if (!this.sourceBuffer || !this.sourceBuffer.updating) {
      this.mediaSource.duration = newDuration;
      this.tech_.trigger('durationchange');
    }
  }
};

/**
 * Clear all buffers and reset any state relevant to the current
 * source. After this function is called, the tech should be in a
 * state suitable for switching to a different video.
 */
videojs.HlsHandler.prototype.resetSrc_ = function() {
  if (this.sourceBuffer && this.mediaSource.readyState === 'open') {
    this.sourceBuffer.abort();
  }
};

videojs.HlsHandler.prototype.cancelKeyXhr = function() {
  if (this.keyXhr_) {
    this.keyXhr_.onreadystatechange = null;
    this.keyXhr_.abort();
    this.keyXhr_ = null;
  }
};

/**
 * Abort all outstanding work and cleanup.
 */
videojs.HlsHandler.prototype.dispose = function() {
  if (this.playlists) {
    this.playlists.dispose();
  }
  if (this.segments) {
    this.segments.dispose();
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
videojs.HlsHandler.prototype.selectPlaylist = function () {
  var
    effectiveBitrate,
    sortedPlaylists = this.playlists.master.playlists.slice(),
    bandwidthPlaylists = [],
    now = +new Date(),
    i,
    variant,
    bandwidthBestVariant,
    resolutionPlusOne,
    resolutionBestVariant,
    width,
    height;

  sortedPlaylists.sort(videojs.Hls.comparePlaylistBandwidth);

  // filter out any playlists that have been excluded due to
  // incompatible configurations or playback errors
  sortedPlaylists = sortedPlaylists.filter(function(variant) {
    if (variant.excludeUntil !== undefined) {
      return now >= variant.excludeUntil;
    }
    return true;
  });

  // filter out any variant that has greater effective bitrate
  // than the current estimated bandwidth
  i = sortedPlaylists.length;
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
      // if both dimensions are less than the player use the
      // previous (next-largest) variant
      break;
    } else if (!resolutionPlusOne ||
               (variant.attributes.RESOLUTION.width < resolutionPlusOne.attributes.RESOLUTION.width &&
                variant.attributes.RESOLUTION.height < resolutionPlusOne.attributes.RESOLUTION.height)) {
      // If we still haven't found a good match keep a
      // reference to the previous variant for the next loop
      // iteration

      // By only saving variants if they are smaller than the
      // previously saved variant, we ensure that we also pick
      // the highest bandwidth variant that is just-larger-than
      // the video player
      resolutionPlusOne = variant;
    }
  }

  // fallback chain of variants
  return resolutionPlusOne || resolutionBestVariant || bandwidthBestVariant || sortedPlaylists[0];
};

var filterBufferedRanges = function(predicate) {
  return function(time) {
    var
      i,
      ranges = [],
      tech = this.tech_,
      // !!The order of the next two assignments is important!!
      // `currentTime` must be equal-to or greater-than the start of the
      // buffered range. Flash executes out-of-process so, every value can
      // change behind the scenes from line-to-line. By reading `currentTime`
      // after `buffered`, we ensure that it is always a current or later
      // value during playback.
      buffered = tech.buffered();


    if (time === undefined) {
      time = tech.currentTime();
    }

    if (buffered && buffered.length) {
      // Search for a range containing the play-head
      for (i = 0; i < buffered.length; i++) {
        if (predicate(buffered.start(i), buffered.end(i), time)) {
          ranges.push([buffered.start(i), buffered.end(i)]);
        }
      }
    }

    return videojs.createTimeRanges(ranges);
  };
};

/**
 * Attempts to find the buffered TimeRange that contains the specified
 * time, or where playback is currently happening if no specific time
 * is specified.
 * @param time (optional) {number} the time to filter on. Defaults to
 * currentTime.
 * @return a new TimeRanges object.
 */
videojs.HlsHandler.prototype.findBufferedRange_ = filterBufferedRanges(function(start, end, time) {
  return start - videojs.Hls.TIME_FUDGE_FACTOR <= time &&
    end + videojs.Hls.TIME_FUDGE_FACTOR >= time;
});

/**
 * Returns the TimeRanges that begin at or later than the specified
 * time.
 * @param time (optional) {number} the time to filter on. Defaults to
 * currentTime.
 * @return a new TimeRanges object.
 */
videojs.HlsHandler.prototype.findNextBufferedRange_ = filterBufferedRanges(function(start, end, time) {
  return start - videojs.Hls.TIME_FUDGE_FACTOR >= time;
});

videojs.HlsHandler.prototype.playlistUriToUrl = function(segmentRelativeUrl) {
  var playListUrl;
    // resolve the segment URL relative to the playlist
  if (this.playlists.media().uri === this.source_.src) {
    playListUrl = resolveUrl(this.source_.src, segmentRelativeUrl);
  } else {
    playListUrl = resolveUrl(resolveUrl(this.source_.src, this.playlists.media().uri || ''), segmentRelativeUrl);
  }
  return playListUrl;
};

/*  Turns segment byterange into a string suitable for use in
 *  HTTP Range requests
 */
videojs.HlsHandler.prototype.byterangeStr_ = function(byterange) {
    var byterangeStart, byterangeEnd;

    // `byterangeEnd` is one less than `offset + length` because the HTTP range
    // header uses inclusive ranges
    byterangeEnd = byterange.offset + byterange.length - 1;
    byterangeStart = byterange.offset;
    return "bytes=" + byterangeStart + "-" + byterangeEnd;
};

/*  Defines headers for use in the xhr request for a particular segment.
 */
videojs.HlsHandler.prototype.segmentXhrHeaders_ = function(segment) {
  var headers = {};
  if ('byterange' in segment) {
      headers['Range'] = this.byterangeStr_(segment.byterange);
  }
  return headers;
};

/*
 * Sets `bandwidth`, `segmentXhrTime`, and appends to the `bytesReceived.
 * Expects an object with:
 *  * `roundTripTime` - the round trip time for the request we're setting the time for
 *  * `bandwidth` - the bandwidth we want to set
 *  * `bytesReceived` - amount of bytes downloaded
 * `bandwidth` is the only required property.
 */
videojs.HlsHandler.prototype.setBandwidth = function(xhr) {
  // calculate the download bandwidth
  this.segmentXhrTime = xhr.roundTripTime;
  this.bandwidth = xhr.bandwidth;
  this.bytesReceived += xhr.bytesReceived || 0;

  this.tech_.trigger('bandwidthupdate');
};

/*
 * Blacklists a playlist when an error occurs for a set amount of time
 * making it unavailable for selection by the rendition selection algorithm
 * and then forces a new playlist (rendition) selection.
 */
videojs.HlsHandler.prototype.blacklistCurrentPlaylist_ = function(error) {
  var currentPlaylist, nextPlaylist;

  // If the `error` was generated by the playlist loader, it will contain
  // the playlist we were trying to load (but failed) and that should be
  // blacklisted instead of the currently selected playlist which is likely
  // out-of-date in this scenario
  currentPlaylist = error.playlist || this.playlists.media();

  // If there is no current playlist, then an error occurred while we were
  // trying to load the master OR while we were disposing of the tech
  if (!currentPlaylist) {
    this.error = error;
    return this.mediaSource.endOfStream('network');
  }

  // Blacklist this playlist
  currentPlaylist.excludeUntil = Date.now() + blacklistDuration;

  // Select a new playlist
  nextPlaylist = this.selectPlaylist();

  if (nextPlaylist) {
    videojs.log.warn('Problem encountered with the current HLS playlist. Switching to another playlist.');

    return this.playlists.media(nextPlaylist);
  } else {
    videojs.log.warn('Problem encountered with the current HLS playlist. No suitable alternatives found.');
    // We have no more playlists we can select so we must fail
    this.error = error;
    return this.mediaSource.endOfStream('network');
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

/*
 * video-js-hls
 *
 *
 * Copyright (c) 2013 Brightcove
 * All rights reserved.
 */

(function(window, videojs, document, undefined) {

videojs.hls = {
  /**
   * Whether the browser has built-in HLS support.
   */
  supportsNativeHls: (function() {
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
  })()
};

var
  // the desired length of video to maintain in the buffer, in seconds
  goalBufferLength = 5,

  // a fudge factor to apply to advertised playlist bitrates to account for
  // temporary flucations in client bandwidth
  bandwidthVariance = 1.1,

  /**
   * A comparator function to sort two playlist object by bandwidth.
   * @param left {object} a media playlist object
   * @param right {object} a media playlist object
   * @return {number} Greater than zero if the bandwidth attribute of
   * left is greater than the corresponding attribute of right. Less
   * than zero if the bandwidth of right is greater than left and
   * exactly zero if the two are equal.
   */
  playlistBandwidth = function(left, right) {
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
  },

  /**
   * A comparator function to sort two playlist object by resolution (width).
   * @param left {object} a media playlist object
   * @param right {object} a media playlist object
   * @return {number} Greater than zero if the resolution.width attribute of
   * left is greater than the corresponding attribute of right. Less
   * than zero if the resolution.width of right is greater than left and
   * exactly zero if the two are equal.
   */
  playlistResolution = function(left, right) {
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
  },

  /**
   * Creates and sends an XMLHttpRequest.
   * @param options {string | object} if this argument is a string, it
   * is intrepreted as a URL and a simple GET request is
   * inititated. If it is an object, it should contain a `url`
   * property that indicates the URL to request and optionally a
   * `method` which is the type of HTTP request to send.
   * @return {object} the XMLHttpRequest that was initiated.
   */
  xhr = function(url, callback) {
    var
      options = {
        method: 'GET'
      },
      request;
    if (typeof url === 'object') {
      options = videojs.util.mergeOptions(options, url);
      url = options.url;
    }
    request = new window.XMLHttpRequest();
    request.open(options.method, url);
    request.onreadystatechange = function() {
      // wait until the request completes
      if (this.readyState !== 4) {
        return;
      }

      // request error
      if (this.status >= 400 || this.status === 0) {
        return callback.call(this, true, url);
      }

      return callback.call(this, false, url);
    };
    request.send(null);
    return request;
  },

  /**
   * TODO - Document this great feature.
   *
   * @param playlist
   * @param time
   * @returns int
   */
  getMediaIndexByTime = function(playlist, time) {
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

  },

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
  translateMediaIndex = function(mediaIndex, original, update) {
    var
      i = update.segments.length,
      originalSegment;

    // no segments have been loaded from the original playlist
    if (mediaIndex === 0) {
      return 0;
    }

    // try to sync based on URI
    originalSegment = original.segments[mediaIndex - 1];
    while (i--) {
      if (originalSegment.uri === update.segments[i].uri) {
        return i + 1;
      }
    }

    // sync on media sequence
    return (original.mediaSequence + mediaIndex) - update.mediaSequence;
  },

  /**
   * Calculate the total duration for a playlist based on segment metadata.
   * @param playlist {object} a media playlist object
   * @return {number} the currently known duration, in seconds
   */
  totalDuration = function(playlist) {
    var
      duration = 0,
      segment,
      i = (playlist.segments || []).length;

    // if present, use the duration specified in the playlist
    if (playlist.totalDuration) {
      return playlist.totalDuration;
    }

    // duration should be Infinity for live playlists
    if (!playlist.endList) {
      return window.Infinity;
    }

    while (i--) {
      segment = playlist.segments[i];
      duration += segment.duration || playlist.targetDuration || 0;
    }
    return duration;
  },

  /**
   * Constructs a new URI by interpreting a path relative to another
   * URI.
   * @param basePath {string} a relative or absolute URI
   * @param path {string} a path part to combine with the base
   * @return {string} a URI that is equivalent to composing `base`
   * with `path`
   * @see http://stackoverflow.com/questions/470832/getting-an-absolute-url-from-a-relative-one-ie6-issue
   */
  resolveUrl = function(basePath, path) {
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
  },

  /**
   * Initializes the HLS plugin.
   * @param options {mixed} the URL to an HLS playlist
   */
  init = function(options) {
    var
      mediaSource = new videojs.MediaSource(),
      segmentParser = new videojs.hls.SegmentParser(),
      player = this,

      // async queue of Uint8Arrays to be appended to the SourceBuffer
      tags = videojs.hls.queue(function(tag) {
        player.hls.sourceBuffer.appendBuffer(tag, player);

        if (player.hls.mediaIndex === player.hls.media.segments.length) {
          mediaSource.endOfStream();
        }
      }),
      srcUrl,

      playlistXhr,
      segmentXhr,
      loadedPlaylist,
      fillBuffer,
      updateCurrentPlaylist,
      updateDuration;

    // if the video element supports HLS natively, do nothing
    if (videojs.hls.supportsNativeHls) {
      return;
    }

    srcUrl = (function() {
      var
        extname,
        i = 0,
        j = 0,
        src = player.el().querySelector('.vjs-tech').src,
        sources = player.options().sources,
        techName,
        length = sources.length;

      // use the URL specified in options if one was provided
      if (typeof options === 'string') {
        return options;
      } else if (options) {
        return options.url;
      }

      // src attributes take precedence over source children
      if (src) {

        // assume files with the m3u8 extension are HLS
        extname = (/[^#?]*(?:\/[^#?]*\.([^#?]*))/).exec(src);
        if (extname && extname[1] === 'm3u8') {
          return src;
        }
        return;
      }

      // find the first playable source
      for (; i < length; i++) {

        // ignore sources without a specified type
        if (!sources[i].type) {
          continue;
        }

        // do nothing if the source is handled by one of the standard techs
        for (j in player.options().techOrder) {
          techName = player.options().techOrder[j];
          techName = techName[0].toUpperCase() + techName.substring(1);
          if (videojs[techName].canPlaySource({ type: sources[i].type })) {
            return;
          }
        }

        // use the plugin if the MIME type specifies HLS
        if ((/application\/x-mpegURL/).test(sources[i].type) ||
            (/application\/vnd\.apple\.mpegURL/).test(sources[i].type)) {
          return sources[i].src;
        }
      }
    })();

    if (!srcUrl) {
      // do nothing until the plugin is initialized with a valid URL
      videojs.log('hls: no valid playlist URL specified');
      return;
    }

    // expose the HLS plugin state
    player.hls.readyState = function() {
      if (!player.hls.media) {
        return 0; // HAVE_NOTHING
      }
      return 1;   // HAVE_METADATA
    };

    player.on('seeking', function() {
      var currentTime = player.currentTime();
      player.hls.mediaIndex = getMediaIndexByTime(player.hls.media, currentTime);

      // cancel outstanding requests and buffer appends
      if (segmentXhr) {
        segmentXhr.abort();
      }
      tags.tasks = [];

      // begin filling the buffer at the new position
      fillBuffer(currentTime * 1000);
    });

    // expose the HLS rules for determining the initial media index
    // this will allow future extention
    player.hls.determineInitialMediaIndexByPlaylist = function(playlist) {
      var proposedMediaIndex = 0;
      // VOD
      // Always start from 0
      if (totalDuration(playlist) !== Infinity) {
        proposedMediaIndex = 0;
      }
      // Live
      // Find the point closest to the end with a full goalbuffer.
      if (totalDuration(playlist) === Infinity &&
          playlist.segments && playlist.segments.length > 0) {
        // Have Segments
        var currentSegmentRange, timeRanges = [];
        for (index = 0; index < playlist.segments.length; index++) {
          currentSegmentRange = {};
          currentSegmentRange.start = (index === 0) ? 0 : timeRanges[index - 1].end;
          currentSegmentRange.end = currentSegmentRange.start + playlist.segments[index].duration;
          currentSegmentRange.duration = currentSegmentRange.end - currentSegmentRange.start;
          timeRanges.push(currentSegmentRange);
        }

        // Work backwards to make sure you have enough for goal buffers
        var i = timeRanges.length;
        var concatinatedBuffer = 0;

        while (i--) {
          if( (timeRanges[i].duration + concatinatedBuffer) >= goalBufferLength) {
            proposedMediaIndex = i;
            break;
          } else {
            concatinatedBuffer += timeRanges[i].duration;
          }
        }

      } else {
        // No Segments or UNKNOWN condition
        proposedMediaIndex = 0;
      }

      // Should never happen
      if (proposedMediaIndex < 0) {
        proposedMediaIndex = 0;
      }

      console.log('media index', proposedMediaIndex);

      return proposedMediaIndex;

    };


    /**
     * Update the player duration
     */
    updateDuration = function(playlist) {
      var tech;
      // update the duration
      player.duration(totalDuration(playlist));
      // tell the flash tech of the new duration
      tech = player.el().querySelector('.vjs-tech');
      if(tech.vjs_setProperty) {
        tech.vjs_setProperty('duration', player.duration());
      }
      // manually fire the duration change
      player.trigger('durationchange');
    };

    /**
     * Determine whether the current media playlist should be changed
     * and trigger a switch if necessary. If a sufficiently fresh
     * version of the target playlist is available, the switch will take
     * effect immediately. Otherwise, the target playlist will be
     * refreshed.
     */
    updateCurrentPlaylist = function() {
      var playlist, mediaSequence;
      playlist = player.hls.selectPlaylist();
      mediaSequence = player.hls.mediaIndex + (player.hls.media.mediaSequence || 0);
      if (!playlist.segments ||
          mediaSequence < (playlist.mediaSequence || 0) ||
          mediaSequence > (playlist.mediaSequence || 0) + playlist.segments.length) {

        if (playlistXhr) {
          playlistXhr.abort();
        }
        playlistXhr = xhr(resolveUrl(srcUrl, playlist.uri), loadedPlaylist);
      } else {
        player.hls.mediaIndex =
          translateMediaIndex(player.hls.mediaIndex,
                              player.hls.media,
                              playlist);
        player.hls.media = playlist;

        updateDuration(player.hls.media);
      }
    };

    /**
     * Chooses the appropriate media playlist based on the current
     * bandwidth estimate and the player size.
     * @return the highest bitrate playlist less than the currently detected
     * bandwidth, accounting for some amount of bandwidth variance
     */
    player.hls.selectPlaylist = function () {
      var
        effectiveBitrate,
        sortedPlaylists = player.hls.master.playlists.slice(),
        bandwidthPlaylists = [],
        i = sortedPlaylists.length,
        variant,
        bandwidthBestVariant,
        resolutionBestVariant;

      sortedPlaylists.sort(playlistBandwidth);

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
      bandwidthPlaylists.sort(playlistResolution);

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
     * Callback that is invoked when a media playlist finishes
     * downloading. Triggers `loadedmanifest` once for each playlist
     * that is downloaded and `loadedmetadata` after at least one
     * media playlist has been parsed.
     *
     * @param error {*} truthy if the request was not successful
     * @param url {string} a URL to the M3U8 file to process
     */
    loadedPlaylist = function(error, url) {
      var i, parser, playlist, playlistUri, refreshDelay;

      // clear the current playlist XHR
      playlistXhr = null;

      if (error) {
        player.hls.error = {
          status: this.status,
          message: 'HLS playlist request error at URL: ' + url,
          code: (this.status >= 500) ? 4 : 2
        };
        return player.trigger('error');
      }

      parser = new videojs.m3u8.Parser();
      parser.push(this.responseText);

      // merge this playlist into the master
      i = player.hls.master.playlists.length;
      refreshDelay = (parser.manifest.targetDuration || 10) * 1000;
      while (i--) {
        playlist = player.hls.master.playlists[i];
        playlistUri = resolveUrl(srcUrl, playlist.uri);
        if (playlistUri === url) {
          // if the playlist is unchanged since the last reload,
          // try again after half the target duration
          // http://tools.ietf.org/html/draft-pantos-http-live-streaming-12#section-6.3.4
          if (playlist.segments &&
              playlist.segments.length === parser.manifest.segments.length) {
            refreshDelay /= 2;
          }

          player.hls.master.playlists[i] =
            videojs.util.mergeOptions(playlist, parser.manifest);

          if (playlist !== player.hls.media) {
            continue;
          }

          // determine the new mediaIndex if we're updating the
          // current media playlist
          player.hls.mediaIndex =
            translateMediaIndex(player.hls.mediaIndex,
                                playlist,
                                parser.manifest);
          player.hls.media = parser.manifest;
        }
      }

      // check the playlist for updates if EXT-X-ENDLIST isn't present
      if (!parser.manifest.endList) {
        window.setTimeout(function() {
          if (!playlistXhr &&
              resolveUrl(srcUrl, player.hls.media.uri) === url) {
            playlistXhr = xhr(url, loadedPlaylist);
          }
        }, refreshDelay);
      }

      // always start playback with the default rendition
      if (!player.hls.media) {
        player.hls.media = player.hls.master.playlists[0];

        // update the duration
        updateDuration(parser.manifest);

        // find the initial media index
        player.hls.mediaIndex = player.hls.determineInitialMediaIndexByPlaylist(parser.manifest);

        // periodicaly check if the buffer needs to be refilled
        player.on('timeupdate', fillBuffer);

        player.trigger('loadedmanifest');
        player.trigger('loadedmetadata');
        fillBuffer();
        return;
      }

      // select a playlist and download its metadata if necessary
      updateCurrentPlaylist();

      player.trigger('loadedmanifest');
    };

    /**
     * Determines whether there is enough video data currently in the buffer
     * and downloads a new segment if the buffered time is less than the goal.
     * @param offset (optional) {number} the offset into the downloaded segment
     * to seek to, in milliseconds
     */
    fillBuffer = function(offset) {
      var
        buffered = player.buffered(),
        bufferedTime = 0,
        segment,
        segmentUri,
        startTime;

      // if there is a request already in flight, do nothing
      if (segmentXhr) {
        return;
      }

      // if no segments are available, do nothing
      if (!player.hls.media.segments) {
        return;
      }

      // if the video has finished downloading, stop trying to buffer
      segment = player.hls.media.segments[player.hls.mediaIndex];
      if (!segment) {
        return;
      }

      if (buffered) {
        // assuming a single, contiguous buffer region
        bufferedTime = player.buffered().end(0) - player.currentTime();
      }

      // if there is plenty of content in the buffer, relax for awhile
      if (bufferedTime >= goalBufferLength) {
        return;
      }

      // resolve the segment URL relative to the playlist
      if (player.hls.media.uri === srcUrl) {
        segmentUri = resolveUrl(srcUrl, segment.uri);
      } else {
        segmentUri = resolveUrl(resolveUrl(srcUrl, player.hls.media.uri || ''),
                                segment.uri);
      }

      // request the next segment
      segmentXhr = new window.XMLHttpRequest();
      segmentXhr.open('GET', segmentUri);
      segmentXhr.responseType = 'arraybuffer';
      segmentXhr.onreadystatechange = function() {
        // wait until the request completes
        if (this.readyState !== 4) {
          return;
        }

        // the segment request is no longer outstanding
        segmentXhr = null;

        // trigger an error if the request was not successful
        if (this.status >= 400) {
          player.hls.error = {
            status: this.status,
            message: 'HLS segment request error at URL: ' + segmentUri,
            code: (this.status >= 500) ? 4 : 2
          };

          // try moving on to the next segment
          player.hls.mediaIndex++;
          return;
        }

        // stop processing if the request was aborted
        if (!this.response) {
          return;
        }

        // calculate the download bandwidth
        player.hls.segmentXhrTime = (+new Date()) - startTime;
        player.hls.bandwidth = (this.response.byteLength / player.hls.segmentXhrTime) * 8 * 1000;

        // transmux the segment data from MP2T to FLV
        segmentParser.parseSegmentBinaryData(new Uint8Array(this.response));
        segmentParser.flushTags();

        // if we're refilling the buffer after a seek, scan through the muxed
        // FLV tags until we find the one that is closest to the desired
        // playback time
        if (offset !== undefined && typeof offset === "number") {
          while (segmentParser.getTags()[0].pts < offset) {
            segmentParser.getNextTag();
          }
        }

        while (segmentParser.tagsAvailable()) {
          // queue up the bytes to be appended to the SourceBuffer
          // the queue gives control back to the browser between tags
          // so that large segments don't cause a "hiccup" in playback
          tags.push(segmentParser.getNextTag().bytes);
        }

        player.hls.mediaIndex++;

        // figure out what stream the next segment should be downloaded from
        // with the updated bandwidth information
        updateCurrentPlaylist();
      };
      startTime = +new Date();
      segmentXhr.send(null);
    };

    // load the MediaSource into the player
    mediaSource.addEventListener('sourceopen', function() {
      // construct the video data buffer and set the appropriate MIME type
      var sourceBuffer = mediaSource.addSourceBuffer('video/flv; codecs="vp6,aac"');
      player.hls.sourceBuffer = sourceBuffer;
      sourceBuffer.appendBuffer(segmentParser.getFlvHeader());

      player.hls.mediaIndex = 0;
      xhr(srcUrl, function(error, url) {
        var uri, parser = new videojs.m3u8.Parser();
        parser.push(this.responseText);

        // master playlists
        if (parser.manifest.playlists) {
          player.hls.master = parser.manifest;
          playlistXhr = xhr(resolveUrl(url, parser.manifest.playlists[0].uri), loadedPlaylist);
          return player.trigger('loadedmanifest');
        } else {
          // infer a master playlist if a media playlist is loaded directly
          uri = resolveUrl(window.location.href, url);
          player.hls.master = {
            playlists: [{
              uri: uri
            }]
          };
          loadedPlaylist.call(this, error, uri);
        }
      });
    });
    player.src([{
      src: videojs.URL.createObjectURL(mediaSource),
      type: "video/flv"
    }]);

    if (player.options().autoplay) {
      player.play();
    }
  };

videojs.plugin('hls', function() {
  if (typeof Uint8Array === 'undefined') {
    return;
  }

  var initialize = function() {
    return function() {
      this.hls = initialize();
      init.apply(this, arguments);
    };
  };
  initialize().apply(this, arguments);
});

})(window, window.videojs, document);

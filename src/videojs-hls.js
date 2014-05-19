/*
 * video-js-hls
 *
 *
 * Copyright (c) 2013 Brightcove
 * All rights reserved.
 */

(function(window, videojs, document, undefined) {

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

  xhr,

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

  resolveUrl,

  /**
   * Initializes the HLS plugin.
   * @param options {mixed} the URL to an HLS playlist
   */
  init = function(options, mediaSource) {
    var
      segmentParser = new videojs.Hls.SegmentParser(),
      player = this,
      srcUrl,

      segmentXhr,
      settings,
      fillBuffer,
      updateDuration;

    // if the video element supports HLS natively, do nothing
    if (videojs.Hls.supportsNativeHls) {
      return;
    }

    settings = videojs.util.mergeOptions({}, options);

    srcUrl = (function() {
      var
        extname,
        i = 0,
        j = 0,
        sources = player.options().sources,
        techName,
        length = sources.length;

      // use the URL specified in options if one was provided
      if (typeof options === 'string') {
        return options;
      } else if (options && options.url) {
        return options.url;
      }

      // find the first playable source
      for (; i < length; i++) {

        // ignore sources without a specified type
        if (!sources[i].type) {
          continue;
        }

        // do nothing if the source is handled by one of the standard techs
        //for (j in player.options().techOrder) {
          //techname = player.options().techorder[j];
          //techname = techname[0].touppercase() + techname.substring(1);
          //if (videojs[techname].canplaysource({ type: sources[i].type })) {
            //return;
          //}
        //}

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
      player.hls.mediaIndex = getMediaIndexByTime(player.hls.playlists.media(),
                                                  currentTime);

      // abort any segments still being decoded
      player.hls.sourceBuffer.abort();

      // cancel outstanding requests and buffer appends
      if (segmentXhr) {
        segmentXhr.abort();
      }

      // begin filling the buffer at the new position
      fillBuffer(currentTime * 1000);
    });

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
     * Chooses the appropriate media playlist based on the current
     * bandwidth estimate and the player size.
     * @return the highest bitrate playlist less than the currently detected
     * bandwidth, accounting for some amount of bandwidth variance
     */
    player.hls.selectPlaylist = function () {
      var
        effectiveBitrate,
        sortedPlaylists = player.hls.playlists.master.playlists.slice(),
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
      if (!player.hls.playlists.media().segments) {
        return;
      }

      // if the video has finished downloading, stop trying to buffer
      segment = player.hls.playlists.media().segments[player.hls.mediaIndex];
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
      if (player.hls.playlists.media().uri === srcUrl) {
        segmentUri = resolveUrl(srcUrl, segment.uri);
      } else {
        segmentUri = resolveUrl(resolveUrl(srcUrl, player.hls.playlists.media().uri || ''),
                                segment.uri);
      }

      startTime = +new Date();

      // request the next segment
      segmentXhr = xhr({
        url: segmentUri,
        responseType: 'arraybuffer',
        withCredentials: settings.withCredentials
      }, function(error, url) {
        // the segment request is no longer outstanding
        segmentXhr = null;

        if (error) {
          player.hls.error = {
            status: this.status,
            message: 'HLS segment request error at URL: ' + url,
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

          player.hls.sourceBuffer.appendBuffer(segmentParser.getNextTag().bytes,
                                               player);

        }

        player.hls.mediaIndex++;

        if (player.hls.mediaIndex === player.hls.playlists.media().segments.length) {
          mediaSource.endOfStream();
        }

        // figure out what stream the next segment should be downloaded from
        // with the updated bandwidth information
        player.hls.playlists.media(player.hls.selectPlaylist());
      });
    };

    // load the MediaSource into the player
    mediaSource.addEventListener('sourceopen', function() {
      // construct the video data buffer and set the appropriate MIME type
      var
        sourceBuffer = mediaSource.addSourceBuffer('video/flv; codecs="vp6,aac"'),
        oldMediaPlaylist;

      player.hls.sourceBuffer = sourceBuffer;
      sourceBuffer.appendBuffer(segmentParser.getFlvHeader());

      player.hls.mediaIndex = 0;
      player.hls.playlists =
        new videojs.Hls.PlaylistLoader(srcUrl, settings.withCredentials);
      player.hls.playlists.on('loadedmetadata', function() {
        oldMediaPlaylist = player.hls.playlists.media();

        // periodicaly check if the buffer needs to be refilled
        fillBuffer();
        player.on('timeupdate', fillBuffer);

        player.trigger('loadedmetadata');
      });
      player.hls.playlists.on('error', function() {
        player.hls.error = player.hls.playlists.error;
        player.trigger('error');
      });
      player.hls.playlists.on('loadedplaylist', function() {
        var updatedPlaylist = player.hls.playlists.media();

        if (!updatedPlaylist) {
          // do nothing before an initial media playlist has been activated
          return;
        }

        updateDuration(player.hls.playlists.media());
        player.hls.mediaIndex = translateMediaIndex(player.hls.mediaIndex,
                                                    oldMediaPlaylist,
                                                    updatedPlaylist);
        oldMediaPlaylist = updatedPlaylist;
      });
    });

    //player.src([{
      //src: videojs.URL.createObjectURL(mediaSource),
      //type: "video/flv"
    //}]);

    //if (player.options().autoplay) {
      //player.play();
    //}

  };

var mpegurlRE = /^application\/(?:x-|vnd\.apple\.)mpegurl/i;

videojs.Hls = videojs.Flash.extend({
  init: function(player, options, ready) {
    var mediaSource = new videojs.MediaSource();
    var source = options.source;
    var settings = player.options();
    options.swf = settings.flash.swf;
    options.source = {
      src: videojs.URL.createObjectURL(mediaSource),
      type: "video/flv"
    };
    videojs.Flash.call(this, player, options, ready);
    player.hls = {};
    options.source = source;
    init.call(player, options, mediaSource);
  }
});

//for (var prop in videojs.Flash) {
  //videojs.Hls[prop] = videojs.Flash[prop];
//}
//for (prop in videojs.Flash.prototype) {
  //videojs.Hls.prototype[prop] = videojs.Flash[prop];
//}

videojs.Hls.isSupported = function() {
  return videojs.Flash.isSupported() && videojs.MediaSource;
}

videojs.Hls.canPlaySource = function(srcObj) {
  return mpegurlRE.test(srcObj.type) || videojs.Flash.canPlaySource.call(this, srcObj);
};

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

/**
 * Creates and sends an XMLHttpRequest.
 * @param options {string | object} if this argument is a string, it
 * is intrepreted as a URL and a simple GET request is
 * inititated. If it is an object, it should contain a `url`
 * property that indicates the URL to request and optionally a
 * `method` which is the type of HTTP request to send.
 * @param callback (optional) {function} a function to call when the
 * request completes. If the request was not successful, the first
 * argument will be falsey.
 * @return {object} the XMLHttpRequest that was initiated.
 */
xhr = videojs.Hls.xhr = function(url, callback) {
  var
    options = {
      method: 'GET'
    },
    request;

  if (typeof callback !== 'function') {
    callback = function() {};
  }

  if (typeof url === 'object') {
    options = videojs.util.mergeOptions(options, url);
    url = options.url;
  }

  request = new window.XMLHttpRequest();
  request.open(options.method, url);

  if (options.responseType) {
    request.responseType = options.responseType;
  }
  if (options.withCredentials) {
    request.withCredentials = true;
  }

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

//videojs.Hls.onReady = videojs.Flash.onReady;
//videojs.Hls.onEvent = videojs.Flash.onEvent;
//videojs.Hls.onError = videojs.Flash.onError;

})(window, window.videojs, document);

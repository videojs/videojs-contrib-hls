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

    if(left.attributes && left.attributes.RESOLUTION && left.attributes.RESOLUTION.width) {
      leftWidth = left.attributes.RESOLUTION.width;
    }

    leftWidth = leftWidth || window.Number.MAX_VALUE;

    if(right.attributes && right.attributes.RESOLUTION && right.attributes.RESOLUTION.width) {
      rightWidth = right.attributes.RESOLUTION.width;
    }

    rightWidth = rightWidth || window.Number.MAX_VALUE;

    return leftWidth - rightWidth;

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
   * Calculate the total duration for a playlist based on segment metadata.
   * @param playlist {object} a media playlist object
   * @return {number} the currently known duration, in seconds
   */
  totalDuration = function(playlist) {
    var
      duration = 0,
      i = playlist.segments.length,
      segment;
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
      currentSrc,
      extname,
      srcUrl,

      segmentXhr,
      downloadPlaylist,
      fillBuffer;

    // if the video element supports HLS natively, do nothing
    if (videojs.hls.supportsNativeHls) {
      return;
    }

    currentSrc = player.currentSrc();
    // when the video element is initializing, currentSrc may be undefined
    // grab the src from the video element because video.js doesn't currently
    // expose it
    if (!currentSrc) {
      currentSrc = player.el().querySelector('.vjs-tech').src;
    }

    extname = (/[^#?]*(?:\/[^#?]*\.([^#?]*))/).exec(currentSrc);
    if (typeof options === 'string') {
      srcUrl = options;
    } else if (options) {
      srcUrl = options.url;
    } else if (extname && extname[1] === 'm3u8') {
      // if the currentSrc looks like an m3u8, attempt to use it
      srcUrl = currentSrc;
    } else {
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
      if (segmentXhr) {
        segmentXhr.abort();
      }
      fillBuffer(currentTime * 1000);
    });

    player.hls.useViewportSelection = true;

    /**
     * Chooses the appropriate media playlist based on the current
     * bandwidth estimate and the player size.
     * @return the highest bitrate playlist less than the currently detected
     * bandwidth, accounting for some amount of bandwidth variance
     */
    player.hls.selectPlaylist = function() {
      var
        bestVariant,
        effectiveBitrate,
        sortedPlaylists = player.hls.master.playlists.slice(),
        mappedPlaylists = [],
        i = sortedPlaylists.length,
        variant;

      sortedPlaylists.sort(playlistBandwidth);

      // determine best variant by bandwidth
      while (i--) {
        variant = sortedPlaylists[i];

        // ignore playlists without bandwidth information
        if (!variant.attributes || !variant.attributes.BANDWIDTH) {
          continue;
        }

        effectiveBitrate = variant.attributes.BANDWIDTH * bandwidthVariance;

        // since the playlists are sorted in ascending order by bandwidth, the
        // current variant is the best as long as its effective bitrate is
        // below the current bandwidth estimate
        if (effectiveBitrate < player.hls.bandwidth) {
          bestVariant = variant;
          break;
        }
      }

      // determine best variant by resolution
      // we only want to run this if bandwidth routine above determined a best variant and override is true (default)
      if (bestVariant && player.hls.useViewportSelection) {
        // reset i
        i = sortedPlaylists.length;

        // map the playlists by resolution
        // NOTE - this needs to be separate routine because eventually we want to set to index+1
        while(i--) {
          variant = sortedPlaylists[i];

          // ignored playlists without resolution information
          if (!variant.attributes || !variant.attributes.RESOLUTION || !variant.attributes.RESOLUTION.width || !variant.attributes.RESOLUTION.height) {
            continue;
          }

          mappedPlaylists.push(variant);
        }

        // set index to the available mapped renditions
        i = mappedPlaylists.length;

        // sort by resolution [currently widths]
        mappedPlaylists.sort(playlistResolution);

        // iterate through the mapped playlists and assign a best variant based on rendition resolution
        while (i--) {
          variant = mappedPlaylists[i];

          // override the bandwidth best variant with the best rendition variant
          if (variant.attributes.RESOLUTION.width <= player.width() && variant.attributes.RESOLUTION.height <= player.height()) {

            bestVariant = variant;

            // TODO - select the variant one index higher than the best variant to account for dimension variance
            /*
              if( mappedPlaylists[i+1] != undefined )
              {
              bestVariant = mappedPlaylists[i+1];
             */

            break;
          }
        }
      }

      // if no acceptable variant was found, fall back on the lowest
      // bitrate playlist
      return bestVariant || sortedPlaylists[0];
    };

    /**
     * Download an M3U8 and update the current manifest object. If the provided
     * URL is a master playlist, the default variant will be downloaded and
     * parsed as well. Triggers `loadedmanifest` once for each playlist that is
     * downloaded and `loadedmetadata` after at least one media playlist has
     * been parsed. Whether multiple playlists were downloaded or not, when
     * `loadedmetadata` fires a parsed or inferred master playlist object will
     * be available as `player.hls.master`.
     *
     * @param url {string} a URL to the M3U8 file to process
     */
    downloadPlaylist = function(url) {
      var xhr = new window.XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onreadystatechange = function() {
        var i, parser, playlist, playlistUri;

        if (xhr.readyState === 4) {
          if (xhr.status >= 400 || this.status === 0) {
            player.hls.error = {
              status: xhr.status,
              message: 'HLS playlist request error at URL: ' + url,
              code: (xhr.status >= 500) ? 4 : 2
            };
            player.trigger('error');
            return;
          }

          // readystate DONE
          parser = new videojs.m3u8.Parser();
          parser.push(xhr.responseText);

          // master playlists
          if (parser.manifest.playlists) {
            player.hls.master = parser.manifest;
            downloadPlaylist(resolveUrl(url, parser.manifest.playlists[0].uri));
            player.trigger('loadedmanifest');
            return;
          }

          // media playlists
          if (player.hls.master) {
            // merge this playlist into the master
            i = player.hls.master.playlists.length;

            while (i--) {
              playlist = player.hls.master.playlists[i];
              playlistUri = resolveUrl(srcUrl, playlist.uri);
              if (playlistUri === url) {
                player.hls.master.playlists[i] =
                  videojs.util.mergeOptions(playlist, parser.manifest);
              }
            }
          } else {
            // infer a master playlist if none was previously requested
            player.hls.master = {
              playlists: [parser.manifest]
            };
          }

          // always start playback with the default rendition
          if (!player.hls.media) {
            player.hls.media = player.hls.master.playlists[0];

            // update the duration
            if (parser.manifest.totalDuration) {
              player.duration(parser.manifest.totalDuration);
            } else {
              player.duration(totalDuration(parser.manifest));
            }

            // periodicaly check if the buffer needs to be refilled
            player.on('timeupdate', fillBuffer);

            player.trigger('loadedmanifest');
            player.trigger('loadedmetadata');
            fillBuffer();
            return;
          }

          // select a playlist and download its metadata if necessary
          playlist = player.hls.selectPlaylist();
          if (!playlist.segments) {
            downloadPlaylist(resolveUrl(srcUrl, playlist.uri));
          } else {
            player.hls.media = playlist;

            // update the duration
            if (player.hls.media.totalDuration) {
              player.duration(player.hls.media.totalDuration);
            } else {
              player.duration(totalDuration(player.hls.media));
            }
          }

          player.trigger('loadedmanifest');
        }
      };
      xhr.send(null);
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
        segment = player.hls.media.segments[player.hls.mediaIndex],
        segmentUri,
        startTime;

      // if there is a request already in flight, do nothing
      if (segmentXhr) {
        return;
      }

      // if the video has finished downloading, stop trying to buffer
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

      segmentUri = resolveUrl(resolveUrl(srcUrl, player.hls.media.uri || ''),
                              segment.uri);

      // request the next segment
      segmentXhr = new window.XMLHttpRequest();
      segmentXhr.open('GET', segmentUri);
      segmentXhr.responseType = 'arraybuffer';
      segmentXhr.onreadystatechange = function() {
        var playlist;

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
          player.trigger('error');
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

        // if we're refilling the buffer after a seek, scan through the muxed
        // FLV tags until we find the one that is closest to the desired
        // playback time
        if (offset !== undefined && typeof offset === "number") {
          while (segmentParser.getTags()[0].pts < offset) {
            // we're seeking past this tag, so ignore it
            segmentParser.getNextTag();
          }
        }

        while (segmentParser.tagsAvailable()) {
          player.hls.sourceBuffer.appendBuffer(segmentParser.getNextTag().bytes, player);
        }

        player.hls.mediaIndex++;

        if (player.hls.mediaIndex === player.hls.media.segments.length) {
          mediaSource.endOfStream();
          return;
        }

        // figure out what stream the next segment should be downloaded from
        // with the updated bandwidth information
        playlist = player.hls.selectPlaylist();
        if (!playlist.segments) {
          downloadPlaylist(resolveUrl(srcUrl, playlist.uri));
        } else {
          player.hls.media = playlist;
        }
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
      downloadPlaylist(srcUrl);
    });
    player.src({
      src: videojs.URL.createObjectURL(mediaSource),
      type: "video/flv"
    });
  };

videojs.plugin('hls', function() {
  var initialize = function() {
    return function() {
      this.hls = initialize();
      init.apply(this, arguments);
    };
  };
  initialize().apply(this, arguments);
});

})(window, window.videojs, document);

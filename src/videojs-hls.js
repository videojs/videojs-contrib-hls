/*
 * video-js-hls
 *
 *
 * Copyright (c) 2013 Brightcove
 * All rights reserved.
 */

(function(window, videojs, document, undefined) {

videojs.hls = {};

var
  // the desired length of video to maintain in the buffer, in seconds
  goalBufferLength = 5,

  // a fudge factor to apply to advertised playlist bitrates to account for
  // temporary flucations in client bandwidth
  bandwidthVariance = 1.1,

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
      extname,
      srcUrl,

      segmentXhr,
      downloadPlaylist,
      fillBuffer;

    extname = (/[^#?]*(?:\/[^#?]*\.([^#?]*))/).exec(player.currentSrc());
    if (typeof options === 'string') {
      srcUrl = options;
    } else if (options) {
      srcUrl = options.url;
    } else if (extname && extname[1] === 'm3u8') {
      // if the currentSrc looks like an m3u8, attempt to use it
      srcUrl = player.currentSrc();
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

    player.currentTime = function(value) {
      if(value) {
        player.el().getElementsByClassName('vjs-tech')[0].vjs_setProperty('currentTime', 0);
        player.hls.mediaIndex = player.hls.selectSegmentByTime(value);
        fillBuffer();
      } else {
        return player.el().getElementsByClassName('vjs-tech')[0].vjs_getProperty('currentTime');
      }
    }

    player.hls.selectSegmentByTime = function(time) {
      if(player.hls.media && player.hls.media.segments)
      {
        var index, currentSegment;

        for (index = 0; index < player.hls.media.segments.length; index++)
        {
          currentSegment = player.hls.media.segments[index];

          if(time > currentSegment.timeRange.start && time <= currentSegment.timeRange.end)
          {
            return index;
          }

        }
      }
    }

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
        i = sortedPlaylists.length,
        variant;

      sortedPlaylists.sort(playlistBandwidth);

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

      // console.log('bandwidth:',
      //             player.hls.bandwidth,
      //             'variant:',
      //             (bestVariant || sortedPlaylists[0]).attributes.BANDWIDTH);

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
            if (parser.manifest.totalDuration) {
              // update the duration
              player.duration(parser.manifest.totalDuration);
              // Notify the flash layer
              player.el().getElementsByClassName('vjs-tech')[0].vjs_setProperty('duration',parser.manifest.totalDuration);
            }
            player.trigger('loadedmanifest');
            player.trigger('loadedmetadata');
            return;
          }

          // select a playlist and download its metadata if necessary
          playlist = player.hls.selectPlaylist();
          if (!playlist.segments) {
            downloadPlaylist(resolveUrl(srcUrl, playlist.uri));
          } else {
            player.hls.media = playlist;
            if (parser.manifest.totalDuration) {
              // update the duration
              player.duration(parser.manifest.totalDuration);
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
     */
    fillBuffer = function() {
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

        if (segmentXhr.readyState === 4) {
          // calculate the download bandwidth
          player.hls.segmentXhrTime = (+new Date()) - startTime;
          player.hls.bandwidth = (segmentXhr.response.byteLength / player.hls.segmentXhrTime) * 8 * 1000;

          // transmux the segment data from MP2T to FLV
          segmentParser.parseSegmentBinaryData(new Uint8Array(segmentXhr.response));
          while (segmentParser.tagsAvailable()) {
            player.hls.sourceBuffer.appendBuffer(segmentParser.getNextTag().bytes,
                                                 player);
          }

          segmentXhr = null;
          player.hls.mediaIndex++;

          // figure out what stream the next segment should be downloaded from
          // with the updated bandwidth information
          playlist = player.hls.selectPlaylist();
          if (!playlist.segments) {
            downloadPlaylist(resolveUrl(srcUrl, playlist.uri));
          } else {
            player.hls.media = playlist;
          }
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

      player.on('loadedmetadata', fillBuffer);
      player.on('timeupdate', fillBuffer);

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

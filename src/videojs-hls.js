/*
 * video-js-hls
 *
 *
 * Copyright (c) 2013 Brightcove
 * All rights reserved.
 */

(function(window, videojs, undefined) {

videojs.hls = {};

var
  // the desired length of video to maintain in the buffer, in seconds
  goalBufferLength = 5,

  /**
   * Initializes the HLS plugin.
   * @param options {mixed} the URL to an HLS playlist
   */
  init = function(options) {
    var
      mediaSource = new videojs.MediaSource(),
      segmentParser = new videojs.hls.SegmentParser(),
      player = this,
      url,

      segmentXhr,
      fillBuffer,
      selectPlaylist;

    if (typeof options === 'string') {
      url = options;
    } else {
      url = options.url;
    }

    // expose the HLS plugin state
    player.hls.readyState = function() {
      if (!player.hls.manifest) {
        return 0; // HAVE_NOTHING
      }
      return 1;   // HAVE_METADATA
    };

    // load the MediaSource into the player
    mediaSource.addEventListener('sourceopen', function() {
      // construct the video data buffer and set the appropriate MIME type
      var sourceBuffer = mediaSource.addSourceBuffer('video/flv; codecs="vp6,aac"');
      player.hls.sourceBuffer = sourceBuffer;
      sourceBuffer.appendBuffer(segmentParser.getFlvHeader());

      // Chooses the appropriate media playlist based on the current bandwidth
      // estimate and the player size
      selectPlaylist = function() {
        player.hls.currentPlaylist = player.hls.manifest;
        player.hls.currentMediaIndex = 0;
      };

      /**
       * Determines whether there is enough video data currently in the buffer
       * and downloads a new segment if the buffered time is less than the goal.
       */
      fillBuffer = function() {
        var
          buffered = player.buffered(),
          bufferedTime = 0,
          segment = player.hls.currentPlaylist.segments[player.hls.currentMediaIndex],
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
          console.log('buffered time:', bufferedTime);
        }

        // if there is plenty of content in the buffer, relax for awhile
        if (bufferedTime >= goalBufferLength) {
          return;
        }

        segmentUri = segment.uri;
        if (!(/^([A-z]*:)?\/\//).test(segmentUri)) {
          // the segment URI is relative to the manifest
          segmentUri = url.split('/').slice(0, -1).concat(segmentUri).join('/');
        }

        // request the next segment
        segmentXhr = new window.XMLHttpRequest();
        segmentXhr.open('GET', segmentUri);
        segmentXhr.responseType = 'arraybuffer';
        segmentXhr.onreadystatechange = function() {
          if (segmentXhr.readyState === 4) {
            // calculate the download bandwidth
            player.hls.segmentXhrTime = (+new Date()) - startTime;
            player.hls.bandwidth = segmentXhr.response.byteLength / player.hls.segmentXhrTime;

            // transmux the segment data from M2TS to FLV
            segmentParser.parseSegmentBinaryData(new Uint8Array(segmentXhr.response));
            while (segmentParser.tagsAvailable()) {
              player.hls.sourceBuffer.appendBuffer(segmentParser.getNextTag().bytes,
                                                   player);
            }

            console.log('finished downloading segment ' + player.hls.currentMediaIndex);
            segmentXhr = null;
            player.hls.currentMediaIndex++;
          }
        };
        startTime = +new Date();
        segmentXhr.send(null);
      };
      player.on('loadedmetadata', fillBuffer);
      player.on('timeupdate', fillBuffer);

      // download and process the manifest
      (function() {
        var xhr = new window.XMLHttpRequest();
        xhr.open('GET', url);
        xhr.onreadystatechange = function() {
          var parser;

          if (xhr.readyState === 4) {
            // readystate DONE
            parser = new videojs.m3u8.Parser();
            parser.push(xhr.responseText);
            player.hls.manifest = parser.manifest;

            player.trigger('loadedmanifest');

            if (parser.manifest.segments) {
              selectPlaylist();
              player.trigger('loadedmetadata');
            }
          }
        };
        xhr.send(null);
      })();
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

})(window, window.videojs);

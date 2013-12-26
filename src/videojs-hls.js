/*
 * video-js-hls
 *
 *
 * Copyright (c) 2013 Brightcove
 * All rights reserved.
 */

(function(window, videojs, undefined) {

videojs.hls = {};

videojs.plugin('hls', function(options) {
  var
    mediaSource = new videojs.MediaSource(),
    segmentParser = new videojs.hls.SegmentParser(),
    player = this,
    url,

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

    // download a new segment if one is needed
    fillBuffer = function() {
      var
        xhr = new window.XMLHttpRequest(),
        segment = player.hls.currentPlaylist.segments[player.hls.currentMediaIndex],
        segmentUri = segment.uri;
      if (!(/^([A-z]*:)?\/\//).test(segmentUri)) {
        // the segment URI is relative to the manifest
        segmentUri = url.split('/').slice(0, -1).concat(segmentUri).join('/');
      }
      xhr.open('GET', segmentUri);
      xhr.responseType = 'arraybuffer';
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          player.hls.currentMediaIndex++;
          segmentParser.parseSegmentBinaryData(new Uint8Array(xhr.response));
          while (segmentParser.tagsAvailable()) {
            player.hls.sourceBuffer.appendBuffer(segmentParser.getNextTag().bytes,
                                                 player);
          }
        }
      };
      xhr.send(null);
    };
    player.on('loadedmetadata', fillBuffer);

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
});

})(window, window.videojs);

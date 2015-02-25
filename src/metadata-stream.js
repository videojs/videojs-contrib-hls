/**
 * Accepts program elementary stream (PES) data events and parses out
 * ID3 metadata from them, if present.
 * @see http://id3.org/id3v2.3.0
 */
(function(window, videojs, undefined) {
  'use strict';
  var defaults = {
    debug: false
  }, MetadataStream;

  MetadataStream = function(options) {
    var settings = videojs.util.mergeOptions(defaults, options);
    MetadataStream.prototype.init.call(this);

    this.push = function(chunk) {
      var tagSize, frameStart, frameSize;

      // ignore events that don't look like ID3 data
      if (chunk.data.length < 10 ||
          chunk.data[0] !== 'I'.charCodeAt(0) ||
          chunk.data[1] !== 'D'.charCodeAt(0) ||
          chunk.data[2] !== '3'.charCodeAt(0)) {
        if (settings.debug) {
          videojs.log('Skipping unrecognized metadata stream');
        }
        return;
      }

      // find the start of the first frame and the end of the tag
      tagSize = chunk.data.byteLength;
      frameStart = 10;
      if (chunk.data[5] & 0x40) {
        // advance the frame start past the extended header
        frameStart += 4; // header size field
        frameStart += (chunk.data[10] << 24) |
                      (chunk.data[11] << 16) |
                      (chunk.data[12] << 8)  |
                      (chunk.data[13]);

        // clip any padding off the end
        tagSize -= (chunk.data[16] << 24) |
                   (chunk.data[17] << 16) |
                   (chunk.data[18] << 8)  |
                   (chunk.data[19]);
      }

      // parse one or more ID3 frames
      // http://id3.org/id3v2.3.0#ID3v2_frame_overview
      chunk.frames = [];
      do {
        chunk.frames.push({
          id: String.fromCharCode(chunk.data[frameStart]) +
            String.fromCharCode(chunk.data[frameStart + 1]) +
            String.fromCharCode(chunk.data[frameStart + 2]) +
            String.fromCharCode(chunk.data[frameStart + 3])
        });

        frameSize = (chunk.data[frameStart + 4] << 24) |
                    (chunk.data[frameStart + 5] << 16) |
                    (chunk.data[frameStart + 6] <<  8) |
                    (chunk.data[frameStart + 7]);
        if (frameSize < 1) {
          return videojs.log('Malformed ID3 frame encountered. Skipping metadata parsing.');
        }
        frameStart += 10; // advance past the frame header
        frameStart += frameSize; // advance past the frame body
      } while (frameStart < tagSize)
      this.trigger('data', chunk);
    };
  };
  MetadataStream.prototype = new videojs.Hls.Stream();

  videojs.Hls.MetadataStream = MetadataStream;
})(window, videojs);

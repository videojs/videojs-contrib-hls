/**
 * Accepts program elementary stream (PES) data events and parses out
 * ID3 metadata from them, if present.
 * @see http://id3.org/id3v2.3.0
 */
(function(window, videojs, undefined) {
  'use strict';
  var
    parseString = function(bytes, start, end) {
      var i, result = '';
      for (i = start; i < end; i++) {
        result += '%' + ('00' + bytes[i].toString(16)).slice(-2);
      }
      return window.decodeURIComponent(result);
    },
    tagParsers = {
      'TXXX': function(tag) {
        var i;
        if (tag.data[0] !== 3) {
          // ignore frames with unrecognized character encodings
          return;
        }

        for (i = 1; i < tag.data.length; i++) {
          if (tag.data[i] === 0) {
            // parse the text fields
            tag.description = parseString(tag.data, 1, i);
            tag.value = parseString(tag.data, i + 1, tag.data.length);
            break;
          }
        }
      },
      'WXXX': function(tag) {
        var i;
        if (tag.data[0] !== 3) {
          // ignore frames with unrecognized character encodings
          return;
        }

        for (i = 1; i < tag.data.length; i++) {
          if (tag.data[i] === 0) {
            // parse the description and URL fields
            tag.description = parseString(tag.data, 1, i);
            tag.url = parseString(tag.data, i + 1, tag.data.length);
            break;
          }
        }
      }
    },
    MetadataStream;

  MetadataStream = function(options) {
    var settings = {
      debug: !!(options && options.debug),

      // the bytes of the program-level descriptor field in MP2T
      // see ISO/IEC 13818-1:2013 (E), section 2.6 "Program and
      // program element descriptors"
      descriptor: options && options.descriptor
    }, i;
    MetadataStream.prototype.init.call(this);

    // calculate the text track in-band metadata track dispatch type
    // https://html.spec.whatwg.org/multipage/embedded-content.html#steps-to-expose-a-media-resource-specific-text-track
    this.dispatchType = videojs.Hls.SegmentParser.STREAM_TYPES.metadata.toString(16);
    if (settings.descriptor) {
      for (i = 0; i < settings.descriptor.length; i++) {
        this.dispatchType += ('00' + settings.descriptor[i].toString(16)).slice(-2);
      }
    }

    this.push = function(chunk) {
      var tagSize, frameStart, frameSize, frame;

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

      // adjust the PTS values to align with the video and audio
      // streams
      if (this.timestampOffset) {
        chunk.pts -= this.timestampOffset;
        chunk.dts -= this.timestampOffset;
      }

      // parse one or more ID3 frames
      // http://id3.org/id3v2.3.0#ID3v2_frame_overview
      chunk.frames = [];
      do {
        // determine the number of bytes in this frame
        frameSize = (chunk.data[frameStart + 4] << 24) |
                    (chunk.data[frameStart + 5] << 16) |
                    (chunk.data[frameStart + 6] <<  8) |
                    (chunk.data[frameStart + 7]);
        if (frameSize < 1) {
          return videojs.log('Malformed ID3 frame encountered. Skipping metadata parsing.');
        }

        frame = {
          id: String.fromCharCode(chunk.data[frameStart]) +
            String.fromCharCode(chunk.data[frameStart + 1]) +
            String.fromCharCode(chunk.data[frameStart + 2]) +
            String.fromCharCode(chunk.data[frameStart + 3]),
          data: chunk.data.subarray(frameStart + 10, frameStart + frameSize + 10)
        };
        if (tagParsers[frame.id]) {
          tagParsers[frame.id](frame);
        }
        chunk.frames.push(frame);

        frameStart += 10; // advance past the frame header
        frameStart += frameSize; // advance past the frame body
      } while (frameStart < tagSize);
      this.trigger('data', chunk);
    };
  };
  MetadataStream.prototype = new videojs.Hls.Stream();

  videojs.Hls.MetadataStream = MetadataStream;
})(window, window.videojs);

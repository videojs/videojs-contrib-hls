(function(window, videojs) {
'use strict';

var
  DataView = window.DataView,
  /**
   * Returns the string representation of an ASCII encoded four byte buffer.
   * @param buffer {Uint8Array} a four-byte buffer to translate
   * @return {string} the corresponding string
   */
  parseType = function(buffer) {
    var result = '';
    result += String.fromCharCode(buffer[0]);
    result += String.fromCharCode(buffer[1]);
    result += String.fromCharCode(buffer[2]);
    result += String.fromCharCode(buffer[3]);
    return result;
  },

  // registry of handlers for individual mp4 box types
  parse = {
    ftyp: function(data) {
      var
        view = new DataView(data.buffer, data.byteOffset, data.byteLength),
        result = {
          majorBrand: view.getUint32(0),
          minorVersion: view.getUint32(4),
          compatibleBrands: []
        },
        i = 8;
      while (i < data.byteLength) {
        result.compatibleBrands.push(view.getUint32(i));
        i += 4;
      }
      return result;
    },
    dinf: function(data) {
      return {
        boxes: videojs.inspectMp4(data)
      };
    },
    dref: function(data) {
      return {
        dataReferences: []
      };
    },
    hdlr: function(data) {
      var
        view = new DataView(data.buffer, data.byteOffset, data.byteLength),
        language,
        result = {
          version: view.getUint8(0),
          flags: new Uint8Array(data.subarray(1, 4)),
          handlerType: parseType(data.subarray(8, 12)),
          name: ''
        },
        i = 8;

      // parse out the name field
      for (i = 24; i < data.byteLength; i++) {
        if (data[i] === 0x00) {
          // the name field is null-terminated
          i++;
          break;
        }
        result.name += String.fromCharCode(data[i]);
      }
      // decode UTF-8 to javascript's internal representation
      // see http://ecmanaut.blogspot.com/2006/07/encoding-decoding-utf8-in-javascript.html
      result.name = window.decodeURIComponent(window.escape(result.name));

      return result;
    },
    mdhd: function(data) {
      var
        view = new DataView(data.buffer, data.byteOffset, data.byteLength),
        language,
        result = {
          version: view.getUint8(0),
          flags: new Uint8Array(data.subarray(1, 4)),
          language: ''
        };
      if (result.version === 1) {
        result.creationTime = view.getUint32(8); // truncating top 4 bytes
        result.modificationTime = view.getUint32(16); // truncating top 4 bytes
        result.timescale = view.getUint32(20);
        result.duration = view.getUint32(28); // truncating top 4 bytes
      }
      // language is stored as an ISO-639-2/T code in an array of three 5-bit fields
      // each field is the packed difference between its ASCII value and 0x60
      language = view.getUint16(32);
      result.language += String.fromCharCode((language >> 10) + 0x60);
      result.language += String.fromCharCode(((language & 0x03c0) >> 5) + 0x60);
      result.language += String.fromCharCode((language & 0x1f) + 0x60);

      return result;
    },
    mdia: function(data) {
      return {
        boxes: videojs.inspectMp4(data)
      };
    },
    minf: function(data) {
      return {
        boxes: videojs.inspectMp4(data)
      };
    },
    moov: function(data) {
      return {
        boxes: videojs.inspectMp4(data)
      };
    },
    mvhd: function(data) {
      var
        view = new DataView(data.buffer, data.byteOffset, data.byteLength),
        result = {
          version: view.getUint8(0),
          flags: new Uint8Array(data.subarray(1, 4)),
          // convert fixed-point, base 16 back to a number
          rate: view.getUint16(32) + (view.getUint16(34) / 16),
          volume: view.getUint8(36) + (view.getUint8(37) / 8),
          matrix: new Uint32Array(data.subarray(48, 84)),
          nextTrackId: view.getUint32(108)
        };
      if (result.version === 1) {
        result.creationTime = view.getUint32(8); // truncating top 4 bytes
        result.modificationTime = view.getUint32(16); // truncating top 4 bytes
        result.timescale = view.getUint32(20);
        result.duration = view.getUint32(28); // truncating top 4 bytes
      }
      return result;
    },
    pdin: function(data) {
      var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      return {
        version: view.getUint8(0),
        flags: new Uint8Array(data.subarray(1, 4)),
        rate: view.getUint32(4),
        initialDelay: view.getUint32(8)
      };
    },
    trak: function(data) {
      return {
        boxes: videojs.inspectMp4(data)
      };
    },
    stbl: function(data) {
      return {
        boxes: videojs.inspectMp4(data)
      };
    },
    stco: function(data) {
      return {
        chunkOffsets: []
      };
    },
    stsc: function(data) {
      return {
        sampleToChunks: []
      };
    },
    stsd: function(data) {
      return {
        sampleDescriptions: []
      };
    },
    stts: function(data) {
      return {
        timeToSamples: []
      };
    },
    tkhd: function(data) {
      var
        view = new DataView(data.buffer, data.byteOffset, data.byteLength),
        result = {
          version: view.getUint8(0),
          flags: new Uint8Array(data.subarray(1, 4)),
          layer: view.getUint16(44),
          alternateGroup: view.getUint16(46),
          // convert fixed-point, base 16 back to a number
          volume: view.getUint8(48) + (view.getUint8(49) / 8),
          matrix: new Uint32Array(data.subarray(52, 88)),
          width: view.getUint32(88),
          height: view.getUint32(92)
        };
      if (result.version === 1) {
        result.creationTime = view.getUint32(8); // truncating top 4 bytes
        result.modificationTime = view.getUint32(16); // truncating top 4 bytes
        result.trackId = view.getUint32(20);
        result.duration = view.getUint32(32); // truncating top 4 bytes
      }
      return result;
    }
  };

/**
 * Return a javascript array of box objects parsed from an ISO base
 * media file.
 * @param data {Uint8Array} the binary data of the media to be inspected
 * @return {array} a javascript array of potentially nested box objects
 */
videojs.inspectMp4 = function(data) {
  var
    i = 0,
    result = [],
    view = new DataView(data.buffer, data.byteOffset, data.byteLength),
    size,
    type,
    end,
    box;

  while (i < data.byteLength) {
    // parse box data
    size = view.getUint32(i),
    type =  parseType(data.subarray(i + 4, i + 8));
    end = size > 1 ? i + size : data.byteLength;

    // parse type-specific data
    box = (parse[type] || function(data) {
      return {
        data: data
      };
    })(data.subarray(i + 8, end));
    box.size = size;
    box.type = type;

    // store this box and move to the next
    result.push(box);
    i = end;
  }
  return result;
};
})(window, window.videojs);

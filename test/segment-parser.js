(function(window) {
  /*
    ======== A Handy Little QUnit Reference ========
    http://api.qunitjs.com/

    Test methods:
    module(name, {[setup][ ,teardown]})
    test(name, callback)
    expect(numberOfAssertions)
    stop(increment)
    start(decrement)
    Test assertions:
    ok(value, [message])
    equal(actual, expected, [message])
    notEqual(actual, expected, [message])
    deepEqual(actual, expected, [message])
    notDeepEqual(actual, expected, [message])
    strictEqual(actual, expected, [message])
    notStrictEqual(actual, expected, [message])
    throws(block, [expected], [message])
  */
  var
    parser,

    expectedHeader = [
      0x46, 0x4c, 0x56, 0x01, 0x05, 0x00, 0x00, 0x00,
      0x09, 0x00, 0x00, 0x00, 0x00
    ],

    extend = window.videojs.util.mergeOptions,

    testAudioTag,
    testVideoTag,
    testScriptTag,
    asciiFromBytes,
    testScriptString,
    testScriptEcmaArray,
    testNalUnit;

  module('segment parser', {
    setup: function() {
      parser = new window.videojs.Hls.SegmentParser();
    }
  });

  test('creates an flv header', function() {
    var header = Array.prototype.slice.call(parser.getFlvHeader());
    ok(header, 'the header is truthy');
    equal(9 + 4, header.length, 'the header length is correct');
    equal(header[0], 'F'.charCodeAt(0), 'the first character is "F"');
    equal(header[1], 'L'.charCodeAt(0), 'the second character is "L"');
    equal(header[2], 'V'.charCodeAt(0), 'the third character is "V"');

    deepEqual(expectedHeader, header, 'the rest of the header is correct');
  });

  test('parses PMTs with program descriptors', function() {
    var
      makePmt = function(options) {
        var
          result = [],
          entryCount = 0,
          k,
          sectionLength;
        for (k in options.pids) {
          entryCount++;
        }
        // table_id
        result.push(0x02);
        // section_syntax_indicator '0' reserved section_length
        // 13 + (program_info_length) + (n * 5 + ES_info_length[n])
        sectionLength = 13 + (5 * entryCount) + 17;
        result.push(0x80 | (0xF00 & sectionLength >>> 8));
        result.push(sectionLength & 0xFF);
        // program_number
        result.push(0x00);
        result.push(0x01);
        // reserved version_number current_next_indicator
        result.push(0x01);
        // section_number
        result.push(0x00);
        // last_section_number
        result.push(0x00);
        // reserved PCR_PID
        result.push(0xe1);
        result.push(0x00);
        // reserved program_info_length
        result.push(0xf0);
        result.push(0x11); // hard-coded 17 byte descriptor
        // program descriptors
        result = result.concat([
          0x25, 0x0f, 0xff, 0xff,
          0x49, 0x44, 0x33, 0x20,
          0xff, 0x49, 0x44, 0x33,
          0x20, 0x00, 0x1f, 0x00,
          0x01
        ]);
        for (k in options.pids) {
          // stream_type
          result.push(options.pids[k]);
          // reserved elementary_PID
          result.push(0xe0 | (k & 0x1f00) >>> 8);
          result.push(k & 0xff);
          // reserved ES_info_length
          result.push(0xf0);
          result.push(0x00); // ES_info_length = 0
        }
        // CRC_32
        result.push([0x00, 0x00, 0x00, 0x00]); // invalid CRC but we don't check it
        return result;
      },
      makePat = function(options) {
        var
          result = [],
          k;
        // table_id
        result.push(0x00);
        // section_syntax_indicator '0' reserved section_length
        result.push(0x80);
        result.push(0x0d); // section_length for one program
        // transport_stream_id
        result.push(0x00);
        result.push(0x00);
        // reserved version_number current_next_indicator
        result.push(0x01); // current_next_indicator is 1
        // section_number
        result.push(0x00);
        // last_section_number
        result.push(0x00);
        for (k in options.programs) {
          // program_number
          result.push((k & 0xFF00) >>> 8);
          result.push(k & 0x00FF);
          // reserved program_map_pid
          result.push((options.programs[k] & 0x1f00) >>> 8);
          result.push(options.programs[k] & 0xff);
        }
        return result;
      },
      makePsi = function(options) {
        var result = [];

        // pointer_field
        if (options.payloadUnitStartIndicator) {
          result.push(0x00);
        }
        if (options.programs) {
          return result.concat(makePat(options));
        }
        return result.concat(makePmt(options));
      },
      makePacket = function(options) {
        var
          result = [],
          settings = extend({
            payloadUnitStartIndicator: true,
            pid: 0x00
          }, options);

        // header
        // sync_byte
        result.push(0x47);
        // transport_error_indicator payload_unit_start_indicator transport_priority PID
        result.push((settings.pid & 0x1f) << 8 | 0x40);
        result.push(settings.pid & 0xff);
        // transport_scrambling_control adaptation_field_control continuity_counter
        result.push(0x10);
        result = result.concat(makePsi(settings));

        // ensure the resulting packet is the correct size
        result.length = window.videojs.Hls.SegmentParser.MP2T_PACKET_LENGTH;
        return result;
      },
      h264Type = window.videojs.Hls.SegmentParser.STREAM_TYPES.h264,
      adtsType = window.videojs.Hls.SegmentParser.STREAM_TYPES.adts;

    parser.parseSegmentBinaryData(new Uint8Array(makePacket({
      programs: {
        0x01: [0x01]
      }
    }).concat(makePacket({
      pid: 0x01,
      pids: {
        0x02: h264Type, // h264 video
        0x03: adtsType // adts audio
      }
    }))));

    strictEqual(parser.stream.pmtPid, 0x01, 'PMT PID is 1');
    strictEqual(parser.stream.programMapTable[h264Type], 0x02, 'video is PID 2');
    strictEqual(parser.stream.programMapTable[adtsType], 0x03, 'audio is PID 3');
  });

  test('parses the first bipbop segment', function() {
    parser.parseSegmentBinaryData(window.bcSegment);

    ok(parser.tagsAvailable(), 'tags are available');
  });

  testAudioTag = function(tag) {
    var
      byte = tag.bytes[11],
      format = (byte & 0xF0) >>> 4,
      soundRate = byte & 0x03,
      soundSize = (byte & 0x2) >>> 1,
      soundType = byte & 0x1,
      aacPacketType = tag.bytes[12];

    equal(10, format, 'the audio format is aac');
    equal(3, soundRate, 'the sound rate is 44kHhz');
    equal(1, soundSize, 'the sound size is 16-bit samples');
    equal(1, soundType, 'the sound type is stereo');

    ok(aacPacketType === 0 || aacPacketType === 1, 'aac packets should have a valid type');
  };

  testVideoTag = function (tag) {
    var
      byte = tag.bytes[11],
      frameType = (byte & 0xF0) >>> 4,
      codecId = byte & 0x0F,
      packetType = tag.bytes[12],
      compositionTime = (tag.view.getInt32(13) & 0xFFFFFF00) >> 8;

    // payload starts at tag.bytes[16]

    // XXX: I'm not sure that frame types 3-5 are invalid
    ok(frameType === 1 || frameType === 2,
       'the frame type should be valid');

    equal(7, codecId, 'the codec ID is AVC for h264');
    ok(packetType <= 2 && packetType >= 0, 'the packet type is within [0, 2]');
    if (packetType !== 1) {
      equal(0,
            compositionTime,
            'the composition time is zero for non-NALU packets');
    }

    // TODO: the rest of the bytes are an NLU unit
    if (packetType === 0) {
      // AVC decoder configuration record
    } else {
      // NAL units
      testNalUnit(tag.bytes.subarray(16));
    }
  };

  testNalUnit = function(bytes) {
    var
      nalHeader = bytes[0];
      // unitType = nalHeader & 0x1F;

    equal(0, (nalHeader & 0x80) >>> 7, 'the first bit is always 0');
    // equal(90, (nalHeader & 0x60) >>> 5, 'the NAL reference indicator is something');
    // ok(unitType > 0, 'NAL unit type ' + unitType + ' is greater than 0');
    // ok(unitType < 22 , 'NAL unit type ' + unitType + ' is less than 22');
  };


  asciiFromBytes = function(bytes) {
    var
      string = [],
      i = bytes.byteLength;

    while (i--) {
      string[i] = String.fromCharCode(bytes[i]);
    }
    return string.join('');
  };

  testScriptString = function(tag, offset, expected) {
    var
      type = tag.bytes[offset],
      stringLength = tag.view.getUint16(offset + 1),
      string;

    equal(2, type, 'the script element is of string type');
    equal(stringLength, expected.length, 'the script string length is correct');
    string = asciiFromBytes(tag.bytes.subarray(offset + 3,
                                               offset + 3 + stringLength));
    equal(expected, string, 'the string value is "' + expected + '"');
  };

  testScriptEcmaArray = function(tag, start) {
    var
      numItems = tag.view.getUint32(start),
      i = numItems,
      offset = start + 4,
      length,
      type;

    while (i--) {
      length = tag.view.getUint16(offset);

      // advance offset to the property value
      offset += 2 + length;

      type = tag.bytes[offset];
      ok(type === 1 || type === 0,
         'the ecma array property value type is number or boolean');
      offset++;
      if (type) {
        // boolean
        ok(tag.bytes[offset] === 0 || tag.bytes[offset] === 1,
           'the script boolean value is 0 or 1');
        offset++;
      } else {
        // number
        ok(!isNaN(tag.view.getFloat64(offset)), 'the value is not NaN');
        offset += 8;
      }
    }
    equal(tag.bytes[offset], 0, 'the property array terminator is valid');
    equal(tag.bytes[offset + 1], 0, 'the property array terminator is valid');
    equal(tag.bytes[offset + 2], 9, 'the property array terminator is valid');
  };

  testScriptTag = function(tag) {
    testScriptString(tag, 11, 'onMetaData');

    // the onMetaData object is stored as an 'ecma array', an array with non-
    // integer indices (i.e. a dictionary or hash-map).
    equal(8, tag.bytes[24], 'onMetaData is of ecma array type');
    testScriptEcmaArray(tag, 25);
  };

  test('the flv tags are well-formed', function() {
    var
      byte,
      tag,
      type,
      currentPts = 0,
      lastTime = 0;
    parser.parseSegmentBinaryData(window.bcSegment);

    while (parser.tagsAvailable()) {
      tag = parser.getNextTag();
      type = tag.bytes[0];

      ok(tag.pts >= currentPts, 'presentation time stamps are increasing');
      currentPts = tag.pts;

      // generic flv headers
      switch (type) {
        case 8: ok(true, 'the type is audio');
        break;
        case 9: ok(true, 'the type is video');
        break;
        case 18: ok(true, 'the type is script');
        break;
        default: ok(false, 'the type (' + type + ') is unrecognized');
      }

      byte = (tag.view.getUint32(1) & 0xFFFFFF00) >>> 8;
      equal(tag.bytes.byteLength - 11 - 4, byte, 'the size field is correct');

      byte = tag.view.getUint32(5) & 0xFFFFFF00;
      ok(byte >= lastTime,
         'timestamp is increasing. last pts: ' + lastTime + ' this pts: ' + byte);
      lastTime = byte;

      // tag type-specific headers
      ({
        8: testAudioTag,
        9: testVideoTag,
        18: testScriptTag
      })[type](tag);

      // previous tag size
      equal(tag.bytes.byteLength - 4,
            tag.view.getUint32(tag.bytes.byteLength - 4),
            'the size of the previous tag is correct');
    }
  });
})(window);

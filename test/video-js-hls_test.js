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
    segmentController,
    parser,

  expectedHeader = [
    0x46, 0x4c, 0x56, 0x01, 0x05, 0x00, 0x00, 0x00,
    0x09, 0x00, 0x00, 0x00, 0x00
  ],
  testAudioTag,
  testVideoTag,
  testScriptTag,
  asciiFromBytes,
  testScriptString,
  testScriptEcmaArray,
  testNalUnit;

  module('environment');

  test('is sane', function() {
    expect(1);
    ok(true);
  });

  module('segment parser', {
    setup: function() {
      parser = new window.videojs.hls.SegmentParser();
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
      tag,
      byte,
      type,
      lastTime = 0;
    parser.parseSegmentBinaryData(window.bcSegment);

    while (parser.tagsAvailable()) {
      tag = parser.getNextTag();
      type = tag.bytes[0];

      // generic flv headers
      ok(type === 8 || type === 9 || type === 18,
         'the type field specifies audio, video or script');

      byte = (tag.view.getUint32(1) & 0xFFFFFF00) >>> 8;
      equal(tag.bytes.byteLength - 11 - 4, byte, 'the size field is correct');

      byte = tag.view.getUint32(5) & 0xFFFFFF00;
      ok(byte >= lastTime, 'the timestamp for the tag is greater than zero');
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

  module('segment controller', {
    setup: function() {
      segmentController = new window.videojs.hls.SegmentController();
      this.vjsget = window.videojs.get;
      window.videojs.get = function(url, success) {
        success(window.bcSegment);
      };
    },
    teardown: function() {
      window.videojs.get = this.vjsget;
    }
  });

  test('bandwidth calulation test', function() {
    var
      multiSecondData = segmentController.calculateThroughput(10000, 1000, 2000),
      subSecondData = segmentController.calculateThroughput(10000, 1000, 1500);
    equal(multiSecondData, 80000, 'MULTI-Second bits per second calculation');
    equal(subSecondData, 160000, 'SUB-Second bits per second calculation');
  });
})(this);

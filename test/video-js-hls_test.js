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
	  manifestController,
	  m3u8parser,
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
    testScriptEcmaArray;

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
    var tag, bytes, i;
    parser.parseSegmentBinaryData(window.bcSegment);
    
    ok(parser.tagsAvailable(), 'tags are available');

    console.log('h264 tags:', parser.stats.h264Tags(),
                'aac tags:', parser.stats.aacTags());

    console.log(videojs.hls.utils.hexDump(parser.getFlvHeader()));
    for (i = 0; i < 4; ++i) {
      parser.getNextTag();
    }
    console.log(videojs.hls.utils.tagDump(parser.getNextTag()));
    console.log('bad tag:');
    for (i = 0; i < 3; ++i) {
      console.log(videojs.hls.utils.tagDump(parser.getNextTag()));
    }
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

  testVideoTag = function(tag) {
    var
      byte = tag.bytes[11],
      frameType = (byte & 0xF0) >>> 4,
      codecId = byte & 0x0F,
      packetType = tag.bytes[12],
      compositionTime = (tag.view.getInt32(13) & 0xFFFFFF00) >> 8;


    // XXX: I'm not sure that frame types 3-5 are invalid
    ok(frameType === 1 || frameType === 2,
       'the frame type should be valid');

    equal(7, codecId, 'the codec ID is AVC for h264');
    ok(packetType <=2 && packetType >= 0, 'the packet type is within [0, 2]');
    if (packetType !== 1) {
      equal(0,
            compositionTime,
            'the composition time is zero for non-NALU packets');
    }
    
    // TODO: the rest of the bytes are an NLU unit
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
    var type = tag.bytes[offset],
        stringLength = tag.view.getUint16(offset + 1),
        string,
        i = expected.length;

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

	/*
		M3U8 Test Suite
	 */

  module('m3u8 parser', {
    setup: function() {
	    m3u8parser = new window.videojs.hls.M3U8Parser();
    }
  });

	test('should create my parser', function() {
		 ok(m3u8parser != undefined);
		}
	);

	test('should successfully parse manifest data', function() {
			var parsedData = m3u8parser.parse(window.playlistData);
			ok(parsedData);
		}
	);

	test('test for expected results', function() {
			var data = m3u8parser.parse(window.playlistData);

			notEqual(data, null, 'data is not NULL');
			equal(data.invalidReasons.length, 0,'data has 0 invalid reasons');
			equal(data.hasValidM3UTag, true, 'data has valid EXTM3U');
			equal(data.targetDuration, 10, 'data has correct TARGET DURATION');
			equal(data.allowCache, "NO", 'acceptable ALLOW CACHE');
			equal(data.isPlaylist, true, 'data is parsed as a PLAYLIST as expected');
			equal(data.playlistType, "VOD", 'acceptable PLAYLIST TYPE');
			equal(data.mediaItems.length, 16, 'acceptable mediaItem count');
			equal(data.mediaSequence, 0, 'MEDIA SEQUENCE is correct');
			equal(data.totalDuration, -1, "ZEN TOTAL DURATION is unknown as expected");
			equal(data.hasEndTag, true, 'should have ENDLIST tag');
		}
	);

	module('brightcove playlist', {
		setup: function() {
			m3u8parser = new window.videojs.hls.M3U8Parser();
		}
	});

	test('should parse a brightcove manifest data', function() {
		  var data = m3u8parser.parse(window.brightcove_playlist_data);

			ok(data);
			equal(data.playlistItems.length, 4, 'Has correct rendition count');
			equal(data.playlistItems[0].bandwidth, 240000, 'First rendition index bandwidth is correct' );
			equal(data.playlistItems[0]["program-id"], 1, 'First rendition index program-id is correct' );
			equal(data.playlistItems[0].resolution.width, 396, 'First rendition index resolution width is correct' );
			equal(data.playlistItems[0].resolution.height, 224, 'First rendition index resolution height is correct' );

		}
	);

	module('manifest controller', {
		setup: function() {
			manifestController = new window.videojs.hls.ManifestController();
			this.vjsget = vjs.get;
			vjs.get = function(url, success, error){
				console.log(url);
				success(window.brightcove_playlist_data);
			};
		},
		teardown: function() {
			vjs.get = this.vjsget;
		}
	});

	test('should create', function() {
		ok(manifestController);
	});

	test('should return a parsed object', function() {
		var data = manifestController.parseManifest(window.brightcove_playlist_data);

		ok(data);

		equal(data.playlistItems.length, 4, 'Has correct rendition count');
		equal(data.playlistItems[0].bandwidth, 240000, 'First rendition index bandwidth is correct' );
		equal(data.playlistItems[0]["program-id"], 1, 'First rendition index program-id is correct' );
		equal(data.playlistItems[0].resolution.width, 396, 'First rendition index resolution width is correct' );
		equal(data.playlistItems[0].resolution.height, 224, 'First rendition index resolution height is correct' );
	})

	test('should get a manifest from hermes', function() {
		var hermesUrl = "http://localhost:7070/test/basic-playback/brightcove/16x9-master.m3u8";

		manifestController.loadManifest(
			hermesUrl,
			function(responseData){
				console.log('got response data');
				ok(true);
			},
			function(errorData){
				console.log('got error data')
			},
			function(updateData){
				console.log('got update data')
			}
		)

	})

})(this);

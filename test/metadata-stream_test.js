(function(window, videojs, undefined) {
  'use strict';
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

  var metadataStream, stringToInts, stringToCString, id3Frame;

  module('MetadataStream', {
    setup: function() {
      metadataStream = new videojs.Hls.MetadataStream();
    }
  });

  test('can construct a MetadataStream', function() {
    ok(metadataStream, 'does not return null');
  });

  stringToInts = function(string) {
    var result = [], i;
    for (i = 0; i < string.length; i++) {
      result[i] = string.charCodeAt(i);
    }
    return result;
  };

  stringToCString = function(string) {
    return stringToInts(string).concat([0x00]);
  };

  id3Frame = function(type) {
    var result = stringToInts(type).concat([
      0x00, 0x00, 0x00, 0x00, // size
      0xe0, 0x00 // flags. tag/file alter preservation, read-only
    ]),
        size = result.length - 10;

    // append the fields of the ID3 frame
    result = result.concat.apply(result, Array.prototype.slice.call(arguments, 1));

    // set the size
    size = result.length - 10;
    result[4] = (size >>> 24);
    result[5] = (size >>> 16) & 0xff;
    result[6] = (size >>>  8) & 0xff;
    result[7] = (size)        & 0xff;

    return result;
  };

  test('parses simple ID3 metadata out of PES packets', function() {
    var events = [], id3Bytes, size;
    metadataStream.on('data', function(event) {
      events.push(event);
    });

    id3Bytes = new Uint8Array(stringToInts('ID3').concat([
      0x03, 0x00,            // version 3.0 of ID3v2 (aka ID3v.2.3.0)
      0x40,                  // flags. include an extended header
      0x00, 0x00, 0x00, 0x00, // size. set later

      // extended header
      0x00, 0x00, 0x00, 0x06, // extended header size. no CRC
      0x00, 0x00,             // extended flags
      0x00, 0x00, 0x00, 0x02, // size of padding

      // frame 0
      // http://id3.org/id3v2.3.0#User_defined_text_information_frame
    ], id3Frame('WXXX',
                [0x00], // text encoding. ISO-8859-1
                stringToCString('ad tag URL'), // description
                stringToInts('http://example.com/ad?v=1234&q=7')), // value
    // frame 1
    // custom tag
    id3Frame('XINF',
             [
               0x04, 0x03, 0x02, 0x01 // arbitrary data
             ]), [
               0x00, 0x00             // padding
             ]));

    // set header size field
    size = id3Bytes.byteLength - 10;
    id3Bytes[6] = (size >>> 21) & 0x7f;
    id3Bytes[7] = (size >>> 14) & 0x7f;
    id3Bytes[8] = (size >>>  7) & 0x7f;
    id3Bytes[9] = (size)        & 0x7f;

    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 1000,

      // header
      data: id3Bytes
    });

    equal(events.length, 1, 'parsed one tag');
    equal(events[0].frames.length, 2, 'parsed two frames');
    equal(events[0].frames[0].id, 'WXXX', 'parsed a WXXX frame');
    equal(events[0].frames[1].id, 'XINF', 'parsed a user-defined frame');
  });

  test('skips non-ID3 metadata events', function() {
    var events = [], id3Bytes, size;
    metadataStream.on('data', function(event) {
      events.push(event);
    });

    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 1000,

      // header
      data: new Uint8Array([0])
    });

    equal(events.length, 0, 'did not emit an event');
  });

  // missing cases:
  // unsynchronization
  // CRC
  // no extended header
  // compressed frames
  // encrypted frames
  // frame groups

})(window, videojs);

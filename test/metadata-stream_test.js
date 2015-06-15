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

  var metadataStream, stringToInts, stringToCString, id3Tag, id3Frame;

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

  id3Tag = function() {
    var
      frames = Array.prototype.concat.apply([], Array.prototype.slice.call(arguments)),
      result = stringToInts('ID3').concat([
        0x03, 0x00,            // version 3.0 of ID3v2 (aka ID3v.2.3.0)
        0x40,                  // flags. include an extended header
        0x00, 0x00, 0x00, 0x00, // size. set later

        // extended header
        0x00, 0x00, 0x00, 0x06, // extended header size. no CRC
        0x00, 0x00,             // extended flags
        0x00, 0x00, 0x00, 0x02  // size of padding
      ], frames),
      size;

    // size is stored as a sequence of four 7-bit integers with the
    // high bit of each byte set to zero
    size = result.length - 10;
    result[6] = (size >>> 21) & 0x7f;
    result[7] = (size >>> 14) & 0x7f;
    result[8] = (size >>>  7) & 0x7f;
    result[9] = (size)        & 0x7f;

    return result;
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
    var
      events = [],
      wxxxPayload = [
        0x00 // text encoding. ISO-8859-1
      ].concat(stringToCString('ad tag URL'), // description
               stringToInts('http://example.com/ad?v=1234&q=7')), // value
      id3Bytes,
      size;

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
                wxxxPayload), // value
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
    deepEqual(new Uint8Array(events[0].frames[0].data),
              new Uint8Array(wxxxPayload),
              'attached the frame payload');
    equal(events[0].frames[1].id, 'XINF', 'parsed a user-defined frame');
    deepEqual(new Uint8Array(events[0].frames[1].data),
              new Uint8Array([0x04, 0x03, 0x02, 0x01]),
              'attached the frame payload');
    equal(events[0].pts, 1000, 'did not modify the PTS');
    equal(events[0].dts, 1000, 'did not modify the PTS');
  });

  test('skips non-ID3 metadata events', function() {
    var events = [];
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
  // too large/small tag size values
  // too large/small frame size values

  test('parses TXXX frames', function() {
    var events = [];
    metadataStream.on('data', function(event) {
      events.push(event);
    });

    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 900,

      // header
      data: new Uint8Array(id3Tag(id3Frame('TXXX',
                                           0x03, // utf-8
                                           stringToCString('get done'),
                                           stringToCString('{ "key": "value" }')),
                                  [0x00, 0x00]))
    });

    equal(events.length, 1, 'parsed one tag');
    equal(events[0].frames.length, 1, 'parsed one frame');
    equal(events[0].frames[0].id, 'TXXX', 'parsed the frame id');
    equal(events[0].frames[0].description, 'get done', 'parsed the description');
    deepEqual(JSON.parse(events[0].frames[0].value), { key: 'value' }, 'parsed the value');
  });

  test('parses WXXX frames', function() {
    var events = [], url = 'http://example.com/path/file?abc=7&d=4#ty';
    metadataStream.on('data', function(event) {
      events.push(event);
    });

    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 900,

      // header
      data: new Uint8Array(id3Tag(id3Frame('WXXX',
                                           0x03, // utf-8
                                           stringToCString(''),
                                           stringToInts(url)),
                                  [0x00, 0x00]))
    });

    equal(events.length, 1, 'parsed one tag');
    equal(events[0].frames.length, 1, 'parsed one frame');
    equal(events[0].frames[0].id, 'WXXX', 'parsed the frame id');
    equal(events[0].frames[0].description, '', 'parsed the description');
    equal(events[0].frames[0].url, url, 'parsed the value');
  });

  test('parses TXXX frames with characters that have a single-digit hexadecimal representation', function() {
    var events = [], value = String.fromCharCode(7);
    metadataStream.on('data', function(event) {
      events.push(event);
    });

    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 900,

      // header
      data: new Uint8Array(id3Tag(id3Frame('TXXX',
                                           0x03, // utf-8
                                           stringToCString(''),
                                           stringToCString(value)),
                                  [0x00, 0x00]))
    });

    equal(events[0].frames[0].value,
          value,
          'parsed the single-digit character');
  });

  test('parses PRIV frames', function() {
    var
      events = [],
      payload = stringToInts('arbitrary data may be included in the payload ' +
                             'of a PRIV frame');

    metadataStream.on('data', function(event) {
      events.push(event);
    });

    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 900,

      // header
      data: new Uint8Array(id3Tag(id3Frame('PRIV',
                                           stringToCString('priv-owner@example.com'),
                                           payload)))
    });

    equal(events.length, 1, 'parsed a tag');
    equal(events[0].frames.length, 1, 'parsed a frame');
    equal(events[0].frames[0].id, 'PRIV', 'frame id is PRIV');
    equal(events[0].frames[0].owner, 'priv-owner@example.com', 'parsed the owner');
    deepEqual(new Uint8Array(events[0].frames[0].privateData),
              new Uint8Array(payload),
              'parsed the frame private data');

  });

  test('parses tags split across pushes', function() {
    var
      events = [],
      owner = stringToCString('owner@example.com'),
      payload = stringToInts('A TS packet is 188 bytes in length so that it can' +
                             ' be easily transmitted over ATM networks, an ' +
                             'important medium at one time. We want to be sure' +
                             ' that ID3 frames larger than a TS packet are ' +
                             'properly re-assembled.'),
      tag = new Uint8Array(id3Tag(id3Frame('PRIV', owner, payload))),
      front = tag.subarray(0, 100),
      back = tag.subarray(100);

    metadataStream.on('data', function(event) {
      events.push(event);
    });

    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 900,
      data: front
    });

    equal(events.length, 0, 'parsed zero tags');

    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 900,
      data: back
    });

    equal(events.length, 1, 'parsed a tag');
    equal(events[0].frames.length, 1, 'parsed a frame');
    equal(events[0].frames[0].data.byteLength,
          owner.length + payload.length,
          'collected data across pushes');

    // parses subsequent fragmented tags
    tag = new Uint8Array(id3Tag(id3Frame('PRIV',
                                         owner, payload, payload)));
    front = tag.subarray(0, 188);
    back = tag.subarray(188);
    metadataStream.push({
      trackId: 7,
      pts: 2000,
      dts: 2000,
      data: front
    });
    metadataStream.push({
      trackId: 7,
      pts: 2000,
      dts: 2000,
      data: back
    });
    equal(events.length, 2, 'parsed a subseqent frame');
  });

  test('ignores tags when the header is fragmented', function() {

    var
      events = [],
      tag = new Uint8Array(id3Tag(id3Frame('PRIV',
                                           stringToCString('owner@example.com'),
                                           stringToInts('payload')))),
      // split the 10-byte ID3 tag header in half
      front = tag.subarray(0, 5),
      back = tag.subarray(5);

    metadataStream.on('data', function(event) {
      events.push(event);
    });

    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 900,
      data: front
    });
    metadataStream.push({
      trackId: 7,
      pts: 1000,
      dts: 900,
      data: back
    });

    equal(events.length, 0, 'parsed zero tags');

    metadataStream.push({
      trackId: 7,
      pts: 1500,
      dts: 1500,
      data: new Uint8Array(id3Tag(id3Frame('PRIV',
                                           stringToCString('owner2'),
                                           stringToInts('payload2'))))
    });
    equal(events.length, 1, 'parsed one tag');
    equal(events[0].frames[0].owner, 'owner2', 'dropped the first tag');
  });

  // https://html.spec.whatwg.org/multipage/embedded-content.html#steps-to-expose-a-media-resource-specific-text-track
  test('constructs the dispatch type', function() {
    metadataStream = new videojs.Hls.MetadataStream({
      descriptor: new Uint8Array([0x03, 0x02, 0x01, 0x00])
    });

    equal(metadataStream.dispatchType, '1503020100', 'built the dispatch type');
  });

})(window, window.videojs);

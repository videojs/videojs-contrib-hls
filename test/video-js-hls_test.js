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
    ];

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
    equal(header[0], 'F'.charCodeAt(0), 'the signature is correct');
    equal(header[1], 'L'.charCodeAt(0), 'the signature is correct');
    equal(header[2], 'V'.charCodeAt(0), 'the signature is correct');

    deepEqual(expectedHeader, header, 'the rest of the header is correct');
  });

  test('parses the first bipbop segment', function() {
    var tag, bytes;
    parser.parseSegmentBinaryData(window.testSegment);
    
    ok(parser.tagsAvailable(), 'tags are available');
  });
})(this);

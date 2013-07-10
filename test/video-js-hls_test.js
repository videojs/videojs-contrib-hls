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
  var parser;

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
    var header = parser.getFlvHeader();
    ok(header, 'the header is truthy');
    equal(9 + 4, header.byteLength, 'the header length is correct');
    equal(header[0], 'F'.charCodeAt(0), 'the signature is correct');
    equal(header[1], 'L'.charCodeAt(0), 'the signature is correct');
    equal(header[2], 'V'.charCodeAt(0), 'the signature is correct');
  });

  test('parses the first bipbop segment', function() {
    parser.parseSegmentBinaryData(window.testSegment);
    
    ok(parser.tagsAvailable(), 'tags should be available');
  });
})(this);

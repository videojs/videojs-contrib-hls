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
var FlvTag = window.videojs.Hls.FlvTag;

module('FLV tag');

test('writeBytes with zero length writes the entire array', function() {
  var
    tag = new FlvTag(FlvTag.VIDEO_TAG),
    headerLength = tag.length;
  tag.writeBytes(new Uint8Array([0x1, 0x2, 0x3]));

  equal(3 + headerLength, tag.length, '3 payload bytes are written');
});

test('writeShort writes a two byte sequence', function() {
  var
    tag = new FlvTag(FlvTag.VIDEO_TAG),
    headerLength = tag.length;
  tag.writeShort(0x0102);

  equal(2 + headerLength, tag.length, '2 bytes are written');
  equal(0x0102,
        new DataView(tag.bytes.buffer).getUint16(tag.length - 2),
        'the value is written');
});

test('writeBytes grows the internal byte array dynamically', function() {
  var
    tag = new FlvTag(FlvTag.VIDEO_TAG),
    tooManyBytes = new Uint8Array(tag.bytes.byteLength + 1);

  try {
    tag.writeBytes(tooManyBytes);
    ok(true, 'the buffer grew to fit the data');
  } catch(e) {
    ok(!e, 'the buffer should grow');
  }
});

test('calculates the duration of a tag array from PTS values', function() {
  var tags = [], count = 20, i;

  for (i = 0; i < count; i++) {
    tags[i] = new FlvTag(FlvTag.VIDEO_TAG);
    tags[i].pts = i * 1000;
  }

  equal(FlvTag.durationFromTags(tags), count * 1000, 'calculated duration from PTS values');
});

test('durationFromTags() assumes 24fps if the last frame duration cannot be calculated', function() {
  var tags = [
    new FlvTag(FlvTag.VIDEO_TAG),
    new FlvTag(FlvTag.VIDEO_TAG),
    new FlvTag(FlvTag.VIDEO_TAG)
  ];
  tags[0].pts = 0;
  tags[1].pts = tags[2].pts = 1000;

  equal(FlvTag.durationFromTags(tags), 1000 + (1/24) , 'assumes 24fps video');
});

test('durationFromTags() returns zero if there are less than two frames', function() {
  equal(FlvTag.durationFromTags([]), 0, 'returns zero for empty input');
  equal(FlvTag.durationFromTags([new FlvTag(FlvTag.VIDEO_TAG)]), 0, 'returns zero for a singleton input');
});

})(this);

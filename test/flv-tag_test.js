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

test('audio type handled correctly', function(){
  var mp3Tag = new FlvTag(FlvTag.AUDIO_TAG, undefined, FlvTag.MP3_AUDIO), 
      aacTag = new FlvTag(FlvTag.AUDIO_TAG, undefined, FlvTag.AAC_AUDIO); 

  equal(12, mp3Tag.length, 'mp3 tag length is 12');
  equal(13, aacTag.length, 'aac tag length is 13');

  mp3Tag.finalize();
  aacTag.finalize();
  equal(mp3Tag.bytes[11], 0x2F, 'mp3 is set to 44khz 16 bit stereo');
  equal(aacTag.bytes[11], 0xAF, 'aac is set to 44khz 16 bit stereo');
  equal(aacTag.bytes[12], 0x01, 'aac extra data is 0x00');
});

})(this);  

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
  buffer,
  expGolomb,
  view;

module('Exponential Golomb coding');

test('small numbers are coded correctly', function() {
  var
    expected = [
      [0xF8, 0],
      [0x5F, 1],
      [0x7F, 2],
      [0x27, 3],
      [0x2F, 4],
      [0x37, 5],
      [0x3F, 6],
      [0x11, 7],
      [0x13, 8],
      [0x15, 9]
    ],
    i = expected.length,
    result;

  while (i--) {
    buffer = new Uint8Array([expected[i][0]]);
    expGolomb = new window.videojs.hls.ExpGolomb(buffer);
    result = expGolomb.readUnsignedExpGolomb();
    equal(expected[i][1], result, expected[i][0] + ' is decoded to ' + expected[i][1]);
  }
});

test('drops working data as it is parsed', function() {
  var expGolomb = new window.videojs.hls.ExpGolomb(new Uint8Array([0x00, 0xFF]));
  expGolomb.skipBits(8);
  equal(8, expGolomb.bitsAvailable(), '8 bits remain');
  equal(0xFF, expGolomb.readBits(8), 'the second byte is read');
});

test('drops working data when skipping leading zeros', function() {
  var expGolomb = new window.videojs.hls.ExpGolomb(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0xFF]));
  equal(32, expGolomb.skipLeadingZeros(), '32 leading zeros are dropped');
  equal(8, expGolomb.bitsAvailable(), '8 bits remain');
  equal(0xFF, expGolomb.readBits(8), 'the second byte is read');
});

test('drops working data when skipping leading zeros', function() {
  var expGolomb = new window.videojs.hls.ExpGolomb(new Uint8Array([0x15, 0xab, 0x40, 0xc8, 0xFF]));
  equal(3, expGolomb.skipLeadingZeros(), '3 leading zeros are dropped');
  equal((8 * 4) + 5, expGolomb.bitsAvailable(), '37 bits remain');
  expGolomb.skipBits(1);
  equal(0x5a, expGolomb.readBits(8), 'the next bits are read');
});

})(this);  

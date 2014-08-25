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

// see docs/hlse.md for instructions on how test data was generated

var stringFromBytes = function(bytes) {
  var result = '', i;

  for (i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
};

module('Decryption');

test('decrypts a single AES-128 with PKCS7 block', function() {
  var
    key =  new Uint32Array([0, 0, 0, 0]),
    initVector = key,
    // the string "howdy folks" encrypted
    encrypted = new Uint8Array([
      0xce, 0x90, 0x97, 0xd0,
      0x08, 0x46, 0x4d, 0x18,
      0x4f, 0xae, 0x01, 0x1c,
      0x82, 0xa8, 0xf0, 0x67]);

  deepEqual('howdy folks',
            stringFromBytes(videojs.Hls.decrypt(encrypted, key, initVector)),
            'decrypted with a byte array key');
});

test('decrypts multiple AES-128 blocks with CBC', function() {
  var
    key = new Uint32Array([0, 0, 0, 0]),
    initVector = key,
    // the string "0123456789abcdef01234" encrypted
    encrypted = new Uint8Array([
      0x14, 0xf5, 0xfe, 0x74,
      0x69, 0x66, 0xf2, 0x92,
      0x65, 0x1c, 0x22, 0x88,
      0xbb, 0xff, 0x46, 0x09,

      0x0b, 0xde, 0x5e, 0x71,
      0x77, 0x87, 0xeb, 0x84,
      0xa9, 0x54, 0xc2, 0x45,
      0xe9, 0x4e, 0x29, 0xb3
    ]);

  deepEqual('0123456789abcdef01234',
            stringFromBytes(videojs.Hls.decrypt(encrypted, key, initVector)),
            'decrypted multiple blocks');
});

})(window, window.videojs);

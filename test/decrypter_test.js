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

module('Decryption');

test('decrypts using AES-128 CBC with PKCS7', function() {
  // the string "howdy folks" with key and initialization
  // vector 
  var
    key =  [0, 0, 0, 0],
    initVector = key,
    encrypted = new Uint8Array([
      0xce, 0x90, 0x97, 0xd0,
      0x08, 0x46, 0x4d, 0x18,
      0x4f, 0xae, 0x01, 0x1c,
      0x82, 0xa8, 0xf0, 0x67]),
    length = 'howdy folks'.length,
    plaintext = new Uint8Array(length),
    i;

  i = length;
  while (i--) {
    plaintext[i] = 'howdy folks'.charCodeAt(i);
  }

  // decrypt works on the sjcl example site
  // correct output: [1752135524, 2032166511, 1818981125, 84215045]

  deepEqual(plaintext,
        new Uint8Array(videojs.hls.decrypt(encrypted, key, initVector)),
        'decrypted with a numeric key');
  deepEqual(plaintext,
        new Uint8Array(videojs.hls.decrypt(encrypted, key, initVector)),
        'decrypted with a byte array key');
});

})(window, window.videojs);

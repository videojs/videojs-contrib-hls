(function(window, videojs, unpad, undefined) {
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
            stringFromBytes(unpad(videojs.Hls.decrypt(encrypted, key, initVector))),
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
            stringFromBytes(unpad(videojs.Hls.decrypt(encrypted, key, initVector))),
            'decrypted multiple blocks');
});

var clock;

module('Incremental Processing', {
  setup: function() {
    clock = sinon.useFakeTimers();
  },
  teardown: function() {
    clock.restore();
  }
});

test('executes a callback after a timeout', function() {
  var asyncStream = new videojs.Hls.AsyncStream(),
      calls = '';
  asyncStream.push(function() {
    calls += 'a';
  });

  clock.tick(asyncStream.delay);
  equal(calls, 'a', 'invoked the callback once');
  clock.tick(asyncStream.delay);
  equal(calls, 'a', 'only invoked the callback once');
});

test('executes callback in series', function() {
  var asyncStream = new videojs.Hls.AsyncStream(),
      calls = '';
  asyncStream.push(function() {
    calls += 'a';
  });
  asyncStream.push(function() {
    calls += 'b';
  });

  clock.tick(asyncStream.delay);
  equal(calls, 'a', 'invoked the first callback');
  clock.tick(asyncStream.delay);
  equal(calls, 'ab', 'invoked the second');
});

var decrypter;

module('Incremental Decryption', {
  setup: function() {
    clock = sinon.useFakeTimers();
  },
  teardown: function() {
    clock.restore();
  }
});

test('asynchronously decrypts a 4-word block', function() {
  var
    key =  new Uint32Array([0, 0, 0, 0]),
    initVector = key,
    // the string "howdy folks" encrypted
    encrypted = new Uint8Array([
      0xce, 0x90, 0x97, 0xd0,
      0x08, 0x46, 0x4d, 0x18,
      0x4f, 0xae, 0x01, 0x1c,
      0x82, 0xa8, 0xf0, 0x67]),
    decrypted;

  decrypter = new videojs.Hls.Decrypter(encrypted, key, initVector, function(error, result) {
    decrypted = result;
  });
  ok(!decrypted, 'asynchronously decrypts');

  clock.tick(decrypter.asyncStream_.delay * 2);

  ok(decrypted, 'completed decryption');
  deepEqual('howdy folks',
            stringFromBytes(decrypted),
            'decrypts and unpads the result');
});

test('breaks up input greater than the step value', function() {
  var encrypted = new Int32Array(videojs.Hls.Decrypter.STEP + 4),
      done = false,
      decrypter = new videojs.Hls.Decrypter(encrypted,
                                            new Uint32Array(4),
                                            new Uint32Array(4),
                                            function() {
                                              done = true;
                                            });
  clock.tick(decrypter.asyncStream_.delay * 2);
  ok(!done, 'not finished after two ticks');

  clock.tick(decrypter.asyncStream_.delay);
  ok(done, 'finished after the last chunk is decrypted');
});

})(window, window.videojs, window.pkcs7.unpad);

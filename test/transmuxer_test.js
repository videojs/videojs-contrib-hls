(function(window, videojs) {
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
var
  Transmuxer = videojs.Hls.Transmuxer,
  transmuxer;

module('MP4 Transmuxer', {
  setup: function() {
    transmuxer = new Transmuxer();
  }
});

test('can mux an empty mp2t', function() {
  transmuxer.push(new Uint8Array());

  ok(transmuxer.mp4, 'produced a non-null result');
  strictEqual(transmuxer.mp4.byteLength, 0, 'produced an empty mp4');
});

})(window, window.videojs);

/* eslint-disable no-var */
/* eslint-env qunit */
var hls = require('../es5/videojs-contrib-hls.js');
var q = window.QUnit;

q.module('Browserify Require');
q.test('hls should be requirable and bundled via browserify', function(assert) {
  assert.ok(hls, 'videoj-contrib-hls is required properly');
});

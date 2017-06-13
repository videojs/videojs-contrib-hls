let hls = require('../');
let q = window.QUnit;

q.module('Webpack Require');
q.test('hls should be requirable and bundled via webpack', function(assert) {
  assert.ok(hls, 'videojs-contrib-hls is required properly');
});

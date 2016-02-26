import document from 'global/document';

import QUnit from 'qunit';
import sinon from 'sinon';
import videojs from 'video.js';

QUnit.module('videojs-contrib-hls - sanity', {
  beforeEach() {
    this.fixture = document.getElementById('qunit-fixture');
    this.video = document.createElement('video');
    this.fixture.appendChild(this.video);
    this.player = videojs(this.video);

    // Mock the environment's timers because certain things - particularly
    // player readiness - are asynchronous in video.js 5.
    this.clock = sinon.useFakeTimers();
  },

  afterEach() {

    // The clock _must_ be restored before disposing the player; otherwise,
    // certain timeout listeners that happen inside video.js may throw errors.
    this.clock.restore();
    this.player.dispose();
  }
});

QUnit.test('the environment is sane', function(assert) {
  assert.strictEqual(typeof Array.isArray, 'function', 'es5 exists');
  assert.strictEqual(typeof sinon, 'object', 'sinon exists');
  assert.strictEqual(typeof videojs, 'function', 'videojs exists');
  assert.strictEqual(typeof videojs.MediaSource, 'function', 'MediaSource is an object');
  assert.strictEqual(typeof videojs.URL, 'object', 'URL is an object');
  assert.strictEqual(typeof videojs.Hls, 'object', 'Hls is an object');
  assert.strictEqual(typeof videojs.HlsSourceHandler,
                     'function',
                     'HlsSourceHandler is a function');
  assert.strictEqual(typeof videojs.HlsHandler, 'function', 'HlsHandler is a function');
});

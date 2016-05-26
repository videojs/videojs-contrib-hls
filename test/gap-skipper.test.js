import videojs from 'video.js';
import QUnit from 'qunit';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse
} from './test-helpers.js';

QUnit.module('Adaptive Seeking', {
  beforeEach() {
    this.env = useFakeEnvironment();
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};

    // setup a player
    this.player = createPlayer();
  },

  afterEach() {
    this.env.restore();
    this.mse.restore();
    this.player.dispose();
  }
});
QUnit.test('Adaptive seeking skips over gap in firefox with waiting event', function() {
  this.player.autoplay(true);
  this.player.buffered = function() {
    return videojs.createTimeRanges([[0, 10], [20, 30]]);
  };
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);
  this.player.currentTime(10);
  this.player.trigger('waiting');
  this.clock.tick(12000);
  QUnit.equal(Math.round(this.player.currentTime()),
    20, 'Player seeked over gap after timer');
});

QUnit.test('Adaptive seeking skips over gap in chrome without waiting event', function() {
  let tempBuffered = this.player.buffered;

  this.player.autoplay(true);
  this.player.buffered = function() {
    return videojs.createTimeRanges([[0, 10], [20, 30]]);
  };
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);
  this.player.currentTime(10);
  for (let i = 0; i < 10; i++) {
    this.player.trigger('timeupdate');
  }
  this.clock.tick(2000);
  QUnit.equal(this.player.currentTime(), 10, 'Player doesnt seek over gap pre-timer');
  this.clock.tick(10000);
  QUnit.equal(Math.round(this.player.currentTime()),
    20, 'Player seeked over gap after timer');
  this.player.buffered = tempBuffered;
  this.player.currentTime(0);
});

import videojs from 'video.js';
import QUnit from 'qunit';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse
} from './test-helpers.js';
import AlwaysBePlaying from '../src/always-be-playing';

let monitorCurrentTime_;

QUnit.module('AlwaysBePlaying', {
  beforeEach() {
    this.env = useFakeEnvironment();
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};

    // setup a player
    this.player = createPlayer();
    this.player.autoplay(true);
  },

  afterEach() {
    this.env.restore();
    this.mse.restore();
    this.player.dispose();
  }
});

QUnit.test('skips over gap in firefox with waiting event', function() {
  // create a buffer with a gap between 10 & 20 seconds
  this.player.tech_.buffered = function() {
    return videojs.createTimeRanges([[0, 10], [20, 30]]);
  };

  // set an arbitrary source
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  // seek to 10 seconds and wait 12 seconds
  this.player.currentTime(10);
  this.player.tech_.trigger('waiting');
  this.clock.tick(12000);

  // check that player jumped the gap
  QUnit.equal(Math.round(this.player.currentTime()),
    20, 'Player seeked over gap after timer');
});

QUnit.test('skips over gap in chrome without waiting event', function() {
  // create a buffer with a gap between 10 & 20 seconds
  this.player.tech_.buffered = function() {
    return videojs.createTimeRanges([[0, 10], [20, 30]]);
  };

  // set an arbitrary source
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  // seek to 10 seconds & simulate chrome waiting event
  this.player.currentTime(10);

  this.clock.tick(4000);

  // checks that player doesn't seek before timer expires
  QUnit.equal(this.player.currentTime(), 10, 'Player doesnt seek over gap pre-timer');
  this.clock.tick(10000);

  // check that player jumped the gap
  QUnit.equal(Math.round(this.player.currentTime()),
    20, 'Player seeked over gap after timer');

});

QUnit.test('skips over gap in Chrome due to video underflow', function() {
  this.player.tech_.buffered = () => {
    return videojs.createTimeRanges([[0, 10], [10.1, 20]]);
  };

  // set an arbitrary source
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  this.player.currentTime(13);

  let seeks = [];

  this.player.tech_.setCurrentTime = (time) => {
    seeks.push(time);
  };

  this.player.tech_.trigger('waiting');

  QUnit.equal(seeks.length, 1, 'one seek');
  QUnit.equal(seeks[0], 13, 'player seeked to current time');
});

QUnit.test('seek to live point if we fall off the end of a live playlist', function() {
  // set an arbitrary live source
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // start playback normally
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  this.clock.tick(1);

  this.player.currentTime(0);

  let seeks = [];

  this.player.tech_.setCurrentTime = (time) => {
    seeks.push(time);
  };

  this.player.tech_.hls.masterPlaylistController_.alwaysBePlaying_.seekable = () => {
    return videojs.createTimeRanges([[1, 45]]);
  };

  this.player.tech_.trigger('waiting');

  QUnit.equal(seeks.length, 1, 'one seek');
  QUnit.equal(seeks[0], 45, 'player seeked to live point');
});

QUnit.module('AlwaysBePlaying isolated functions', {
  beforeEach() {
    monitorCurrentTime_ = AlwaysBePlaying.prototype.monitorCurrentTime_;
    AlwaysBePlaying.prototype.monitorCurrentTime_ = () => {};
    this.alwaysBePlaying = new AlwaysBePlaying({
      tech: {
        on: () => {},
        off: () => {}
      }
    });
  },
  afterEach() {
    this.alwaysBePlaying.dispose();
    AlwaysBePlaying.prototype.monitorCurrentTime_ = monitorCurrentTime_;
  }
});

QUnit.test('skips gap from video underflow', function() {
  QUnit.equal(
    this.alwaysBePlaying.gapFromVideoUnderflow_(videojs.createTimeRanges(), 0),
    null,
    'returns null when buffer is empty');
  QUnit.equal(
    this.alwaysBePlaying.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10]]), 13),
    null,
    'returns null when there is only a previous buffer');
  QUnit.equal(
    this.alwaysBePlaying.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 15),
    null,
    'returns null when gap is too far from current time');
  QUnit.equal(
    this.alwaysBePlaying.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 9.9),
    null,
    'returns null when gap is after current time');
  QUnit.equal(
    this.alwaysBePlaying.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10.1], [10.2, 20]]), 12.1),
    null,
    'returns null when time is less than or equal to 2 seconds ahead');
  QUnit.equal(
    this.alwaysBePlaying.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 14.1),
    null,
    'returns null when time is greater than or equal to 4 seconds ahead');
  QUnit.deepEqual(
    this.alwaysBePlaying.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 12.2),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is greater than 2 seconds ahead in a buffer');
  QUnit.deepEqual(
    this.alwaysBePlaying.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 13),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is 3 seconds ahead in a buffer');
  QUnit.deepEqual(
    this.alwaysBePlaying.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 13.9),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is less than 4 seconds ahead in a buffer');
  // In a case where current time is outside of the buffered range, something odd must've
  // happened, but we should still allow the player to try to continue from that spot.
  QUnit.deepEqual(
    this.alwaysBePlaying.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 12.9]]), 13),
    {start: 10, end: 10.1},
    'returns gap even when current time is not in buffered range');
});

QUnit.test('check fell out of live window', function() {
  let checkFellOutOfLiveWindow_ =
    this.alwaysBePlaying.checkFellOutOfLiveWindow_.bind(this.alwaysBePlaying);
  let seeks = [];

  this.alwaysBePlaying.tech_.setCurrentTime = (currentTime) => {
    seeks.push(currentTime);
  };

  QUnit.ok(
    !checkFellOutOfLiveWindow_(null, videojs.createTimeRanges([[11, 20]]), 10),
    'false if no playlist');
  QUnit.equal(seeks.length, 0, 'does not seek');
  QUnit.ok(
    !checkFellOutOfLiveWindow_(
      { endList: true }, videojs.createTimeRanges([[11, 20]]), 10),
    'false if playlist not live');
  QUnit.equal(seeks.length, 0, 'does not seek');
  QUnit.ok(
    checkFellOutOfLiveWindow_(
      { endList: false }, videojs.createTimeRanges([[11, 20]]), 10),
    'true if playlist live and current time before seekable');
  QUnit.equal(seeks.length, 1, 'seeks');
  QUnit.equal(seeks[0], 20, 'seeks to seekable end');

  seeks.length = 0;

  QUnit.ok(
    !checkFellOutOfLiveWindow_(
      { endList: false }, videojs.createTimeRanges([]), 10),
    'false if no seekable range');
  QUnit.equal(seeks.length, 0, 'does not seek');
  QUnit.ok(
    !checkFellOutOfLiveWindow_(
      { endList: false }, videojs.createTimeRanges([[11, 20]]), 11),
    'false if current time at seekable start');
  QUnit.equal(seeks.length, 0, 'does not seek');
  QUnit.ok(
    !checkFellOutOfLiveWindow_(
      { endList: false }, videojs.createTimeRanges([[11, 20]]), 20),
    'false if current time at seekable end');
  QUnit.equal(seeks.length, 0, 'does not seek');
  QUnit.ok(
    !checkFellOutOfLiveWindow_(
      { endList: false }, videojs.createTimeRanges([[11, 20]]), 15),
    'false if current time within seekable range');
  QUnit.equal(seeks.length, 0, 'does not seek');
  QUnit.ok(
    !checkFellOutOfLiveWindow_(
      { endList: false }, videojs.createTimeRanges([[11, 20]]), 21),
    'false if current time past seekable range');
  QUnit.equal(seeks.length, 0, 'does not seek');
  QUnit.ok(
    checkFellOutOfLiveWindow_(
      { endList: false }, videojs.createTimeRanges([[11, 20]]), 0),
    'true if current time is 0 and earlier than seekable range');
  QUnit.equal(seeks.length, 1, 'does not seek');
  QUnit.equal(seeks[0], 20, 'seeks to seekable end');
});

import videojs from 'video.js';
import QUnit from 'qunit';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse
} from './test-helpers.js';
import PlaybackWatcher from '../src/playback-watcher';

let monitorCurrentTime_;

QUnit.module('PlaybackWatcher', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
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

QUnit.test('skips over gap in firefox with waiting event', function(assert) {

  this.player.autoplay(true);

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
  assert.equal(Math.round(this.player.currentTime()),
    20, 'Player seeked over gap after timer');
});

QUnit.test('skips over gap in chrome without waiting event', function(assert) {
  this.player.autoplay(true);

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
  assert.equal(this.player.currentTime(), 10, 'Player doesnt seek over gap pre-timer');
  this.clock.tick(10000);

  // check that player jumped the gap
  assert.equal(Math.round(this.player.currentTime()),
    20, 'Player seeked over gap after timer');

});

QUnit.test('skips over gap in Chrome due to video underflow', function(assert) {
  this.player.autoplay(true);

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

  assert.equal(seeks.length, 1, 'one seek');
  assert.equal(seeks[0], 13, 'player seeked to current time');
});

QUnit.test('seek to live point if we fall off the end of a live playlist', function(assert) {
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

  this.player.tech_.hls.playbackWatcher_.seekable = () => {
    return videojs.createTimeRanges([[1, 45]]);
  };

  this.player.tech_.trigger('waiting');

  assert.equal(seeks.length, 1, 'one seek');
  assert.equal(seeks[0], 45, 'player seeked to live point');
});

QUnit.test('fires notifications when activated', function(assert) {
  let buffered = [[]];
  let seekable = [[]];
  let currentTime = 0;
  let liveresync = 0;
  let videounderflow = 0;
  let playbackWatcher;

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.currentTime = function() {
    return currentTime;
  };
  this.player.tech_.buffered = function() {
    return {
      length: buffered.length,
      start(i) {
        return buffered[i][0];
      },
      end(i) {
        return buffered[i][1];
      }
    };
  };
  playbackWatcher = this.player.tech_.hls.playbackWatcher_;
  playbackWatcher.seekable = function() {
    return {
      length: seekable.length,
      start(i) {
        return seekable[i][0];
      },
      end(i) {
        return seekable[i][1];
      }
    };
  };
  this.player.tech_.on('liveresync', () => liveresync++);
  this.player.tech_.on('videounderflow', () => videounderflow++);

  currentTime = 19;
  seekable[0] = [20, 30];
  playbackWatcher.waiting_();
  assert.equal(liveresync, 1, 'triggered a liveresync event');

  currentTime = 12;
  seekable[0] = [0, 100];
  buffered = [[0, 9], [10, 20]];
  playbackWatcher.waiting_();
  assert.equal(videounderflow, 1, 'triggered a videounderflow event');
  assert.equal(liveresync, 1, 'did not trigger an additional liveresync event');
});

QUnit.test('fixes bad seeks', function(assert) {
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

  let playbackWatcher = this.player.tech_.hls.playbackWatcher_;
  let seeks = [];
  let seekable;
  let seeking;
  let currentTime;

  playbackWatcher.seekable = () => seekable;
  playbackWatcher.tech_ = {
    seeking: () => seeking,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    currentTime: () => currentTime
  };

  currentTime = 50;
  seekable = videojs.createTimeRanges([[1, 45]]);
  seeking = false;
  assert.ok(!playbackWatcher.fixesBadSeeks_(), 'does nothing when not seeking');
  assert.equal(seeks.length, 0, 'did not seek');

  seeking = true;
  assert.ok(playbackWatcher.fixesBadSeeks_(), 'acts when seek past seekable range');
  assert.equal(seeks.length, 1, 'seeked');
  assert.equal(seeks[0], 45, 'player seeked to live point');

  currentTime = 0;
  assert.ok(playbackWatcher.fixesBadSeeks_(), 'acts when seek before seekable range');
  assert.equal(seeks.length, 2, 'seeked');
  assert.equal(seeks[1], 45, 'player seeked to live point');

  currentTime = 30;
  assert.ok(!playbackWatcher.fixesBadSeeks_(), 'does nothing when time within range');
  assert.equal(seeks.length, 2, 'did not seek');
});

QUnit.test('seeks to live point if we try to seek outside of seekable', function(assert) {
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

  let playbackWatcher = this.player.tech_.hls.playbackWatcher_;
  let seeks = [];
  let seekable;
  let seeking;
  let currentTime;

  playbackWatcher.seekable = () => seekable;
  playbackWatcher.tech_ = {
    seeking: () => seeking,
    setCurrentTime: (time) => {
      seeks.push(time);
    },
    currentTime: () => currentTime,
    // mocked out
    paused: () => false,
    buffered: () => videojs.createTimeRanges()
  };

  // waiting

  currentTime = 50;
  seekable = videojs.createTimeRanges([[1, 45]]);
  seeking = true;
  this.player.tech_.trigger('waiting');
  assert.equal(seeks.length, 1, 'seeked');
  assert.equal(seeks[0], 45, 'player seeked to live point');

  currentTime = 0;
  this.player.tech_.trigger('waiting');
  assert.equal(seeks.length, 2, 'seeked');
  assert.equal(seeks[1], 45, 'player seeked to live point');

  // inside of seekable range
  currentTime = 10;
  this.player.tech_.trigger('waiting');
  assert.equal(seeks.length, 2, 'did not seek');

  currentTime = 50;
  // if we're not seeking, the case shouldn't be handled here
  seeking = false;
  this.player.tech_.trigger('waiting');
  assert.equal(seeks.length, 2, 'did not seek');

  // no check for 0 with seeking false because that should be handled by live falloff

  // checkCurrentTime

  seeking = true;
  currentTime = 50;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 3, 'seeked');
  assert.equal(seeks[2], 45, 'player seeked to live point');

  currentTime = 0;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 4, 'seeked');
  assert.equal(seeks[3], 45, 'player seeked to live point');

  currentTime = 10;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 4, 'did not seek');

  seeking = false;
  currentTime = 50;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 4, 'did not seek');

  currentTime = 0;
  playbackWatcher.checkCurrentTime_();
  assert.equal(seeks.length, 4, 'did not seek');
});

QUnit.test('calls fixesBadSeeks_ on seekablechanged', function(assert) {
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

  let playbackWatcher = this.player.tech_.hls.playbackWatcher_;
  let fixesBadSeeks_ = 0;

  playbackWatcher.fixesBadSeeks_ = () => fixesBadSeeks_++;

  this.player.tech_.trigger('seekablechanged');

  assert.equal(fixesBadSeeks_, 1, 'fixesBadSeeks_ was called');
});

QUnit.module('PlaybackWatcher isolated functions', {
  beforeEach() {
    monitorCurrentTime_ = PlaybackWatcher.prototype.monitorCurrentTime_;
    PlaybackWatcher.prototype.monitorCurrentTime_ = () => {};
    this.playbackWatcher = new PlaybackWatcher({
      tech: {
        on: () => {},
        off: () => {}
      }
    });
  },
  afterEach() {
    this.playbackWatcher.dispose();
    PlaybackWatcher.prototype.monitorCurrentTime_ = monitorCurrentTime_;
  }
});

QUnit.test('skips gap from video underflow', function(assert) {
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges(), 0),
    null,
    'returns null when buffer is empty');
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(videojs.createTimeRanges([[0, 10]]), 13),
    null,
    'returns null when there is only a previous buffer');
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 15),
    null,
    'returns null when gap is too far from current time');
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 9.9),
    null,
    'returns null when gap is after current time');
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10.1], [10.2, 20]]), 12.1),
    null,
    'returns null when time is less than or equal to 2 seconds ahead');
  assert.equal(
    this.playbackWatcher.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 14.1),
    null,
    'returns null when time is greater than or equal to 4 seconds ahead');
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 12.2),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is greater than 2 seconds ahead in a buffer');
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 13),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is 3 seconds ahead in a buffer');
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 20]]), 13.9),
    {start: 10, end: 10.1},
    'returns gap when gap is small and time is less than 4 seconds ahead in a buffer');
  // In a case where current time is outside of the buffered range, something odd must've
  // happened, but we should still allow the player to try to continue from that spot.
  assert.deepEqual(
    this.playbackWatcher.gapFromVideoUnderflow_(
      videojs.createTimeRanges([[0, 10], [10.1, 12.9]]), 13),
    {start: 10, end: 10.1},
    'returns gap even when current time is not in buffered range');
});

QUnit.test('detects live window falloff', function(assert) {
  let fellOutOfLiveWindow_ =
    this.playbackWatcher.fellOutOfLiveWindow_.bind(this.playbackWatcher);

  assert.ok(
    fellOutOfLiveWindow_(videojs.createTimeRanges([[11, 20]]), 10),
    'true if playlist live and current time before seekable');

  assert.ok(
    !fellOutOfLiveWindow_(videojs.createTimeRanges([]), 10),
    'false if no seekable range');
  assert.ok(
    !fellOutOfLiveWindow_(videojs.createTimeRanges([[0, 10]]), -1),
    'false if seekable range starts at 0');
  assert.ok(
    !fellOutOfLiveWindow_(videojs.createTimeRanges([[11, 20]]), 11),
    'false if current time at seekable start');
  assert.ok(
    !fellOutOfLiveWindow_(videojs.createTimeRanges([[11, 20]]), 20),
    'false if current time at seekable end');
  assert.ok(
    !fellOutOfLiveWindow_(videojs.createTimeRanges([[11, 20]]), 15),
    'false if current time within seekable range');
  assert.ok(
    !fellOutOfLiveWindow_(videojs.createTimeRanges([[11, 20]]), 21),
    'false if current time past seekable range');
  assert.ok(
    fellOutOfLiveWindow_(videojs.createTimeRanges([[11, 20]]), 0),
    'true if current time is 0 and earlier than seekable range');
});

QUnit.test('detects outside of seekable window', function(assert) {
  let outsideOfSeekableWindow =
    this.playbackWatcher.outsideOfSeekableWindow_.bind(this.playbackWatcher);

  assert.ok(
    outsideOfSeekableWindow(videojs.createTimeRanges([[11, 20]]), 10.8),
    'true if before seekable range');
  assert.ok(
    outsideOfSeekableWindow(videojs.createTimeRanges([[11, 20]]), 20.2),
    'true if after seekable range');
  assert.ok(
    !outsideOfSeekableWindow(videojs.createTimeRanges([[11, 20]]), 10.9),
    'false if within starting seekable range buffer');
  assert.ok(
    !outsideOfSeekableWindow(videojs.createTimeRanges([[11, 20]]), 20.1),
    'false if within ending seekable range buffer');

  assert.ok(
    !outsideOfSeekableWindow(videojs.createTimeRanges(), 10),
    'false if no seekable range');
  assert.ok(
    outsideOfSeekableWindow(videojs.createTimeRanges([[0, 10]]), -0.2),
    'true even if current time is negative');
  assert.ok(
    !outsideOfSeekableWindow(videojs.createTimeRanges([[0, 10]]), 5),
    'false if within seekable range');
  assert.ok(
    !outsideOfSeekableWindow(videojs.createTimeRanges([[0, 10]]), 0),
    'false if within seekable range');
  assert.ok(
    !outsideOfSeekableWindow(videojs.createTimeRanges([[0, 10]]), 10),
    'false if within seekable range');
});

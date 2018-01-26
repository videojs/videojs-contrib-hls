import QUnit from 'qunit';
import {
  createPlayer,
  useFakeEnvironment,
  openMediaSource,
  useFakeMediaSource
} from './test-helpers.js';
import videojs from 'video.js';

/* eslint-disable no-unused-vars */
// we need this so that it can register hls with videojs
import {HlsSourceHandler, HlsHandler, Hls} from '../src/videojs-contrib-hls';
/* eslint-enable no-unused-vars */
import Config from '../src/config';

// list of posible options
// name - the proprety name
// default - the default value
// test - alternative value to verify that default is not used
// alt - another alternative value to very that test/default are not used
const options = [{
  name: 'withCredentials',
  default: false,
  test: true,
  alt: false
}, {
  name: 'bandwidth',
  default: 4194304,
  test: 5,
  alt: 555
}];

const CONFIG_KEYS = Object.keys(Config);

QUnit.module('Configuration - Deprication', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};

    CONFIG_KEYS.forEach((key) => this.old[key] = Config[key]);

    // force the HLS tech to run
    this.old.NativeHlsSupport = videojs.Hls.supportsNativeHls;
    videojs.Hls.supportsNativeHls = false;
  },

  afterEach() {
    CONFIG_KEYS.forEach((key) => Config[key] = this.old[key]);

    this.env.restore();
    this.mse.restore();
    videojs.Hls.supportsNativeHls = this.old.NativeHlsSupport;
  }
});

QUnit.test('GOAL_BUFFER_LENGTH get warning', function(assert) {
  assert.equal(Hls.GOAL_BUFFER_LENGTH,
              Config.GOAL_BUFFER_LENGTH,
              'Hls.GOAL_BUFFER_LENGTH returns the default');
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('GOAL_BUFFER_LENGTH set warning', function(assert) {
  Hls.GOAL_BUFFER_LENGTH = 10;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.GOAL_BUFFER_LENGTH, 10, 'returns what we set it to');
});

QUnit.test('GOAL_BUFFER_LENGTH set warning and invalid', function(assert) {
  Hls.GOAL_BUFFER_LENGTH = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.GOAL_BUFFER_LENGTH, 30, 'default');

  Hls.GOAL_BUFFER_LENGTH = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.GOAL_BUFFER_LENGTH, 30, 'default');
});

QUnit.test('MAX_GOAL_BUFFER_LENGTH get warning', function(assert) {
  assert.equal(Hls.MAX_GOAL_BUFFER_LENGTH,
              Config.MAX_GOAL_BUFFER_LENGTH,
              'Hls.MAX_GOAL_BUFFER_LENGTH returns the default');
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('MAX_GOAL_BUFFER_LENGTH set warning', function(assert) {
  Hls.MAX_GOAL_BUFFER_LENGTH = 10;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.MAX_GOAL_BUFFER_LENGTH, 10, 'returns what we set it to');
});

QUnit.test('MAX_GOAL_BUFFER_LENGTH set warning and invalid', function(assert) {
  Hls.MAX_GOAL_BUFFER_LENGTH = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.MAX_GOAL_BUFFER_LENGTH, 60, 'default');

  Hls.MAX_GOAL_BUFFER_LENGTH = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.MAX_GOAL_BUFFER_LENGTH, 60, 'default');
});

QUnit.test('GOAL_BUFFER_LENGTH_RATE get warning', function(assert) {
  assert.equal(Hls.GOAL_BUFFER_LENGTH_RATE,
              Config.GOAL_BUFFER_LENGTH_RATE,
              'Hls.GOAL_BUFFER_LENGTH_RATE returns the default');
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('GOAL_BUFFER_LENGTH_RATE set warning', function(assert) {
  Hls.GOAL_BUFFER_LENGTH_RATE = 10;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.GOAL_BUFFER_LENGTH_RATE, 10, 'returns what we set it to');
});

QUnit.test('GOAL_BUFFER_LENGTH_RATE set warning and invalid', function(assert) {
  Hls.GOAL_BUFFER_LENGTH_RATE = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.GOAL_BUFFER_LENGTH_RATE, 1, 'default');

  Hls.GOAL_BUFFER_LENGTH_RATE = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.GOAL_BUFFER_LENGTH_RATE, 1, 'default');
});

QUnit.test('BUFFER_LOW_WATER_LINE get warning', function(assert) {
  assert.equal(Hls.BUFFER_LOW_WATER_LINE,
              Config.BUFFER_LOW_WATER_LINE,
              'Hls.BUFFER_LOW_WATER_LINE returns the default');
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('BUFFER_LOW_WATER_LINE set warning', function(assert) {
  Hls.BUFFER_LOW_WATER_LINE = 20;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.BUFFER_LOW_WATER_LINE, 20, 'returns what we set it to');

  // Allow setting to 0
  Hls.BUFFER_LOW_WATER_LINE = 0;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.BUFFER_LOW_WATER_LINE, 0, 'returns what we set it to');
});

QUnit.test('BUFFER_LOW_WATER_LINE set warning and invalid', function(assert) {
  Hls.BUFFER_LOW_WATER_LINE = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BUFFER_LOW_WATER_LINE, 0, 'default');

  Hls.BUFFER_LOW_WATER_LINE = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BUFFER_LOW_WATER_LINE, 0, 'default');
});

QUnit.test('MAX_BUFFER_LOW_WATER_LINE get warning', function(assert) {
  assert.equal(Hls.MAX_BUFFER_LOW_WATER_LINE,
              Config.MAX_BUFFER_LOW_WATER_LINE,
              'Hls.MAX_BUFFER_LOW_WATER_LINE returns the default');
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('MAX_BUFFER_LOW_WATER_LINE set warning', function(assert) {
  Hls.MAX_BUFFER_LOW_WATER_LINE = 20;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.MAX_BUFFER_LOW_WATER_LINE, 20, 'returns what we set it to');

  // Allow setting to 0
  Hls.MAX_BUFFER_LOW_WATER_LINE = 0;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.MAX_BUFFER_LOW_WATER_LINE, 0, 'returns what we set it to');
});

QUnit.test('MAX_BUFFER_LOW_WATER_LINE set warning and invalid', function(assert) {
  Hls.MAX_BUFFER_LOW_WATER_LINE = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.MAX_BUFFER_LOW_WATER_LINE, 30, 'default');

  Hls.MAX_BUFFER_LOW_WATER_LINE = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.MAX_BUFFER_LOW_WATER_LINE, 30, 'default');
});

QUnit.test('BUFFER_LOW_WATER_LINE_RATE get warning', function(assert) {
  assert.equal(Hls.BUFFER_LOW_WATER_LINE_RATE,
              Config.BUFFER_LOW_WATER_LINE_RATE,
              'Hls.BUFFER_LOW_WATER_LINE_RATE returns the default');
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');
});

QUnit.test('BUFFER_LOW_WATER_LINE_RATE set warning', function(assert) {
  Hls.BUFFER_LOW_WATER_LINE_RATE = 10;
  assert.equal(this.env.log.warn.calls, 1, 'logged a warning');

  assert.equal(Config.BUFFER_LOW_WATER_LINE_RATE, 10, 'returns what we set it to');
});

QUnit.test('BUFFER_LOW_WATER_LINE_RATE set warning and invalid', function(assert) {
  Hls.BUFFER_LOW_WATER_LINE_RATE = 'nope';
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BUFFER_LOW_WATER_LINE_RATE, 1, 'default');

  Hls.BUFFER_LOW_WATER_LINE_RATE = -1;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.BUFFER_LOW_WATER_LINE_RATE, 1, 'default');
});

QUnit.module('Configuration - Options', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};

    // force the HLS tech to run
    this.old.NativeHlsSupport = videojs.Hls.supportsNativeHls;
    videojs.Hls.supportsNativeHls = false;
  },

  afterEach() {
    this.env.restore();
    this.mse.restore();
    videojs.Hls.supportsNativeHls = this.old.NativeHlsSupport;

    this.player.dispose();
    videojs.options.hls = {};

  }
});

options.forEach((opt) => {
  QUnit.test(`default ${opt.name}`, function(assert) {
    this.player = createPlayer();
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    openMediaSource(this.player, this.clock);

    let hls = this.player.tech_.hls;

    assert.equal(hls.options_[opt.name],
                opt.default,
                `${opt.name} should be default`);
  });

  QUnit.test(`global ${opt.name}`, function(assert) {
    videojs.options.hls[opt.name] = opt.test;
    this.player = createPlayer();
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    openMediaSource(this.player, this.clock);

    let hls = this.player.tech_.hls;

    assert.equal(hls.options_[opt.name],
                opt.test,
                `${opt.name} should be equal to global`);
  });

  QUnit.test(`sourceHandler ${opt.name}`, function(assert) {
    let sourceHandlerOptions = {html5: {hls: {}}};

    sourceHandlerOptions.html5.hls[opt.name] = opt.test;
    this.player = createPlayer(sourceHandlerOptions);
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    openMediaSource(this.player, this.clock);

    let hls = this.player.tech_.hls;

    assert.equal(hls.options_[opt.name],
                opt.test,
                `${opt.name} should be equal to sourceHandler Option`);
  });

  QUnit.test(`src ${opt.name}`, function(assert) {
    let srcOptions = {
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    };

    srcOptions[opt.name] = opt.test;
    this.player = createPlayer();
    this.player.src(srcOptions);

    openMediaSource(this.player, this.clock);

    let hls = this.player.tech_.hls;

    assert.equal(hls.options_[opt.name],
                opt.test,
                `${opt.name} should be equal to src option`);
  });

  QUnit.test(`srcHandler overrides global ${opt.name}`, function(assert) {
    let sourceHandlerOptions = {html5: {hls: {}}};

    sourceHandlerOptions.html5.hls[opt.name] = opt.test;
    videojs.options.hls[opt.name] = opt.alt;
    this.player = createPlayer(sourceHandlerOptions);
    this.player.src({
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });

    openMediaSource(this.player, this.clock);

    let hls = this.player.tech_.hls;

    assert.equal(hls.options_[opt.name],
                opt.test,
                `${opt.name} should be equal to sourchHandler option`);
  });

  QUnit.test(`src overrides sourceHandler ${opt.name}`, function(assert) {
    let sourceHandlerOptions = {html5: {hls: {}}};
    let srcOptions = {
      src: 'http://example.com/media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    };

    sourceHandlerOptions.html5.hls[opt.name] = opt.alt;
    srcOptions[opt.name] = opt.test;
    this.player = createPlayer(sourceHandlerOptions);
    this.player.src(srcOptions);

    openMediaSource(this.player, this.clock);

    let hls = this.player.tech_.hls;

    assert.equal(hls.options_[opt.name],
                opt.test,
                `${opt.name} should be equal to sourchHandler option`);
  });
});

QUnit.module('Configuration - Global Only', {
  beforeEach() {
    videojs.options.hls = {};
  },

  afterEach() {
    videojs.options.hls = {};
  }
});

QUnit.test('global mode override - flash', function(assert) {
  videojs.options.hls.mode = 'flash';
  let htmlSourceHandler = new HlsSourceHandler('html5');
  let flashSourceHandler = new HlsSourceHandler('flash');

  assert.equal(
    htmlSourceHandler.canHandleSource({type: 'application/x-mpegURL'}),
    false,
    'Cannot play html as we are overriden not to');

  assert.equal(
    flashSourceHandler.canHandleSource({type: 'application/x-mpegURL'}),
    true,
    'Can play flash as it is supported and overides allow');
});

QUnit.test('global mode override - html', function(assert) {
  videojs.options.hls.mode = 'html5';
  let htmlSourceHandler = new HlsSourceHandler('html5');
  let flashSourceHandler = new HlsSourceHandler('flash');

  assert.equal(
    htmlSourceHandler.canHandleSource({type: 'application/x-mpegURL'}),
    true,
    'Can play html as we support it and overides allow');

  assert.equal(
    flashSourceHandler.canHandleSource({type: 'application/x-mpegURL'}),
    false,
    'Cannot play flash as we are overiden not to');
});


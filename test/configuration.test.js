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

QUnit.module('Configuration - Deprication', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};
    this.old.GOAL_BUFFER_LENGTH = Config.GOAL_BUFFER_LENGTH;
    // force the HLS tech to run
    this.old.NativeHlsSupport = videojs.Hls.supportsNativeHls;
    videojs.Hls.supportsNativeHls = false;
  },

  afterEach() {
    Config.GOAL_BUFFER_LENGTH = this.old.GOAL_BUFFER_LENGTH;

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

  Hls.GOAL_BUFFER_LENGTH = 0;
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings');

  assert.equal(Config.GOAL_BUFFER_LENGTH, 30, 'default');
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

    let hls = this.player.tech_.hls;

    openMediaSource(this.player, this.clock);
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

    let hls = this.player.tech_.hls;

    openMediaSource(this.player, this.clock);
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

    let hls = this.player.tech_.hls;

    openMediaSource(this.player, this.clock);
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

    let hls = this.player.tech_.hls;

    openMediaSource(this.player, this.clock);
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

    let hls = this.player.tech_.hls;

    openMediaSource(this.player, this.clock);
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

    let hls = this.player.tech_.hls;

    openMediaSource(this.player, this.clock);
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


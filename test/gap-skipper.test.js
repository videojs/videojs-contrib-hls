/* eslint-disable max-len */

import document from 'global/document';
import videojs from 'video.js';
import QUnit from 'qunit';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse
} from './test-helpers.js';
/* eslint-disable no-unused-vars */
// we need this so that it can register hls with videojs
import {HlsSourceHandler, HlsHandler, Hls} from '../src/videojs-contrib-hls';
import HlsAudioTrack from '../src/hls-audio-track';
/* eslint-enable no-unused-vars */

const Flash = videojs.getComponent('Flash');
let nextId = 0;

// do a shallow copy of the properties of source onto the target object
const merge = function(target, source) {
  let name;

  for (name in source) {
    target[name] = source[name];
  }
};

QUnit.module('HLS', {
  beforeEach() {
    this.env = useFakeEnvironment();
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.clock = this.env.clock;
    this.old = {};

    // mock out Flash features for phantomjs
    this.old.Flash = videojs.mergeOptions({}, Flash);
    /* eslint-disable camelcase */
    Flash.embed = function(swf, flashVars) {
      let el = document.createElement('div');

      el.id = 'vjs_mock_flash_' + nextId++;
      el.className = 'vjs-tech vjs-mock-flash';
      el.duration = Infinity;
      el.vjs_load = function() {};
      el.vjs_getProperty = function(attr) {
        if (attr === 'buffered') {
          return [[0, 0]];
        }
        return el[attr];
      };
      el.vjs_setProperty = function(attr, value) {
        el[attr] = value;
      };
      el.vjs_src = function() {};
      el.vjs_play = function() {};
      el.vjs_discontinuity = function() {};

      if (flashVars.autoplay) {
        el.autoplay = true;
      }
      if (flashVars.preload) {
        el.preload = flashVars.preload;
      }

      el.currentTime = 0;

      return el;
    };
    /* eslint-enable camelcase */
    this.old.FlashSupported = Flash.isSupported;
    Flash.isSupported = function() {
      return true;
    };

    // store functionality that some tests need to mock
    this.old.GlobalOptions = videojs.mergeOptions(videojs.options);

    // force the HLS tech to run
    this.old.NativeHlsSupport = videojs.Hls.supportsNativeHls;
    videojs.Hls.supportsNativeHls = false;

    this.old.Decrypt = videojs.Hls.Decrypter;
    videojs.Hls.Decrypter = function() {};

    // setup a player
    this.player = createPlayer();
  },

  afterEach() {
    this.env.restore();
    this.mse.restore();

    merge(videojs.options, this.old.GlobalOptions);
    Flash.isSupported = this.old.FlashSupported;
    merge(Flash, this.old.Flash);

    videojs.Hls.supportsNativeHls = this.old.NativeHlsSupport;
    videojs.Hls.Decrypter = this.old.Decrypt;

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
  QUnit.equal(this.player.currentTime(), 20, 'Player seeked over gap after timer');
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
  QUnit.equal(this.player.currentTime(), 10, 'Player does not seek over gap before timer');
  this.clock.tick(10000);
  QUnit.equal(this.player.currentTime(), 20, 'Player seeked over gap after timer');
  this.player.buffered = tempBuffered;
  this.player.currentTime(0);
});

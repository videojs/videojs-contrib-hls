/* eslint-disable max-len */

import document from 'global/document';
import videojs from 'video.js';
import Events from 'video.js';
import QUnit from 'qunit';
import testDataManifests from './test-manifests.js';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse,
  absoluteUrl
} from './test-helpers.js';
/* eslint-disable no-unused-vars */
// we need this so that it can register hls with videojs
import {HlsSourceHandler, HlsHandler, Hls} from '../src/videojs-contrib-hls';
import window from 'global/window';
// we need this so the plugin registers itself
import 'videojs-contrib-quality-levels';
/* eslint-enable no-unused-vars */

const Flash = videojs.getTech('Flash');
const ogHlsHandlerSetupQualityLevels = videojs.HlsHandler.prototype.setupQualityLevels_;
let nextId = 0;

// do a shallow copy of the properties of source onto the target object
const merge = function(target, source) {
  let name;

  for (name in source) {
    target[name] = source[name];
  }
};

QUnit.module('HLS', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
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

    // save and restore browser detection for the Firefox-specific tests
    this.old.browser = videojs.browser;
    videojs.browser = videojs.mergeOptions({}, videojs.browser);

    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleUpdateEnd_
      this.clock.tick(1);
    };

    // setup a player
    this.player = createPlayer();
    this.clock.tick(1);
  },

  afterEach() {
    this.env.restore();
    this.mse.restore();

    merge(videojs.options, this.old.GlobalOptions);
    Flash.isSupported = this.old.FlashSupported;
    merge(Flash, this.old.Flash);

    videojs.Hls.supportsNativeHls = this.old.NativeHlsSupport;
    videojs.Hls.Decrypter = this.old.Decrypt;
    videojs.browser = this.old.browser;

    this.player.dispose();
  }
});

QUnit.test('deprecation warning is show when using player.hls', function(assert) {
  let oldWarn = videojs.log.warn;
  let warning = '';
  let hlsPlayerAccessEvents = 0;

  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-player-access') {
      hlsPlayerAccessEvents++;
    }
  });

  videojs.log.warn = (text) => {
    warning = text;
  };
  assert.equal(hlsPlayerAccessEvents, 0, 'no hls-player-access event was fired');
  let hls = this.player.hls;

  assert.equal(hlsPlayerAccessEvents, 1, 'an hls-player-access event was fired');
  assert.equal(warning, 'player.hls is deprecated. Use player.tech_.hls instead.', 'warning would have been shown');
  assert.ok(hls, 'an instance of hls is returned by player.hls');
  videojs.log.warn = oldWarn;
});

QUnit.test('starts playing if autoplay is specified', function(assert) {
  this.player.autoplay(true);
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  // make sure play() is called *after* the media source opens
  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);
  assert.ok(!this.player.paused(), 'not paused');
});

QUnit.test('stats are reset on each new source', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  // make sure play() is called *after* the media source opens
  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests.shift());
  this.standardXHRResponse(this.requests.shift());

  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 1024, 'stat is set');
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 0, 'stat is reset');
});

QUnit.test('XHR requests first byte range on play', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.trigger('play');
  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);
  assert.equal(this.requests[1].headers.Range, 'bytes=0-522827');
});

QUnit.test('Seeking requests correct byte range', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.trigger('play');
  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);
  this.clock.tick(1);
  this.player.currentTime(41);
  this.clock.tick(2);
  assert.equal(this.requests[2].headers.Range, 'bytes=2299992-2835603');
});

QUnit.test('autoplay seeks to the live point after playlist load', function(assert) {
  let currentTime = 0;

  this.player.autoplay(true);
  this.player.on('seeking', () => {
    currentTime = this.player.currentTime();
  });
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  assert.notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test('autoplay seeks to the live point after media source open', function(assert) {
  let currentTime = 0;

  this.player.autoplay(true);
  this.player.on('seeking', () => {
    currentTime = this.player.currentTime();
  });
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  assert.notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test('autoplay seeks to the live point after tech fires loadedmetadata in ie11',
function(assert) {
  videojs.browser.IE_VERSION = 11;
  let currentTime = 0;

  this.player.autoplay(true);
  this.player.on('seeking', () => {
    currentTime = this.player.currentTime();
  });
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  assert.equal(currentTime, 0, 'have not played yet');

  this.player.tech_.trigger('loadedmetadata');
  this.clock.tick(1);

  assert.notEqual(currentTime, 0, 'seeked after tech is ready');
});

QUnit.test('duration is set when the source opens after the playlist is loaded',
function(assert) {
  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);

  assert.equal(this.player.tech_.hls.mediaSource.duration,
               40,
               'set the duration');
});

QUnit.test('codecs are passed to the source buffer', function(assert) {
  let codecs = [];

  this.player.src({
    src: 'custom-codecs.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  let addSourceBuffer = this.player.tech_.hls.mediaSource.addSourceBuffer;

  this.player.tech_.hls.mediaSource.addSourceBuffer = function(codec) {
    codecs.push(codec);
    return addSourceBuffer.call(this, codec);
  };

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:CODECS="avc1.dd00dd, mp4a.40.f"\n' +
                                'media.m3u8\n');
  this.standardXHRResponse(this.requests.shift());
  assert.equal(codecs.length, 1, 'created a source buffer');
  assert.equal(codecs[0], 'video/mp2t; codecs="avc1.dd00dd, mp4a.40.f"', 'specified the codecs');
});

QUnit.test('including HLS as a tech does not error', function(assert) {
  let player = createPlayer({
    techOrder: ['hls', 'html5']
  });

  this.clock.tick(1);

  assert.ok(player, 'created the player');
  assert.equal(this.env.log.warn.calls, 2, 'logged two warnings for deprecations');
});

QUnit.test('creates a PlaylistLoader on init', function(assert) {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  assert.equal(this.requests[0].aborted, true, 'aborted previous src');
  this.standardXHRResponse(this.requests[1]);
  assert.ok(this.player.tech_.hls.playlists.master,
           'set the master playlist');
  assert.ok(this.player.tech_.hls.playlists.media(),
           'set the media playlist');
  assert.ok(this.player.tech_.hls.playlists.media().segments,
           'the segment entries are parsed');
  assert.strictEqual(this.player.tech_.hls.playlists.master.playlists[0],
                     this.player.tech_.hls.playlists.media(),
                     'the playlist is selected');
});

QUnit.test('sets the duration if one is available on the playlist', function(assert) {
  let events = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.on('durationchange', function() {
    events++;
  });

  this.standardXHRResponse(this.requests[0]);
  assert.equal(this.player.tech_.hls.mediaSource.duration,
               40,
               'set the duration');
  assert.equal(events, 1, 'durationchange is fired');
});

QUnit.test('estimates individual segment durations if needed', function(assert) {
  let changes = 0;

  this.player.src({
    src: 'http://example.com/manifest/missingExtinf.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.mediaSource.duration = NaN;
  this.player.tech_.on('durationchange', function() {
    changes++;
  });

  this.standardXHRResponse(this.requests[0]);
  assert.strictEqual(this.player.tech_.hls.mediaSource.duration,
                    this.player.tech_.hls.playlists.media().segments.length * 10,
                    'duration is updated');
  assert.strictEqual(changes, 1, 'one durationchange fired');
});

QUnit.test('translates seekable by the starting time for live playlists', function(assert) {
  let seekable;

  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:15\n' +
                                '#EXT-X-TARGETDURATION:10\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXTINF:10,\n' +
                                '2.ts\n' +
                                '#EXTINF:10,\n' +
                                '3.ts\n');

  seekable = this.player.seekable();
  assert.equal(seekable.length, 1, 'one seekable range');
  assert.equal(seekable.start(0), 0, 'the earliest possible position is at zero');
  assert.equal(seekable.end(0), 10, 'end is relative to the start');
});

QUnit.test('starts downloading a segment on loadedmetadata', function(assert) {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);
  this.standardXHRResponse(this.requests[1]);
  assert.strictEqual(this.requests[1].url,
                     absoluteUrl('manifest/media-00001.ts'),
                     'the first segment is requested');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 request');
});

QUnit.test('re-initializes the handler for each source', function(assert) {
  let firstPlaylists;
  let secondPlaylists;
  let firstMSE;
  let secondMSE;
  let aborts = 0;
  let masterPlaylistController;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  firstPlaylists = this.player.tech_.hls.playlists;
  firstMSE = this.player.tech_.hls.mediaSource;
  this.standardXHRResponse(this.requests.shift());
  this.standardXHRResponse(this.requests.shift());
  masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;
  masterPlaylistController.mainSegmentLoader_.sourceUpdater_.sourceBuffer_.abort = () => {
    aborts++;
  };

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  secondPlaylists = this.player.tech_.hls.playlists;
  secondMSE = this.player.tech_.hls.mediaSource;

  assert.equal(1, aborts, 'aborted the old source buffer');
  assert.ok(this.requests[0].aborted, 'aborted the old segment request');
  assert.notStrictEqual(firstPlaylists,
                        secondPlaylists,
                        'the playlist object is not reused');
  assert.notStrictEqual(firstMSE, secondMSE, 'the media source object is not reused');
});

QUnit.test('triggers a media source error when an initial playlist request errors',
function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.pop().respond(500);

  assert.equal(this.player.tech_.hls.mediaSource.error_,
               'network',
               'a network error is triggered');
});

QUnit.test(
'triggers a player error when an initial playlist request errors and the media source ' +
'isn\'t open',
function(assert) {
  const done = assert.async();
  const origError = videojs.log.error;
  const errLogs = [];
  const endOfStreams = [];

  videojs.log.error = (log) => errLogs.push(log);

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.masterPlaylistController_.mediaSource.endOfStream = (type) => {
    endOfStreams.push(type);
    throw new Error();
  };

  this.player.on('error', () => {
    const error = this.player.error();

    assert.equal(endOfStreams.length, 1, 'one endOfStream called');
    assert.equal(endOfStreams[0], 'network', 'endOfStream called with network');

    assert.equal(error.code, 2, 'error has correct code');
    assert.equal(error.message,
                 'HLS playlist request error at URL: manifest/master.m3u8',
                 'error has correct message');
    assert.equal(errLogs.length, 1, 'logged an error');

    videojs.log.error = origError;

    assert.notOk(this.player.tech_.hls.mediaSource.error_, 'no media source error');

    done();
  });

  this.requests.pop().respond(500);
});

QUnit.test('downloads media playlists after loading the master', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 20e10;
  this.standardXHRResponse(this.requests[0]);
  this.standardXHRResponse(this.requests[1]);
  this.standardXHRResponse(this.requests[2]);

  assert.strictEqual(this.requests[0].url,
                     'manifest/master.m3u8',
                     'master playlist requested');
  assert.strictEqual(this.requests[1].url,
                     absoluteUrl('manifest/media2.m3u8'),
                     'media playlist requested');
  assert.strictEqual(this.requests[2].url,
                     absoluteUrl('manifest/media2-00001.ts'),
                     'first segment requested');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 request');
});

QUnit.test('setting bandwidth resets throughput', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.hls.throughput = 1000;
  assert.strictEqual(this.player.tech_.hls.throughput,
                     1000,
                     'throughput is set');
  this.player.tech_.hls.bandwidth = 20e10;
  assert.strictEqual(this.player.tech_.hls.throughput,
                     0,
                     'throughput is reset when bandwidth is specified');
});

QUnit.test('a thoughput of zero is ignored in systemBandwidth', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.hls.bandwidth = 20e10;
  assert.strictEqual(this.player.tech_.hls.throughput,
                    0,
                    'throughput is reset when bandwidth is specified');
  assert.strictEqual(this.player.tech_.hls.systemBandwidth,
                     20e10,
                     'systemBandwidth is the same as bandwidth');
});

QUnit.test('systemBandwidth is a combination of thoughput and bandwidth', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.hls.bandwidth = 20e10;
  this.player.tech_.hls.throughput = 20e10;
  // 1 / ( 1 / 20e10 + 1 / 20e10) = 10e10
  assert.strictEqual(this.player.tech_.hls.systemBandwidth,
                     10e10,
                     'systemBandwidth is the combination of bandwidth and throughput');
});

QUnit.test('upshifts if the initial bandwidth hint is high', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 10e20;
  this.standardXHRResponse(this.requests[0]);
  this.standardXHRResponse(this.requests[1]);
  this.standardXHRResponse(this.requests[2]);

  assert.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  assert.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/media2.m3u8'),
    'media playlist requested'
  );
  assert.strictEqual(
    this.requests[2].url,
    absoluteUrl('manifest/media2-00001.ts'),
    'first segment requested'
  );

  // verify stats
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 request');
});

QUnit.test('downshifts if the initial bandwidth hint is low', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 100;
  this.standardXHRResponse(this.requests[0]);
  this.standardXHRResponse(this.requests[1]);
  this.standardXHRResponse(this.requests[2]);

  assert.strictEqual(this.requests[0].url,
                     'manifest/master.m3u8',
                     'master playlist requested');
  assert.strictEqual(this.requests[1].url,
                     absoluteUrl('manifest/media1.m3u8'),
                     'media playlist requested');
  assert.strictEqual(this.requests[2].url,
                     absoluteUrl('manifest/media1-00001.ts'),
                     'first segment requested');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 request');
});

QUnit.test('buffer checks are noops until a media playlist is ready', function(assert) {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.clock.tick(10 * 1000);

  assert.strictEqual(1, this.requests.length, 'one request was made');
  assert.strictEqual(this.requests[0].url,
                    'manifest/media.m3u8',
                    'media playlist requested');
});

QUnit.test('buffer checks are noops when only the master is ready', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  // ignore any outstanding segment requests
  this.requests.length = 0;

  // load in a new playlist which will cause playlists.media() to be
  // undefined while it is being fetched
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  // respond with the master playlist but don't send the media playlist yet
  // force media1 to be requested
  this.player.tech_.hls.bandwidth = 1;
  // master
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(10 * 1000);

  assert.strictEqual(this.requests.length, 1, 'one request was made');
  assert.strictEqual(this.requests[0].url,
                     absoluteUrl('manifest/media1.m3u8'),
                     'media playlist requested');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth set above');
});

QUnit.test('selects a playlist below the current bandwidth', function(assert) {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);

  // the default playlist has a really high bitrate
  this.player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 9e10;
  // playlist 1 has a very low bitrate
  this.player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 1;
  // but the detected client bandwidth is really low
  this.player.tech_.hls.bandwidth = 10;

  playlist = this.player.tech_.hls.selectPlaylist();
  assert.strictEqual(playlist,
                     this.player.tech_.hls.playlists.master.playlists[1],
                     'the low bitrate stream is selected');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 10, 'bandwidth set above');
});

QUnit.test('selects a primary rendtion when there are multiple rendtions share same attributes', function(assert) {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests[0]);

  // covers playlists with same bandwidth but different resolution and different bandwidth but same resolution
  this.player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 528;
  this.player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 528;
  this.player.tech_.hls.playlists.master.playlists[2].attributes.BANDWIDTH = 728;
  this.player.tech_.hls.playlists.master.playlists[3].attributes.BANDWIDTH = 728;

  this.player.tech_.hls.bandwidth = 1000;

  playlist = this.player.tech_.hls.selectPlaylist();
  assert.strictEqual(playlist,
                     this.player.tech_.hls.playlists.master.playlists[2],
                     'select the rendition with largest bandwidth and just-larger-than video player');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1000, 'bandwidth set above');

  // covers playlists share same bandwidth and resolutions
  this.player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 728;
  this.player.tech_.hls.playlists.master.playlists[0].attributes.RESOLUTION.width = 960;
  this.player.tech_.hls.playlists.master.playlists[0].attributes.RESOLUTION.height = 540;
  this.player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 728;
  this.player.tech_.hls.playlists.master.playlists[2].attributes.BANDWIDTH = 728;
  this.player.tech_.hls.playlists.master.playlists[2].attributes.RESOLUTION.width = 960;
  this.player.tech_.hls.playlists.master.playlists[2].attributes.RESOLUTION.height = 540;
  this.player.tech_.hls.playlists.master.playlists[3].attributes.BANDWIDTH = 728;

  this.player.tech_.hls.bandwidth = 1000;

  playlist = this.player.tech_.hls.selectPlaylist();
  assert.strictEqual(playlist,
                     this.player.tech_.hls.playlists.master.playlists[0],
                     'the primary rendition is selected');
});

QUnit.test('allows initial bandwidth to be provided', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.bandwidth = 500;

  this.requests[0].bandwidth = 1;
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                                '#EXT-X-TARGETDURATION:10\n');
  assert.equal(this.player.tech_.hls.bandwidth,
               500,
               'prefers user-specified initial bandwidth');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 500, 'bandwidth set above');
});

QUnit.test('raises the minimum bitrate for a stream proportionially', function(assert) {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);

  // the default playlist's bandwidth + 10% is assert.equal to the current bandwidth
  this.player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 10;
  this.player.tech_.hls.bandwidth = 11;

  // 9.9 * 1.1 < 11
  this.player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 9.9;
  playlist = this.player.tech_.hls.selectPlaylist();

  assert.strictEqual(playlist,
                     this.player.tech_.hls.playlists.master.playlists[1],
                     'a lower bitrate stream is selected');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 11, 'bandwidth set above');
});

QUnit.test('uses the lowest bitrate if no other is suitable', function(assert) {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);

  // the lowest bitrate playlist is much greater than 1b/s
  this.player.tech_.hls.bandwidth = 1;
  playlist = this.player.tech_.hls.selectPlaylist();

  // playlist 1 has the lowest advertised bitrate
  assert.strictEqual(playlist,
                     this.player.tech_.hls.playlists.master.playlists[1],
                     'the lowest bitrate stream is selected');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth set above');
});

QUnit.test('selects the correct rendition by tech dimensions', function(assert) {
  let playlist;
  let hls;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);

  hls = this.player.tech_.hls;

  this.player.width(640);
  this.player.height(360);
  hls.bandwidth = 3000000;

  playlist = hls.selectPlaylist();

  assert.deepEqual(playlist.attributes.RESOLUTION,
                  {width: 960, height: 540},
                  'should return the correct resolution by tech dimensions');
  assert.equal(playlist.attributes.BANDWIDTH,
              1928000,
              'should have the expected bandwidth in case of multiple');

  this.player.width(1920);
  this.player.height(1080);
  hls.bandwidth = 3000000;

  playlist = hls.selectPlaylist();

  assert.deepEqual(playlist.attributes.RESOLUTION,
                   {width: 960, height: 540},
                   'should return the correct resolution by tech dimensions');
  assert.equal(playlist.attributes.BANDWIDTH,
              1928000,
              'should have the expected bandwidth in case of multiple');

  this.player.width(396);
  this.player.height(224);
  playlist = hls.selectPlaylist();

  assert.deepEqual(playlist.attributes.RESOLUTION,
                   {width: 396, height: 224},
                   'should return the correct resolution by ' +
                   'tech dimensions, if exact match');
  assert.equal(playlist.attributes.BANDWIDTH,
               440000,
               'should have the expected bandwidth in case of multiple, if exact match');

  this.player.width(395);
  this.player.height(222);
  playlist = this.player.tech_.hls.selectPlaylist();

  assert.deepEqual(playlist.attributes.RESOLUTION,
                   {width: 396, height: 224},
                   'should return the next larger resolution by tech dimensions, ' +
                   'if no exact match exists');
  assert.equal(playlist.attributes.BANDWIDTH,
               440000,
               'should have the expected bandwidth in case of multiple, if exact match');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 3000000, 'bandwidth set above');
});

QUnit.test('selects the highest bitrate playlist when the player dimensions are ' +
     'larger than any of the variants', function(assert) {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=2x1\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x1\n' +
                                'media1.m3u8\n');
  // media
  this.standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.bandwidth = 1e10;

  this.player.width(1024);
  this.player.height(768);

  playlist = this.player.tech_.hls.selectPlaylist();

  assert.equal(playlist.attributes.BANDWIDTH,
               1000,
               'selected the highest bandwidth variant');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1e10, 'bandwidth set above');
});

QUnit.test('filters playlists that are currently excluded', function(assert) {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e10;
  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                                'media1.m3u8\n');
  // media
  this.standardXHRResponse(this.requests.shift());

  // exclude the current playlist
  this.player.tech_.hls.playlists.master.playlists[0].excludeUntil = +new Date() + 1000;
  playlist = this.player.tech_.hls.selectPlaylist();
  assert.equal(playlist,
               this.player.tech_.hls.playlists.master.playlists[1],
               'respected exclusions');

  // timeout the exclusion
  this.clock.tick(1000);
  playlist = this.player.tech_.hls.selectPlaylist();
  assert.equal(playlist,
               this.player.tech_.hls.playlists.master.playlists[0],
               'expired the exclusion');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1e10, 'bandwidth set above');
});

QUnit.test('does not blacklist compatible H.264 codec strings', function(assert) {
  let master;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400f,mp4a.40.5"\n' +
             'media1.m3u8\n');

  // media
  this.standardXHRResponse(this.requests.shift());
  master = this.player.tech_.hls.playlists.master;
  assert.strictEqual(typeof master.playlists[0].excludeUntil,
                     'undefined',
                     'did not blacklist');
  assert.strictEqual(typeof master.playlists[1].excludeUntil,
                     'undefined',
                     'did not blacklist');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth set above');
});

QUnit.test('does not blacklist compatible AAC codec strings', function(assert) {
  let master;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,not-an-audio-codec"\n' +
             'media1.m3u8\n');

  // media
  this.standardXHRResponse(this.requests.shift());
  master = this.player.tech_.hls.playlists.master;
  assert.strictEqual(typeof master.playlists[0].excludeUntil,
                     'undefined',
                     'did not blacklist mp4a.40.2');
  assert.strictEqual(master.playlists[1].excludeUntil,
                     Infinity,
                     'blacklisted invalid audio codec');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth set above');
});

QUnit.test('cancels outstanding XHRs when seeking', function(assert) {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests[0]);
  this.player.tech_.hls.media = {
    segments: [{
      uri: '0.ts',
      duration: 10
    }, {
      uri: '1.ts',
      duration: 10
    }]
  };

  // attempt to seek while the download is in progress
  this.player.currentTime(7);
  this.clock.tick(2);

  assert.ok(this.requests[1].aborted, 'XHR aborted');
  assert.strictEqual(this.requests.length, 3, 'opened new XHR');
});

QUnit.test('does not abort segment loading for in-buffer seeking', function(assert) {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests.shift());
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };

  this.player.tech_.setCurrentTime(11);
  this.clock.tick(1);
  assert.equal(this.requests.length, 1, 'did not abort the outstanding request');
});

QUnit.test('segment 404 should trigger blacklisting of media', function(assert) {
  let media;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 20000;
  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);

  media = this.player.tech_.hls.playlists.media_;

  // segment
  this.requests[2].respond(400);
  assert.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 20000, 'bandwidth set above');
});

QUnit.test('playlist 404 should blacklist media', function(assert) {
  let media;
  let url;
  let blacklistplaylist = 0;
  let retryplaylist = 0;
  let hlsRenditionBlacklistedEvents = 0;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.on('blacklistplaylist', () => blacklistplaylist++);
  this.player.tech_.on('retryplaylist', () => retryplaylist++);
  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-rendition-blacklisted') {
      hlsRenditionBlacklistedEvents++;
    }
  });

  this.player.tech_.hls.bandwidth = 1e10;
  // master
  this.requests[0].respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'media1.m3u8\n');
  assert.equal(typeof this.player.tech_.hls.playlists.media_,
              'undefined',
              'no media is initially set');

  assert.equal(blacklistplaylist, 0, 'there is no blacklisted playlist');
  assert.equal(hlsRenditionBlacklistedEvents, 0, 'no hls-rendition-blacklisted event was fired');
  // media
  this.requests[1].respond(404);
  url = this.requests[1].url.slice(this.requests[1].url.lastIndexOf('/') + 1);
  media = this.player.tech_.hls.playlists.master.playlists[url];
  assert.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(this.env.log.warn.args[0],
              'Problem encountered with the current HLS playlist. HLS playlist request error at URL: media.m3u8 Switching to another playlist.',
              'log generic error message');
  assert.equal(blacklistplaylist, 1, 'there is one blacklisted playlist');
  assert.equal(hlsRenditionBlacklistedEvents, 1, 'an hls-rendition-blacklisted event was fired');
  assert.equal(retryplaylist, 0, 'haven\'t retried any playlist');

  // request for the final available media
  this.requests[2].respond(404);
  url = this.requests[2].url.slice(this.requests[2].url.lastIndexOf('/') + 1);
  media = this.player.tech_.hls.playlists.master.playlists[url];

  // media wasn't blacklisted because it's final rendition
  assert.ok(!media.excludeUntil, 'media not blacklisted after playlist 404');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(this.env.log.warn.args[1],
              'Problem encountered with the current HLS playlist. Trying again since it is the final playlist.',
              'log specific error message for final playlist');
  assert.equal(retryplaylist, 1, 'retried final playlist for once');
  assert.equal(blacklistplaylist, 1, 'there is one blacklisted playlist');
  assert.equal(hlsRenditionBlacklistedEvents, 1, 'an hls-rendition-blacklisted event was fired');

  this.clock.tick(2 * 1000);
  // no new request was made since it hasn't been half the segment duration
  assert.strictEqual(3, this.requests.length, 'no new request was made');

  this.clock.tick(3 * 1000);
  // continue loading the final remaining playlist after it wasn't blacklisted
  // when half the segment duaration passed
  assert.strictEqual(4, this.requests.length, 'one more request was made');

  assert.strictEqual(this.requests[3].url,
                     absoluteUrl('manifest/media1.m3u8'),
                     'media playlist requested');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1e10, 'bandwidth set above');
});

QUnit.test('blacklists playlist if it has stopped being updated', function(assert) {
  let playliststuck = 0;

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.triggerReady();

  this.standardXHRResponse(this.requests.shift());

  this.player.tech_.hls.masterPlaylistController_.seekable = function() {
    return videojs.createTimeRange(90, 130);
  };
  this.player.tech_.setCurrentTime(170);
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 170);
  };
  Hls.Playlist.playlistEnd = function() {
    return 170;
  };

  this.player.tech_.on('playliststuck', () => playliststuck++);
  this.requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:16\n' +
                           '#EXTINF:10,\n' +
                           '16.ts\n');

  assert.ok(!this.player.tech_.hls.playlists.media().excludeUntil, 'playlist was not blacklisted');
  assert.equal(this.env.log.warn.calls, 0, 'no warning logged for blacklist');
  assert.equal(playliststuck, 0, 'there is no stuck playlist');

  this.player.tech_.trigger('play');
  this.player.tech_.trigger('playing');
  // trigger a refresh
  this.clock.tick(10 * 1000);

  this.requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:16\n' +
                           '#EXTINF:10,\n' +
                           '16.ts\n');

  assert.ok(this.player.tech_.hls.playlists.media().excludeUntil > 0, 'playlist blacklisted for some time');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(this.env.log.warn.args[0],
              'Problem encountered with the current HLS playlist. Playlist no longer updating. Switching to another playlist.',
              'log specific error message for not updated playlist');
  assert.equal(playliststuck, 1, 'there is one stuck playlist');
});

QUnit.test('never blacklist the playlist if it is the only playlist', function(assert) {
  let media;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n');

  this.clock.tick(10 * 1000);
  this.requests.shift().respond(404);
  media = this.player.tech_.hls.playlists.media();

  // media wasn't blacklisted because it's final rendition
  assert.ok(!media.excludeUntil, 'media was not blacklisted after playlist 404');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(this.env.log.warn.args[0],
              'Problem encountered with the current HLS playlist. Trying again since it is the final playlist.',
              'log specific error message for final playlist');
});

QUnit.test('error on the first playlist request does not trigger an error ' +
           'when there is master playlist with only one media playlist', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.requests[0]
    .respond(200, null,
              '#EXTM3U\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
              'media.m3u8\n');

  this.requests[1].respond(404);

  let url = this.requests[1].url.slice(this.requests[1].url.lastIndexOf('/') + 1);
  let media = this.player.tech_.hls.playlists.master.playlists[url];

  // media wasn't blacklisted because it's final rendition
  assert.ok(!media.excludeUntil, 'media was not blacklisted after playlist 404');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(this.env.log.warn.args[0],
              'Problem encountered with the current HLS playlist. Trying again since it is the final playlist.',
              'log specific error message for final playlist');
});

QUnit.test('seeking in an empty playlist is a non-erroring noop', function(assert) {
  let requestsLength;

  this.player.src({
    src: 'manifest/empty-live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(200, null, '#EXTM3U\n');

  requestsLength = this.requests.length;
  this.player.tech_.setCurrentTime(183);
  this.clock.tick(1);

  assert.equal(this.requests.length, requestsLength, 'made no additional requests');
});

QUnit.test('fire loadedmetadata once we successfully load a playlist', function(assert) {
  let count = 0;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  let hls = this.player.tech_.hls;

  hls.bandwidth = 20000;
  hls.masterPlaylistController_.masterPlaylistLoader_.on('loadedmetadata', function() {
    count += 1;
  });
  // master
  this.standardXHRResponse(this.requests.shift());
  assert.equal(count, 0,
    'loadedMedia not triggered before requesting playlist');
  // media
  this.requests.shift().respond(404);
  assert.equal(count, 0,
    'loadedMedia not triggered after playlist 404');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');

  // media
  this.standardXHRResponse(this.requests.shift());
  assert.equal(count, 1,
    'loadedMedia triggered after successful recovery from 404');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 20000, 'bandwidth set above');
});

QUnit.test('sets seekable and duration for live playlists', function(assert) {
  this.player.src({
    src: 'http://example.com/manifest/missingEndlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);

  assert.equal(this.player.tech_.hls.mediaSource.seekable.length,
               1,
               'set one seekable range');
  assert.equal(this.player.tech_.hls.mediaSource.seekable.start(0),
               this.player.tech_.hls.seekable().start(0),
               'set seekable start');
  assert.equal(this.player.tech_.hls.mediaSource.seekable.end(0),
               this.player.tech_.hls.seekable().end(0),
               'set seekable end');

  assert.strictEqual(this.player.tech_.hls.mediaSource.duration,
                     Infinity,
                     'duration on the mediaSource is infinity');
});

QUnit.test('live playlist starts with correct currentTime value', function(assert) {
  this.player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests[0]);

  this.player.tech_.hls.playlists.trigger('loadedmetadata');

  this.player.tech_.paused = function() {
    return false;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  let media = this.player.tech_.hls.playlists.media();

  assert.strictEqual(this.player.currentTime(),
                    Hls.Playlist.seekable(media).end(0),
                    'currentTime is updated at playback');
});

QUnit.test('estimates seekable ranges for live streams that have been paused for a long time', function(assert) {
  this.player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.playlists.media().mediaSequence = 172;
  this.player.tech_.hls.playlists.media().syncInfo = {
    mediaSequence: 130,
    time: 80
  };
  this.player.tech_.hls.masterPlaylistController_.onSyncInfoUpdate_();
  assert.equal(this.player.seekable().start(0),
               500,
               'offset the seekable start');
});

QUnit.test('resets the time to the live point when resuming a live stream after a ' +
           'long break', function(assert) {
  let seekTarget;

  this.player.src({
    src: 'live0.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:16\n' +
                                '#EXTINF:10,\n' +
                                '16.ts\n');
  // mock out the player to simulate a live stream that has been
  // playing for awhile
  this.player.tech_.hls.seekable = function() {
    return videojs.createTimeRange(160, 170);
  };
  this.player.tech_.setCurrentTime = function(time) {
    if (typeof time !== 'undefined') {
      seekTarget = time;
    }
  };
  this.player.tech_.played = function() {
    return videojs.createTimeRange(120, 170);
  };
  this.player.tech_.trigger('playing');

  let seekable = this.player.seekable();

  this.player.tech_.trigger('play');
  assert.equal(seekTarget, seekable.end(seekable.length - 1), 'seeked to live point');
  this.player.tech_.trigger('seeked');
});

QUnit.test('reloads out-of-date live playlists when switching variants', function(assert) {
  let oldManifest = testDataManifests['variant-update'];

  this.player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.master = {
    playlists: [{
      mediaSequence: 15,
      segments: [1, 1, 1]
    }, {
      uri: 'http://example.com/variant-update.m3u8',
      mediaSequence: 0,
      segments: [1, 1]
    }]
  };
  // playing segment 15 on playlist zero
  this.player.tech_.hls.media = this.player.tech_.hls.master.playlists[0];
  this.player.mediaIndex = 1;

  testDataManifests['variant-update'] = '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:16\n' +
    '#EXTINF:10,\n' +
    '16.ts\n' +
    '#EXTINF:10,\n' +
    '17.ts\n';

  // switch playlists
  this.player.tech_.hls.selectPlaylist = function() {
    return this.player.tech_.hls.master.playlists[1];
  };
  // timeupdate downloads segment 16 then switches playlists
  this.player.trigger('timeupdate');

  assert.strictEqual(this.player.mediaIndex, 1, 'mediaIndex points at the next segment');
  testDataManifests['variant-update'] = oldManifest;
});

QUnit.test('if withCredentials global option is used, withCredentials is set on the XHR object', function(assert) {
  let hlsOptions = videojs.options.hls;

  this.player.dispose();
  videojs.options.hls = {
    withCredentials: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  assert.ok(this.requests[0].withCredentials,
           'with credentials should be set to true if that option is passed in');
  videojs.options.hls = hlsOptions;
});

QUnit.test('the withCredentials option overrides the global default', function(assert) {
  let hlsOptions = videojs.options.hls;

  this.player.dispose();
  videojs.options.hls = {
    withCredentials: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: false
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  assert.ok(!this.requests[0].withCredentials,
           'with credentials should be set to false if if overrode global option');
  videojs.options.hls = hlsOptions;
});

QUnit.test('if handleManifestRedirects global option is used, it should be passed to PlaylistLoader', function(assert) {
  let hlsOptions = videojs.options.hls;

  this.player.dispose();
  videojs.options.hls = {
    handleManifestRedirects: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.ok(this.player.tech_.hls.masterPlaylistController_.masterPlaylistLoader_.handleManifestRedirects);

  videojs.options.hls = hlsOptions;
});

QUnit.test('the handleManifestRedirects option overrides the global default', function(assert) {
  let hlsOptions = videojs.options.hls;

  this.player.dispose();
  videojs.options.hls = {
    handleManifestRedirects: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    handleManifestRedirects: false
  });

  this.clock.tick(1);

  assert.notOk(this.player.tech_.hls.masterPlaylistController_.masterPlaylistLoader_.handleManifestRedirects);

  videojs.options.hls = hlsOptions;
});

QUnit.test('playlist blacklisting duration is set through options', function(assert) {
  let hlsOptions = videojs.options.hls;
  let url;
  let media;

  this.player.dispose();
  videojs.options.hls = {
    blacklistDuration: 3 * 60
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  openMediaSource(this.player, this.clock);
  this.requests[0].respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'media1.m3u8\n');
  this.requests[1].respond(404);
  // media
  url = this.requests[1].url.slice(this.requests[1].url.lastIndexOf('/') + 1);
  media = this.player.tech_.hls.playlists.master.playlists[url];
  assert.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
  assert.equal(this.env.log.warn.calls, 1, 'warning logged for blacklist');
  assert.equal(this.env.log.warn.args[0],
              'Problem encountered with the current HLS playlist. HLS playlist request error at URL: media.m3u8 Switching to another playlist.',
              'log generic error message');

  this.clock.tick(2 * 60 * 1000);
  assert.ok(media.excludeUntil - Date.now() > 0, 'original media still be blacklisted');

  this.clock.tick(1 * 60 * 1000);
  assert.equal(media.excludeUntil, Date.now(), 'media\'s exclude time reach to the current time');
  assert.equal(this.env.log.warn.calls, 3, 'warning logged for blacklist');

  videojs.options.hls = hlsOptions;
});

QUnit.test('if mode global option is used, mode is set to global option', function(assert) {
  let hlsOptions = videojs.options.hls;

  this.player.dispose();
  videojs.options.hls = {
    mode: 'flash'
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  assert.equal(this.player.tech_.hls.options_.mode, 'flash', 'mode set to flash');
  videojs.options.hls = hlsOptions;
});

QUnit.test('respects bandwidth option of 0', function(assert) {
  this.player.dispose();
  this.player = createPlayer({ html5: { hls: { bandwidth: 0 } } });

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  assert.equal(this.player.tech_.hls.bandwidth, 0, 'set bandwidth to 0');
});

QUnit.test('uses default bandwidth option if non-numerical value provided', function(assert) {
  this.player.dispose();
  this.player = createPlayer({ html5: { hls: { bandwidth: 'garbage' } } });

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  assert.equal(this.player.tech_.hls.bandwidth, 4194304, 'set bandwidth to default');
});

QUnit.test('uses default bandwidth if browser is Android', function(assert) {
  this.player.dispose();

  const origIsAndroid = videojs.browser.IS_ANDROID;

  videojs.browser.IS_ANDROID = false;

  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  assert.equal(this.player.tech_.hls.bandwidth,
               4194304,
               'set bandwidth to desktop default');

  this.player.dispose();

  videojs.browser.IS_ANDROID = true;

  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  assert.equal(this.player.tech_.hls.bandwidth,
               4194304,
               'set bandwidth to mobile default');

  videojs.browser.IS_ANDROID = origIsAndroid;
});

QUnit.test('does not break if the playlist has no segments', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  try {
    openMediaSource(this.player, this.clock);
    this.requests[0].respond(200, null,
                        '#EXTM3U\n' +
                        '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                        '#EXT-X-TARGETDURATION:10\n');
  } catch (e) {
    assert.ok(false, 'an error was thrown');
    throw e;
  }
  assert.ok(true, 'no error was thrown');
  assert.strictEqual(
    this.requests.length,
    1,
    'no this.requestsfor non-existent segments were queued'
  );
});

QUnit.test('can seek before the source buffer opens', function(assert) {
  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.standardXHRResponse(this.requests.shift());
  this.player.triggerReady();

  this.player.currentTime(1);
  assert.equal(this.player.currentTime(), 1, 'seeked');
});

QUnit.test('resets the switching algorithm if a request times out', function(assert) {
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.bandwidth = 1e20;

  // master
  this.standardXHRResponse(this.requests.shift());
  // media.m3u8
  this.standardXHRResponse(this.requests.shift());
  // simulate a segment timeout
  this.requests[0].timedout = true;
  // segment
  this.requests.shift().abort();

  this.standardXHRResponse(this.requests.shift());

  assert.strictEqual(this.player.tech_.hls.playlists.media(),
                     this.player.tech_.hls.playlists.master.playlists[1],
                     'reset to the lowest bitrate playlist');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth is reset too');
});

QUnit.test('disposes the playlist loader', function(assert) {
  let disposes = 0;
  let player;
  let loaderDispose;

  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(player, this.clock);
  loaderDispose = player.tech_.hls.playlists.dispose;
  player.tech_.hls.playlists.dispose = function() {
    disposes++;
    loaderDispose.call(player.tech_.hls.playlists);
  };

  player.dispose();
  assert.strictEqual(disposes, 1, 'disposed playlist loader');
});

QUnit.test('remove event handlers on dispose', function(assert) {
  let player;
  let unscoped = 0;

  player = createPlayer();

  const origPlayerOn = player.on.bind(player);
  const origPlayerOff = player.off.bind(player);

  player.on = function(...args) {
    if (typeof args[0] !== 'object') {
      unscoped++;
    }
    origPlayerOn(...args);
  };
  player.off = function(...args) {
    if (typeof args[0] !== 'object') {
      unscoped--;
    }
    origPlayerOff(...args);
  };
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(player, this.clock);

  this.standardXHRResponse(this.requests[0]);
  this.standardXHRResponse(this.requests[1]);

  assert.ok(unscoped > 0, 'has unscoped handlers');

  player.dispose();

  assert.ok(unscoped <= 0, 'no unscoped handlers');
});

QUnit.test('the source handler supports HLS mime types', function(assert) {
  const techs = ['html5', 'flash'];

  techs.forEach(function(techName) {
    assert.ok(HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/x-MPegUrl'
    }), 'supports x-mpegurl');
    assert.ok(HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/VnD.aPPle.MpEgUrL'
    }), 'supports vnd.apple.mpegurl');
    assert.ok(HlsSourceHandler(techName).canPlayType('aPplicatiOn/VnD.aPPle.MpEgUrL'),
             'supports vnd.apple.mpegurl');
    assert.ok(HlsSourceHandler(techName).canPlayType('aPplicatiOn/x-MPegUrl'),
             'supports x-mpegurl');

    assert.ok(!(HlsSourceHandler(techName).canHandleSource({
      type: 'video/mp4'
    }) instanceof HlsHandler), 'does not support mp4');
    assert.ok(!(HlsSourceHandler(techName).canHandleSource({
      type: 'video/x-flv'
    }) instanceof HlsHandler), 'does not support flv');
    assert.ok(!(HlsSourceHandler(techName).canPlayType('video/mp4')),
             'does not support mp4');
    assert.ok(!(HlsSourceHandler(techName).canPlayType('video/x-flv')),
             'does not support flv');
  });
});

QUnit.test('source handler does not support sources when IE 10 or below', function(assert) {
  videojs.browser.IE_VERSION = 10;

  ['html5', 'flash'].forEach(function(techName) {
    assert.ok(!HlsSourceHandler(techName).canHandleSource({
      type: 'application/x-mpegURL'
    }), 'does not support when browser is IE10');
  });
});

QUnit.test('fires loadstart manually if Flash is used', function(assert) {
  videojs.HlsHandler.prototype.setupQualityLevels_ = () => {};
  let tech = new (videojs.getTech('Flash'))({});
  let loadstarts = 0;

  tech.on('loadstart', function() {
    loadstarts++;
  });
  HlsSourceHandler('flash').handleSource({
    src: 'movie.m3u8',
    type: 'application/x-mpegURL'
  }, tech);

  assert.equal(loadstarts, 0, 'loadstart is not synchronous');
  this.clock.tick(1);
  assert.equal(loadstarts, 1, 'fired loadstart');
  tech.dispose();
  videojs.HlsHandler.prototype.setupQualityLevels_ = ogHlsHandlerSetupQualityLevels;
});

QUnit.test('has no effect if native HLS is available', function(assert) {
  const Html5 = videojs.getTech('Html5');
  const oldHtml5CanPlaySource = Html5.canPlaySource;
  let player;

  Html5.canPlaySource = () => true;
  Hls.supportsNativeHls = true;
  player = createPlayer();
  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  this.clock.tick(1);

  assert.ok(!player.tech_.hls, 'did not load hls tech');
  player.dispose();
  Html5.canPlaySource = oldHtml5CanPlaySource;
});

QUnit.test('loads if native HLS is available and override is set locally', function(assert) {
  let player;

  Hls.supportsNativeHls = true;
  player = createPlayer({html5: {hls: {overrideNative: true}}});
  this.clock.tick(1);
  player.tech_.featuresNativeVideoTracks = true;
  assert.throws(function() {
    player.src({
      src: 'http://example.com/manifest/master.m3u8',
      type: 'application/x-mpegURL'
    });
    this.clock.tick(1);
  }, 'errors if native tracks are enabled');
  player.dispose();

  player = createPlayer({html5: {hls: {overrideNative: true}}});
  this.clock.tick(1);
  player.tech_.featuresNativeVideoTracks = false;
  player.tech_.featuresNativeAudioTracks = false;
  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });
  this.clock.tick(1);

  assert.ok(player.tech_.hls, 'did load hls tech');
  player.dispose();
});

QUnit.test('loads if native HLS is available and override is set globally', function(assert) {
  videojs.options.hls.overrideNative = true;
  let player;

  Hls.supportsNativeHls = true;
  player = createPlayer();
  player.tech_.featuresNativeVideoTracks = true;
  assert.throws(function() {
    player.src({
      src: 'http://example.com/manifest/master.m3u8',
      type: 'application/x-mpegURL'
    });
    this.clock.tick(1);
  }, 'errors if native tracks are enabled');
  player.dispose();

  player = createPlayer();
  player.tech_.featuresNativeVideoTracks = false;
  player.tech_.featuresNativeAudioTracks = false;
  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  this.clock.tick(1);

  assert.ok(player.tech_.hls, 'did load hls tech');
  player.dispose();
});

QUnit.test('re-emits mediachange events', function(assert) {
  let mediaChanges = 0;

  this.player.on('mediachange', function() {
    mediaChanges++;
  });

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.standardXHRResponse(this.requests.shift());

  this.player.tech_.hls.playlists.trigger('mediachange');
  assert.strictEqual(mediaChanges, 1, 'fired mediachange');
});

QUnit.test('can be disposed before finishing initialization', function(assert) {
  let readyHandlers = [];

  this.player.ready = function(callback) {
    readyHandlers.push(callback);
  };
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);
  readyHandlers.shift().call(this.player);

  this.player.src({
    src: 'http://example.com/media.mp4',
    type: 'video/mp4'
  });

  assert.ok(readyHandlers.length > 0, 'registered a ready handler');
  try {
    while (readyHandlers.length) {
      readyHandlers.shift().call(this.player);
      openMediaSource(this.player, this.clock);
    }
    assert.ok(true, 'did not throw an exception');
  } catch (e) {
    assert.ok(false, 'threw an exception');
  }
});

QUnit.test('calling play() at the end of a video replays', function(assert) {
  let seekTime = -1;

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.setCurrentTime = function(time) {
    if (typeof time !== 'undefined') {
      seekTime = time;
    }
    return 0;
  };
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXT-X-ENDLIST\n');
  this.clock.tick(1);

  this.standardXHRResponse(this.requests.shift());
  this.player.tech_.ended = function() {
    return true;
  };

  this.player.tech_.trigger('play');
  this.clock.tick(1);
  assert.equal(seekTime, 0, 'seeked to the beginning');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 request');
});

QUnit.test('keys are resolved relative to the master playlist', function(assert) {
  this.player.src({
    src: 'video/master-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
                                'playlist/playlist.m3u8\n' +
                                '#EXT-X-ENDLIST\n');
  this.clock.tick(1);

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:2.833,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-ENDLIST\n');
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'requested the key');
  assert.equal(this.requests[0].url,
               absoluteUrl('video/playlist/keys/key.php'),
               'resolves multiple relative paths');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default');
});

QUnit.test('keys are resolved relative to their containing playlist', function(assert) {
  this.player.src({
    src: 'video/media-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:2.833,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-ENDLIST\n');
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'requested a key');
  assert.equal(this.requests[0].url,
               absoluteUrl('video/keys/key.php'),
               'resolves multiple relative paths');
});

QUnit.test('seeking should abort an outstanding key request and create a new one', function(assert) {
  this.player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:9,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key2.php"\n' +
                                '#EXTINF:9,\n' +
                                'http://media.example.com/fileSequence2.ts\n' +
                                '#EXT-X-ENDLIST\n');
  this.clock.tick(1);

  // segment 1
  this.standardXHRResponse(this.requests.pop());

  this.player.currentTime(11);
  this.clock.tick(2);
  assert.ok(this.requests[0].aborted, 'the key XHR should be aborted');
  // aborted key 1
  this.requests.shift();

  assert.equal(this.requests.length, 2, 'requested the new key');
  assert.equal(this.requests[0].url,
               'https://example.com/' +
               this.player.tech_.hls.playlists.media().segments[1].key.uri,
               'urls should match');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 request');
});

QUnit.test('switching playlists with an outstanding key request aborts request and ' +
           'loads segment', function(assert) {
  let keyXhr;
  let media = '#EXTM3U\n' +
      '#EXT-X-MEDIA-SEQUENCE:5\n' +
      '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
      '#EXTINF:2.833,\n' +
      'http://media.example.com/fileSequence52-A.ts\n' +
      '#EXTINF:15.0,\n' +
      'http://media.example.com/fileSequence52-B.ts\n' +
      '#EXT-X-ENDLIST\n';

  this.player.src({
    src: 'https://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  // master playlist
  this.standardXHRResponse(this.requests.shift());
  // media playlist
  this.requests.shift().respond(200, null, media);
  this.clock.tick(1);

  // first segment of the original media playlist
  this.standardXHRResponse(this.requests.pop());

  assert.equal(this.requests.length, 1, 'key request only one outstanding');
  keyXhr = this.requests.shift();
  assert.ok(!keyXhr.aborted, 'key request outstanding');

  this.player.tech_.hls.playlists.trigger('mediachanging');
  this.player.tech_.hls.playlists.trigger('mediachange');
  this.clock.tick(1);

  assert.ok(keyXhr.aborted, 'key request aborted');
  assert.equal(this.requests.length, 2, 'loaded key and segment');
  assert.equal(this.requests[0].url,
               'https://priv.example.com/key.php?r=52',
               'requested the key');
  assert.equal(this.requests[1].url,
               'http://media.example.com/fileSequence52-A.ts',
               'requested the segment');
  // verify stats
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 request');
});

QUnit.test('does not download segments if preload option set to none', function(assert) {
  this.player.preload('none');
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(10 * 1000);

  this.requests = this.requests.filter(function(request) {
    return !(/m3u8$/).test(request.uri);
  });
  assert.equal(this.requests.length, 0, 'did not download any segments');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default');
});

// workaround https://bugzilla.mozilla.org/show_bug.cgi?id=548397
QUnit.test('selectPlaylist does not fail if getComputedStyle returns null', function(assert) {
  let oldGetComputedStyle = window.getComputedStyle;

  window.getComputedStyle = function() {
    return null;
  };

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  this.player.tech_.hls.selectPlaylist();
  assert.ok(true, 'should not throw');
  window.getComputedStyle = oldGetComputedStyle;

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default');
});

QUnit.test('resolves relative key URLs against the playlist', function(assert) {
  this.player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-MEDIA-SEQUENCE:5\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-ENDLIST\n');
  this.clock.tick(1);

  assert.equal(this.requests[0].url,
               'https://example.com/key.php?r=52',
               'resolves the key URL');
});

QUnit.test('adds 1 default audio track if we have not parsed any and the playlist is loaded', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.equal(this.player.audioTracks().length, 0, 'zero audio tracks at load time');

  openMediaSource(this.player, this.clock);

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(this.player.audioTracks().length, 1, 'one audio track after load');
  assert.equal(this.player.audioTracks()[0].label, 'default', 'set the label');
});

QUnit.test('adds 1 default audio track if in flash mode', function(assert) {
  let hlsOptions = videojs.options.hls;

  this.player.dispose();
  videojs.options.hls = {
    mode: 'flash'
  };

  this.player = createPlayer();

  this.player.src({
    src: 'manifest/multipleAudioGroups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.equal(this.player.audioTracks().length, 0, 'zero audio tracks at load time');

  openMediaSource(this.player, this.clock);

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(this.player.audioTracks().length, 1, 'one audio track after load');
  assert.equal(this.player.audioTracks()[0].label, 'default', 'set the label');

  videojs.options.hls = hlsOptions;
});

QUnit.test('adds audio tracks if we have parsed some from a playlist', function(assert) {
  this.player.src({
    src: 'manifest/multipleAudioGroups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.equal(this.player.audioTracks().length, 0, 'zero audio tracks at load time');

  openMediaSource(this.player, this.clock);

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  let vjsAudioTracks = this.player.audioTracks();

  assert.equal(vjsAudioTracks.length, 3, '3 active vjs tracks');

  assert.equal(vjsAudioTracks[0].enabled, true, 'default track is enabled');

  vjsAudioTracks[1].enabled = true;
  assert.equal(vjsAudioTracks[1].enabled, true, 'new track is enabled on vjs');
  assert.equal(vjsAudioTracks[0].enabled, false, 'main track is disabled');
});

QUnit.test('cleans up the buffer when loading live segments', function(assert) {
  let removes = [];
  let seekable = videojs.createTimeRanges([[0, 70]]);

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.masterPlaylistController_.seekable = function() {
    return seekable;
  };

  // This is so we do not track first call to remove during segment loader init
  this.player.tech_.hls.masterPlaylistController_.mainSegmentLoader_.resetEverything = function() {
    this.resetLoader();
  };

  this.player.tech_.hls.mediaSource.addSourceBuffer = () => {
    let buffer = new (videojs.extend(videojs.EventTarget, {
      constructor() {},
      abort() {},
      buffered: videojs.createTimeRange(),
      appendBuffer() {},
      remove(start, end) {
        removes.push([start, end]);
      }
    }))();

    this.player.tech_.hls.mediaSource.sourceBuffers = [buffer];
    return buffer;
  };
  this.player.tech_.hls.bandwidth = 20e10;
  this.player.tech_.triggerReady();
  this.standardXHRResponse(this.requests[0]);

  this.player.tech_.hls.playlists.trigger('loadedmetadata');
  this.player.tech_.trigger('canplay');
  this.player.tech_.paused = function() {
    return false;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  // request first playable segment
  this.standardXHRResponse(this.requests[1]);
  this.clock.tick(1);
  this.player.tech_.hls.mediaSource.sourceBuffers[0].trigger('updateend');

  this.clock.tick(1);

  // request second playable segment
  this.standardXHRResponse(this.requests[2]);

  assert.strictEqual(this.requests[0].url, 'liveStart30sBefore.m3u8',
                    'master playlist requested');
  assert.equal(removes.length, 1, 'remove called');
  // segment-loader removes at currentTime - 30
  assert.deepEqual(removes[0], [0, 40],
                  'remove called with the right range');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 2048, '2048 bytes');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 2, '2 requests');
});

QUnit.test('cleans up the buffer based on currentTime when loading a live segment ' +
           'if seekable start is after currentTime', function(assert) {
  let removes = [];
  let seekable = videojs.createTimeRanges([[0, 80]]);

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.masterPlaylistController_.seekable = function() {
    return seekable;
  };

  // This is so we do not track first call to remove during segment loader init
  this.player.tech_.hls.masterPlaylistController_.mainSegmentLoader_.resetEverything = function() {
    this.resetLoader();
  };

  this.player.tech_.hls.mediaSource.addSourceBuffer = () => {
    let buffer = new (videojs.extend(videojs.EventTarget, {
      constructor() {},
      abort() {},
      buffered: videojs.createTimeRange(),
      appendBuffer() {},
      remove(start, end) {
        removes.push([start, end]);
      }
    }))();

    this.player.tech_.hls.mediaSource.sourceBuffers = [buffer];
    return buffer;

  };
  this.player.tech_.hls.bandwidth = 20e10;
  this.player.tech_.triggerReady();
  this.standardXHRResponse(this.requests[0]);
  this.player.tech_.hls.playlists.trigger('loadedmetadata');
  this.player.tech_.trigger('canplay');

  this.player.tech_.paused = function() {
    return false;
  };

  this.player.tech_.trigger('play');
  this.clock.tick(1);

  // request first playable segment
  this.standardXHRResponse(this.requests[1]);

  this.clock.tick(1);
  this.player.tech_.hls.mediaSource.sourceBuffers[0].trigger('updateend');

  // Change seekable so that it starts *after* the currentTime which was set
  // based on the previous seekable range (the end of 80)
  seekable = videojs.createTimeRanges([[100, 120]]);

  this.clock.tick(1);

  // request second playable segment
  this.standardXHRResponse(this.requests[2]);

  assert.strictEqual(this.requests[0].url, 'liveStart30sBefore.m3u8', 'master playlist requested');
  assert.equal(removes.length, 1, 'remove called');
  assert.deepEqual(removes[0], [0, 80 - 30], 'remove called with the right range');
});

QUnit.test('cleans up the buffer when loading VOD segments', function(assert) {
  let removes = [];

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  // This is so we do not track first call to remove during segment loader init
  this.player.tech_.hls.masterPlaylistController_.mainSegmentLoader_.resetEverything = function() {
    this.resetLoader();
  };

  this.player.tech_.hls.mediaSource.addSourceBuffer = () => {
    let buffer = new (videojs.extend(videojs.EventTarget, {
      constructor() {},
      abort() {},
      buffered: videojs.createTimeRange(),
      appendBuffer() {},
      remove(start, end) {
        removes.push([start, end]);
      }
    }))();

    this.player.tech_.hls.mediaSource.sourceBuffers = [buffer];
    return buffer;

  };
  this.player.width(640);
  this.player.height(360);
  this.player.tech_.hls.bandwidth = 20e10;
  this.standardXHRResponse(this.requests[0]);
  this.standardXHRResponse(this.requests[1]);
  this.standardXHRResponse(this.requests[2]);
  this.clock.tick(1);
  this.player.currentTime(120);
  this.player.tech_.hls.mediaSource.sourceBuffers[0].trigger('updateend');
  // This requires 2 clock ticks because after updateend monitorBuffer_ is called
  // to setup fillBuffer on the next tick, but the seek also causes monitorBuffer_ to be
  // called, which cancels the previously set timeout and sets a new one for the following
  // tick.
  this.clock.tick(2);
  this.standardXHRResponse(this.requests[3]);

  assert.strictEqual(this.requests[0].url, 'manifest/master.m3u8',
                    'master playlist requested');
  assert.strictEqual(this.requests[1].url, absoluteUrl('manifest/media3.m3u8'),
                    'media playlist requested');
  assert.equal(removes.length, 1, 'remove called');
  assert.deepEqual(removes[0], [0, 120 - 30], 'remove called with the right range');
});

QUnit.test('when mediaGroup changes enabled track should not change', function(assert) {
  let hlsAudioChangeEvents = 0;

  this.player.src({
    src: 'manifest/multipleAudioGroups.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.on('usage', (event) => {
    if (event.name === 'hls-audio-change') {
      hlsAudioChangeEvents++;
    }
  });

  // master
  this.standardXHRResponse(this.requests.shift());
  // video media
  this.standardXHRResponse(this.requests.shift());
  let hls = this.player.tech_.hls;
  let mpc = hls.masterPlaylistController_;
  let audioTracks = this.player.audioTracks();

  assert.equal(hlsAudioChangeEvents, 0, 'no hls-audio-change event was fired');
  assert.equal(audioTracks.length, 3, 'three audio tracks after load');
  assert.equal(audioTracks[0].enabled, true, 'track one enabled after load');

  let oldMediaGroup = hls.playlists.media().attributes.AUDIO;

  // clear out any outstanding requests
  this.requests.length = 0;
  // force mpc to select a playlist from a new media group
  mpc.masterPlaylistLoader_.media(mpc.master().playlists[0]);
  this.clock.tick(1);

  // video media
  this.standardXHRResponse(this.requests.shift());

  assert.notEqual(oldMediaGroup, hls.playlists.media().attributes.AUDIO, 'selected a new playlist');
  audioTracks = this.player.audioTracks();
  let activeGroup = mpc.mediaTypes_.AUDIO.activeGroup(audioTracks[0]);

  assert.equal(audioTracks.length, 3, 'three audio tracks after changing mediaGroup');
  assert.ok(activeGroup.default, 'track one should be the default');
  assert.ok(audioTracks[0].enabled, 'enabled the default track');
  assert.notOk(audioTracks[1].enabled, 'disabled track two');
  assert.notOk(audioTracks[2].enabled, 'disabled track three');

  audioTracks[1].enabled = true;
  assert.notOk(audioTracks[0].enabled, 'disabled track one');
  assert.ok(audioTracks[1].enabled, 'enabled track two');
  assert.notOk(audioTracks[2].enabled, 'disabled track three');

  oldMediaGroup = hls.playlists.media().attributes.AUDIO;
  // clear out any outstanding requests
  this.requests.length = 0;
  // swap back to the old media group
  // this playlist is already loaded so no new requests are made
  mpc.masterPlaylistLoader_.media(mpc.master().playlists[3]);
  this.clock.tick(1);

  assert.notEqual(oldMediaGroup, hls.playlists.media().attributes.AUDIO, 'selected a new playlist');
  audioTracks = this.player.audioTracks();

  assert.equal(hlsAudioChangeEvents, 1, 'an hls-audio-change event was fired');
  assert.equal(audioTracks.length, 3, 'three audio tracks after reverting mediaGroup');
  assert.notOk(audioTracks[0].enabled, 'the default track is still disabled');
  assert.ok(audioTracks[1].enabled, 'track two is still enabled');
  assert.notOk(audioTracks[2].enabled, 'track three is still disabled');
});

QUnit.test('Allows specifying the beforeRequest function on the player', function(assert) {
  let beforeRequestCalled = false;

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.xhr.beforeRequest = function() {
    beforeRequestCalled = true;
  };
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.ok(beforeRequestCalled, 'beforeRequest was called');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default');
});

QUnit.test('Allows specifying the beforeRequest function globally', function(assert) {
  let beforeRequestCalled = false;

  videojs.Hls.xhr.beforeRequest = function() {
    beforeRequestCalled = true;
  };

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);
  // master
  this.standardXHRResponse(this.requests.shift());

  assert.ok(beforeRequestCalled, 'beforeRequest was called');

  delete videojs.Hls.xhr.beforeRequest;

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default');
});

QUnit.test('Allows overriding the global beforeRequest function', function(assert) {
  let beforeGlobalRequestCalled = 0;
  let beforeLocalRequestCalled = 0;

  videojs.Hls.xhr.beforeRequest = function() {
    beforeGlobalRequestCalled++;
  };

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.xhr.beforeRequest = function() {
    beforeLocalRequestCalled++;
  };
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());
  // ts
  this.standardXHRResponse(this.requests.shift());

  assert.equal(beforeLocalRequestCalled, 2, 'local beforeRequest was called twice ' +
                                           'for the media playlist and media');
  assert.equal(beforeGlobalRequestCalled, 1, 'global beforeRequest was called once ' +
                                            'for the master playlist');

  delete videojs.Hls.xhr.beforeRequest;

  // verify stats
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred, 1024, 'seen above');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, 'one segment request');
});

QUnit.test('passes useCueTags hls option to master playlist controller', function(assert) {
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.ok(!this.player.tech_.hls.masterPlaylistController_.useCueTags_,
           'useCueTags is falsy by default');

  let origHlsOptions = videojs.options.hls;

  videojs.options.hls = {
    useCueTags: true
  };

  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  assert.ok(this.player.tech_.hls.masterPlaylistController_.useCueTags_,
           'useCueTags passed to master playlist controller');

  videojs.options.hls = origHlsOptions;
});

QUnit.skip('populates quality levels list when available', function(assert) {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.clock.tick(1);

  openMediaSource(this.player, this.clock);

  assert.ok(this.player.tech_.hls.qualityLevels_, 'added quality levels');

  let qualityLevels = this.player.qualityLevels();
  let addCount = 0;
  let changeCount = 0;

  qualityLevels.on('addqualitylevel', () => {
    addCount++;
  });

  qualityLevels.on('change', () => {
    changeCount++;
  });

  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(addCount, 4, 'four levels added from master');
  assert.equal(changeCount, 1, 'selected initial quality level');

  this.player.dispose();
  this.player = createPlayer({}, {
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.clock);
  openMediaSource(this.player, this.clock);

  assert.ok(this.player.tech_.hls.qualityLevels_, 'added quality levels from video with source');
});

QUnit.module('HLS Integration', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.tech = new (videojs.getTech('Html5'))({});
    this.clock = this.env.clock;

    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleUpdateEnd_
      this.clock.tick(1);
    };

    videojs.HlsHandler.prototype.setupQualityLevels_ = () => {};
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
    videojs.HlsHandler.prototype.setupQualityLevels_ = ogHlsHandlerSetupQualityLevels;
  }
});

QUnit.test('does not error when MediaSource is not defined', function(assert) {
  window.MediaSource = null;

  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/alternateAudio.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  assert.ok(true, 'did not throw an exception');
});

QUnit.test('aborts all in-flight work when disposed', function(assert) {
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  hls.dispose();
  assert.ok(this.requests[0].aborted, 'aborted the old segment request');
  hls.mediaSource.sourceBuffers.forEach(sourceBuffer => {
    let lastUpdate = sourceBuffer.updates_[sourceBuffer.updates_.length - 1];

    assert.ok(lastUpdate.abort, 'aborted the source buffer');
  });
});

QUnit.test('stats are reset on dispose', function(assert) {
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');
  // master
  this.standardXHRResponse(this.requests.shift());
  // media
  this.standardXHRResponse(this.requests.shift());

  // media
  this.standardXHRResponse(this.requests.shift());

  assert.equal(hls.stats.mediaBytesTransferred, 1024, 'stat is set');
  hls.dispose();
  assert.equal(hls.stats.mediaBytesTransferred, 0, 'stat is reset');
});

QUnit.test('detects fullscreen and triggers a quality change', function(assert) {
  let qualityChanges = 0;
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);
  let fullscreenElementName;

  ['fullscreenElement', 'webkitFullscreenElement',
   'mozFullScreenElement', 'msFullscreenElement'
  ].forEach((name) => {
    if (!fullscreenElementName && !document.hasOwnProperty(name)) {
      fullscreenElementName = name;
    }
  });

  hls.masterPlaylistController_.fastQualityChange_ = function() {
    qualityChanges++;
  };

  // take advantage of capability detection to mock fullscreen activation
  document[fullscreenElementName] = this.tech.el();
  Events.trigger(document, 'fullscreenchange');

  assert.equal(qualityChanges, 1, 'made a fast quality change');

  // don't do a fast quality change when returning from fullscreen;
  // allow the video element to rescale the already buffered video
  document[fullscreenElementName] = null;
  Events.trigger(document, 'fullscreenchange');

  assert.equal(qualityChanges, 1, 'did not make another quality change');
});

QUnit.test('downloads additional playlists if required', function(assert) {
  let originalPlaylist;
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  // Make segment metadata noop since most test segments dont have real data
  hls.masterPlaylistController_.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};

  hls.mediaSource.trigger('sourceopen');
  hls.bandwidth = 1;
  // master
  this.standardXHRResponse(this.requests[0]);
  // media
  this.standardXHRResponse(this.requests[1]);
  originalPlaylist = hls.playlists.media();
  hls.masterPlaylistController_.mainSegmentLoader_.mediaIndex = 0;

  // the playlist selection is revisited after a new segment is downloaded
  this.requests[2].bandwidth = 3000000;
  // segment
  this.standardXHRResponse(this.requests[2]);
  // update the buffer to reflect the appended segment, and have enough buffer to
  // change playlist
  this.tech.buffered = () => videojs.createTimeRanges([[0, 30]]);
  hls.mediaSource.sourceBuffers[0].trigger('updateend');

  // new media
  this.standardXHRResponse(this.requests[3]);

  assert.ok((/manifest\/media\d+.m3u8$/).test(this.requests[3].url),
           'made a playlist request');
  assert.notEqual(originalPlaylist.resolvedUri,
                 hls.playlists.media().resolvedUri,
                 'a new playlists was selected');
  assert.ok(hls.playlists.media().segments, 'segments are now available');

  // verify stats
  assert.equal(hls.stats.bandwidth, 3000000, 'default');
  assert.equal(hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(hls.stats.mediaRequests, 1, '1 request');
});

QUnit.test('waits to download new segments until the media playlist is stable', function(assert) {
  let sourceBuffer;
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.masterPlaylistController_.mainSegmentLoader_.addSegmentMetadataCue_ = () => {};

  hls.mediaSource.trigger('sourceopen');

  // make sure we stay on the lowest variant
  hls.bandwidth = 1;
  // master
  this.standardXHRResponse(this.requests.shift());

  // media1
  this.standardXHRResponse(this.requests.shift());

  // source buffer created after media source is open and first media playlist is selected
  sourceBuffer = hls.mediaSource.sourceBuffers[0];
  hls.masterPlaylistController_.mainSegmentLoader_.mediaIndex = 0;

  // segment 0
  this.standardXHRResponse(this.requests.shift());
  // update the buffer to reflect the appended segment, and have enough buffer to
  // change playlist
  this.tech.buffered = () => videojs.createTimeRanges([[0, 30]]);
  // no time has elapsed, so bandwidth is really high and we'll switch
  // playlists
  sourceBuffer.trigger('updateend');

  assert.equal(this.requests.length, 1, 'only the playlist request outstanding');
  this.clock.tick(10 * 1000);
  assert.equal(this.requests.length, 1, 'delays segment fetching');

  // another media playlist
  this.standardXHRResponse(this.requests.shift());
  this.clock.tick(10 * 1000);
  assert.equal(this.requests.length, 1, 'resumes segment fetching');

  // verify stats
  assert.equal(hls.stats.bandwidth, Infinity, 'default');
  assert.equal(hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(hls.stats.mediaRequests, 1, '1 request');
});

QUnit.test('live playlist starts three target durations before live', function(assert) {
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:101\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXTINF:10,\n' +
                                '2.ts\n' +
                                '#EXTINF:10,\n' +
                                '3.ts\n' +
                                '#EXTINF:10,\n' +
                                '4.ts\n');

  assert.equal(this.requests.length, 0, 'no outstanding segment request');

  this.tech.paused = function() {
    return false;
  };
  this.tech.trigger('play');
  this.clock.tick(1);
  assert.equal(this.tech.currentTime(),
              hls.seekable().end(0),
              'seeked to the seekable end');

  assert.equal(this.requests.length, 1, 'begins buffering');

});

QUnit.test('uses user defined selectPlaylist from HlsHandler if specified', function(assert) {
  let origStandardPlaylistSelector = Hls.STANDARD_PLAYLIST_SELECTOR;
  let defaultSelectPlaylistCount = 0;

  Hls.STANDARD_PLAYLIST_SELECTOR = () => defaultSelectPlaylistCount++;

  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.masterPlaylistController_.selectPlaylist();
  assert.equal(defaultSelectPlaylistCount, 1, 'uses default playlist selector');

  defaultSelectPlaylistCount = 0;

  let newSelectPlaylistCount = 0;
  let newSelectPlaylist = () => newSelectPlaylistCount++;

  HlsHandler.prototype.selectPlaylist = newSelectPlaylist;

  hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.masterPlaylistController_.selectPlaylist();
  assert.equal(defaultSelectPlaylistCount, 0, 'standard playlist selector not run');
  assert.equal(newSelectPlaylistCount, 1, 'uses overridden playlist selector');

  newSelectPlaylistCount = 0;

  let setSelectPlaylistCount = 0;

  hls.selectPlaylist = () => setSelectPlaylistCount++;

  hls.masterPlaylistController_.selectPlaylist();
  assert.equal(defaultSelectPlaylistCount, 0, 'standard playlist selector not run');
  assert.equal(newSelectPlaylistCount, 0, 'overridden playlist selector not run');
  assert.equal(setSelectPlaylistCount, 1, 'uses set playlist selector');

  Hls.STANDARD_PLAYLIST_SELECTOR = origStandardPlaylistSelector;
  delete HlsHandler.prototype.selectPlaylist;
});

QUnit.module('HLS - Encryption', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.tech = new (videojs.getTech('Html5'))({});
    this.clock = this.env.clock;

    this.standardXHRResponse = (request, data) => {
      standardXHRResponse(request, data);

      // Because SegmentLoader#fillBuffer_ is now scheduled asynchronously
      // we have to use clock.tick to get the expected side effects of
      // SegmentLoader#handleUpdateEnd_
      this.clock.tick(1);
    };

    videojs.HlsHandler.prototype.setupQualityLevels_ = () => {};
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
    videojs.HlsHandler.prototype.setupQualityLevels_ = ogHlsHandlerSetupQualityLevels;
  }
});

QUnit.test('blacklists playlist if key requests fail', function(assert) {
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/encrypted-master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');
  this.requests.shift()
    .respond(200, null,
              '#EXTM3U\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
              'media.m3u8\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
              'media1.m3u8\n');
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
             '#EXTINF:15.0,\n' +
             'http://media.example.com/fileSequence53-A.ts\n' +
             '#EXT-X-ENDLIST\n');
  this.clock.tick(1);

  // segment 1
  if (/key\.php/i.test(this.requests[0].url)) {
    this.standardXHRResponse(this.requests.pop());
  } else {
    this.standardXHRResponse(this.requests.shift());
  }
  // fail key
  this.requests.shift().respond(404);

  assert.ok(hls.playlists.media().excludeUntil > 0,
           'playlist blacklisted');
  assert.equal(this.env.log.warn.calls, 1, 'logged warning for blacklist');
});

QUnit.test('treats invalid keys as a key request failure and blacklists playlist', function(assert) {
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/encrypted-master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');
  this.requests.shift()
    .respond(200, null,
              '#EXTM3U\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
              'media.m3u8\n' +
              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
              'media1.m3u8\n');
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-MEDIA-SEQUENCE:5\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-KEY:METHOD=NONE\n' +
             '#EXTINF:15.0,\n' +
             'http://media.example.com/fileSequence52-B.ts\n' +
             '#EXT-X-ENDLIST\n');
  this.clock.tick(1);

  // segment request
  this.standardXHRResponse(this.requests.pop());

  assert.equal(this.requests[0].url,
              'https://priv.example.com/key.php?r=52',
              'requested the key');
  // keys *should* be 16 bytes long -- this one is too small
  this.requests[0].response = new Uint8Array(1).buffer;
  this.requests.shift().respond(200, null, '');
  this.clock.tick(1);

  // blacklist this playlist
  assert.ok(hls.playlists.media().excludeUntil > 0,
           'blacklisted playlist');
  assert.equal(this.env.log.warn.calls, 1, 'logged warning for blacklist');

  // verify stats
  assert.equal(hls.stats.mediaBytesTransferred, 1024, '1024 bytes');
  assert.equal(hls.stats.mediaRequests, 1, '1 request');
});

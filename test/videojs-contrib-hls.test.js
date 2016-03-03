import document from 'global/document';
import videojs from 'video.js';
import QUnit from 'qunit';
import {Hls, HlsSourceHandler, HlsHandler} from '../src/plugin';
import {default as Helper, MockMediaSource} from './plugin-helpers.js';

const Player = videojs.getComponent('Player');
const Flash = videojs.getComponent('Flash');
let nextId = 0;

QUnit.module('HLS:general', {
  beforeEach() {
    let fakeEnvironment;

    fakeEnvironment = Helper.useFakeEnvironment();
    this.clock = fakeEnvironment.clock;
    this.requests = fakeEnvironment.requests;

    // setup a player
    this.player = Helper.createPlayer();

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

    // Fake sourcebuffer
    this.old.SourceBuffer = window.videojs.SourceBuffer;
    window.videojs.SourceBuffer = function() {
      this.appendBuffer = function() {};
      this.abort = function() {};
    };

    // store functionality that some tests need to mock
    this.old.SegmentParser = Hls.SegmentParser;
    this.old.GlobalOptions = videojs.mergeOptions(videojs.options);

    // force the HLS tech to run
    this.old.NativeHlsSupport = Hls.supportsNativeHls;
    Hls.supportsNativeHls = () => false;

    this.old.Decrypt = Hls.Decrypter;
    Hls.Decrypter = function() {};

    // Mock Media Sources
    this.old.MediaSource = Player.prototype.MediaSource;
    Player.prototype.MediaSource = MockMediaSource;
    this.old.URL = Player.prototype.URL;
    Player.prototype.URL = Helper.URL;
  },

  afterEach() {
    Helper.restoreEnvironment();

    this.player.dispose();

    Player.prototype.MediaSource = this.old.MediaSource;
    Player.prototype.URL = this.old.URL;

    Helper.merge(videojs.options, this.old.GlobalOptions);
    Flash.isSupported = this.old.FlashSupported;
    Helper.merge(Flash, this.old.Flash);

    Hls.SegmentParser = this.old.SegmentParser;
    Hls.supportsNativeHls = this.old.NativeHlsSupport;
    Hls.Decrypter = this.old.Decrypt;
    videojs.SourceBuffer = this.old.SourceBuffer;
  }
});

QUnit.test('starts playing if autoplay is specified', function() {
  let plays = 0;

  this.player.autoplay(true);
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  // REMOVEME workaround https://github.com/videojs/video.js/issues/2326
  // this.player.tech_.triggerReady();
  // this.clock.tick(1);
  // make sure play() is called *after* the media source opens
  this.player.tech_.hls.play = function() {
    plays++;
  };
  Helper.openMediaSource(this.player, this.clock);

  Helper.standardXHRResponse(this.requests[0]);
  QUnit.strictEqual(1, plays, 'play was called');
});

QUnit.test('autoplay seeks to the live point after playlist load', function() {
  let currentTime = 0;
  /* eslint-disable consistent-this */
  let self = this;
  /* eslint-enable consistent-this */

  this.player.autoplay(true);
  this.player.on('seeking', function() {
    currentTime = self.player.currentTime();
  });
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.readyState = function() {
    return 1;
  };
  this.player.tech_.trigger('play');
  Helper.standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  QUnit.notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test('autoplay seeks to the live point after media source open', function() {
  let currentTime = 0;
  /* eslint-disable consistent-this */
  let self = this;
  /* eslint-enable consistent-this */

  this.player.autoplay(true);
  this.player.on('seeking', function() {
    currentTime = self.player.currentTime();
  });
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  Helper.standardXHRResponse(this.requests.shift());
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.readyState = function() {
    return 1;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  QUnit.notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test(
'duration is set when the source opens after the playlist is loaded',
function() {
  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  Helper.standardXHRResponse(this.requests.shift());
  Helper.openMediaSource(this.player, this.clock);

  QUnit.equal(
    this.player.tech_.hls.mediaSource.duration,
    40,
    'set the duration'
  );
});

QUnit.test('codecs are passed to the source buffer', function() {
  let codecs = [];

  this.player.src({
    src: 'custom-codecs.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  let addSourceBuffer = this.player.tech_.hls.mediaSource.addSourceBuffer;

  this.player.tech_.hls.mediaSource.addSourceBuffer = function(codec) {
    codecs.push(codec);
    return addSourceBuffer.call(this, codec);
  };

  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:CODECS="video, audio"\n' +
    'media.m3u8\n'
  );
  Helper.standardXHRResponse(this.requests.shift());
  QUnit.equal(codecs.length, 1, 'created a source buffer');
  QUnit.equal(codecs[0], 'video/mp2t; codecs="video, audio"', 'specified the codecs');
});

QUnit.test('including HLS as a tech does not error', function() {
  let player = Helper.createPlayer({
    techOrder: ['hls', 'html5']
  });

  QUnit.ok(player, 'created the player');
});

// Warns: 'player.hls is deprecated. Use player.tech.hls instead.'
QUnit.test('creates a PlaylistLoader on init', function() {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  QUnit.equal(this.requests[0].aborted, true, 'aborted previous src');
  Helper.standardXHRResponse(this.requests[1]);
  QUnit.ok(
    this.player.tech_.hls.playlists.master,
    'set the master playlist'
  );
  QUnit.ok(
    this.player.tech_.hls.playlists.media(),
    'set the media playlist'
  );
  QUnit.ok(
    this.player.tech_.hls.playlists.media().segments,
    'the segment entries are parsed'
  );
  QUnit.strictEqual(
    this.player.tech_.hls.playlists.master.playlists[0],
    this.player.tech_.hls.playlists.media(),
    'the playlist is selected'
  );
});

QUnit.test('creates a SegmentLoader on init', function() {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  QUnit.equal(this.player.tech_.hls.segments.state, 'INIT', 'created a segment loader');
});

QUnit.test('re-initializes the playlist loader when switching sources', function() {
  // source is set
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  // loader gets media playlist
  Helper.standardXHRResponse(this.requests.shift());
  // request a segment
  Helper.standardXHRResponse(this.requests.shift());
  // change the source
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  // maybe not needed if https://github.com/videojs/video.js/issues/2326 gets fixed
  this.clock.tick(1);
  QUnit.ok(!this.player.tech_.hls.playlists.media(), 'no media playlist');
  QUnit.equal(
    this.player.tech_.hls.playlists.state,
    'HAVE_NOTHING',
    'reset the playlist loader state'
  );
  QUnit.equal(this.requests.length, 1, 'requested the new src');

  // buffer check
  this.clock.tick(10 * 1000);
  QUnit.equal(this.requests.length, 1, 'did not request a stale segment');

  // sourceopen
  Helper.openMediaSource(this.player, this.clock);

  QUnit.equal(this.requests.length, 1, 'made one request');
  QUnit.ok(
    this.requests[0].url.indexOf('master.m3u8') >= 0,
      'requested only the new playlist'
  );
});

QUnit.test('updates the segment loader on live playlist refreshes', function() {
  let updates = [];
  let hls;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  hls = this.player.tech_.hls;

  // master
  Helper.standardXHRResponse(this.requests.shift());
  // media
  Helper.standardXHRResponse(this.requests.shift());
  hls.segments.playlist = function(update) {
    updates.push(update);
  };

  hls.playlists.trigger('loadedplaylist');
  QUnit.equal(updates.length, 1, 'updated the segment list');
});

QUnit.test('sets the duration if one is available on the playlist', function() {
  let events = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.on('durationchange', function() {
    events++;
  });

  Helper.standardXHRResponse(this.requests[0]);
  QUnit.equal(
    this.player.tech_.hls.mediaSource.duration,
    40,
    'set the duration'
  );
  QUnit.equal(events, 1, 'durationchange is fired');
});

QUnit.test('estimates individual segment durations if needed', function() {
  let changes = 0;

  this.player.src({
    src: 'http://example.com/manifest/missingExtinf.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.hls.mediaSource.duration = NaN;
  this.player.tech_.on('durationchange', function() {
    changes++;
  });

  Helper.standardXHRResponse(this.requests[0]);
  QUnit.strictEqual(
    this.player.tech_.hls.mediaSource.duration,
    this.player.tech_.hls.playlists.media().segments.length * 10,
    'duration is updated'
  );
  QUnit.strictEqual(changes, 1, 'one durationchange fired');
});

QUnit.test('translates seekable by the starting time for live playlists', function() {
  let seekable;

  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:15\n' +
    '#EXTINF:10,\n' +
    '0.ts\n' +
    '#EXTINF:10,\n' +
    '1.ts\n' +
    '#EXTINF:10,\n' +
    '2.ts\n' +
    '#EXTINF:10,\n' +
    '3.ts\n'
  );

  seekable = this.player.seekable();
  QUnit.equal(seekable.length, 1, 'one seekable range');
  QUnit.equal(seekable.start(0), 0, 'the earliest possible position is at zero');
  QUnit.equal(seekable.end(0), 10, 'end is relative to the start');
});

QUnit.test('starts downloading a segment on loadedmetadata', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  Helper.openMediaSource(this.player, this.clock);

  Helper.standardXHRResponse(this.requests[0]);
  Helper.standardXHRResponse(this.requests[1]);
  QUnit.strictEqual(
    this.requests[1].url,
    Helper.absoluteUrl('manifest/media-00001.ts'),
    'the first segment is requested'
  );
});

QUnit.test('triggers an error when a master playlist request errors', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.requests.pop().respond(500);

  QUnit.equal(
    this.player.tech_.hls.mediaSource.error_,
    'network',
    'a network error is triggered'
  );
});

QUnit.test('downloads media playlists after loading the master', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 20e10;
  Helper.standardXHRResponse(this.requests[0]);
  Helper.standardXHRResponse(this.requests[1]);
  Helper.standardXHRResponse(this.requests[2]);

  QUnit.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  QUnit.strictEqual(
    this.requests[1].url,
    Helper.absoluteUrl('manifest/media3.m3u8'),
    'media playlist requested'
  );
  QUnit.strictEqual(
    this.requests[2].url,
    Helper.absoluteUrl('manifest/media3-00001.ts'),
    'first segment requested'
  );
});

QUnit.test('upshifts if the initial bandwidth hint is high', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 10e20;
  Helper.standardXHRResponse(this.requests[0]);
  Helper.standardXHRResponse(this.requests[1]);
  Helper.standardXHRResponse(this.requests[2]);

  QUnit.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  QUnit.strictEqual(
    this.requests[1].url,
    Helper.absoluteUrl('manifest/media3.m3u8'),
    'media playlist requested'
  );
  QUnit.strictEqual(
    this.requests[2].url,
    Helper.absoluteUrl('manifest/media3-00001.ts'),
    'first segment requested'
  );
});

QUnit.test('downshifts if the initial bandwidth hint is low', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 100;
  Helper.standardXHRResponse(this.requests[0]);
  Helper.standardXHRResponse(this.requests[1]);
  Helper.standardXHRResponse(this.requests[2]);

  QUnit.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  QUnit.strictEqual(
    this.requests[1].url,
    Helper.absoluteUrl('manifest/media1.m3u8'),
    'media playlist requested'
  );
  QUnit.strictEqual(
    this.requests[2].url,
    Helper.absoluteUrl('manifest/media1-00001.ts'),
    'first segment requested'
  );
});

QUnit.skip('buffer checks are noops until a media playlist is ready', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.hls.checkBuffer_();

  QUnit.strictEqual(1, this.requests.length, 'one request was made');
  QUnit.strictEqual(
    this.requests[0].url,
    'manifest/media.m3u8',
    'media playlist requested'
  );
});

QUnit.skip('buffer checks are noops when only the master is ready', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  // master
  Helper.standardXHRResponse(this.requests.shift());
  // media
  Helper.standardXHRResponse(this.requests.shift());
  // ignore any outstanding segmentthis.requests
  this.requests.length = 0;

  // load in a new playlist which will cause playlists.media() to be
  // undefined while it is being fetched
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  // respond with the master playlist but don't send the media playlist yet
  // force media1 to be requested
  this.player.tech_.hls.bandwidth = 1;
  // master
  Helper.standardXHRResponse(this.requests.shift());
  // trigger fillBuffer()
  this.player.tech_.hls.checkBuffer_();

  QUnit.strictEqual(1, this.requests.length, 'one request was made');
  QUnit.strictEqual(
    this.requests[0].url,
    Helper.absoluteUrl('manifest/media1.m3u8'),
    'media playlist requested'
  );
});

QUnit.skip('fires a progress event after downloading a segment', function() {
  let progressCount = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  Helper.standardXHRResponse(this.requests.shift());
  this.player.on('progress', function() {
    progressCount++;
  });
  Helper.standardXHRResponse(this.requests.shift());
  QUnit.equal(progressCount, 1, 'fired a progress event');
});

QUnit.test('selects a playlist below the current bandwidth', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  Helper.standardXHRResponse(this.requests[0]);

  // the default playlist has a really high bitrate
  this.player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 9e10;
  // playlist 1 has a very low bitrate
  this.player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 1;
  // but the detected client bandwidth is really low
  this.player.tech_.hls.bandwidth = 10;

  playlist = this.player.tech_.hls.selectPlaylist();
  QUnit.strictEqual(
    playlist,
    this.player.tech_.hls.playlists.master.playlists[1],
    'the low bitrate stream is selected');
});

QUnit.test('allows initial bandwidth to be provided', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.hls.bandwidth = 500;

  this.requests[0].bandwidth = 1;
  this.requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                           '#EXT-X-TARGETDURATION:10\n');
  QUnit.equal(
    this.player.tech_.hls.bandwidth,
    500,
    'prefers user-specified intial bandwidth'
  );
});

QUnit.test('raises the minimum bitrate for a stream proportionially', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  Helper.standardXHRResponse(this.requests[0]);

  // the default playlist's bandwidth + 10% is QUnit.equal to the current bandwidth
  this.player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 10;
  this.player.tech_.hls.bandwidth = 11;

  // 9.9 * 1.1 < 11
  this.player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 9.9;
  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.strictEqual(playlist,
              this.player.tech_.hls.playlists.master.playlists[1],
              'a lower bitrate stream is selected');
});

QUnit.test('uses the lowest bitrate if no other is suitable', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  Helper.standardXHRResponse(this.requests[0]);

  // the lowest bitrate playlist is much greater than 1b/s
  this.player.tech_.hls.bandwidth = 1;
  playlist = this.player.tech_.hls.selectPlaylist();

  // playlist 1 has the lowest advertised bitrate
  QUnit.strictEqual(playlist,
              this.player.tech_.hls.playlists.master.playlists[1],
              'the lowest bitrate stream is selected');
});

QUnit.test('selects the correct rendition by tech dimensions', function() {
  let playlist;
  let hls;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  Helper.standardXHRResponse(this.requests[0]);

  hls = this.player.tech_.hls;

  this.player.width(640);
  this.player.height(360);
  hls.bandwidth = 3000000;

  playlist = hls.selectPlaylist();

  QUnit.deepEqual(
    playlist.attributes.RESOLUTION,
    {width: 960, height: 540},
    'should return the correct resolution by playerdimensions'
  );
  QUnit.equal(
    playlist.attributes.BANDWIDTH,
    1928000,
    'should have the expected bandwidth in case of multiple'
  );

  this.player.width(1920);
  this.player.height(1080);
  hls.bandwidth = 3000000;

  playlist = hls.selectPlaylist();

  QUnit.deepEqual(playlist.attributes.RESOLUTION, {
    width: 960,
    height: 540
  }, 'should return the correct resolution by playerdimensions');
  QUnit.equal(
    playlist.attributes.BANDWIDTH,
    1928000,
    'should have the expected bandwidth in case of multiple'
  );

  this.player.width(396);
  this.player.height(224);
  playlist = hls.selectPlaylist();

  QUnit.deepEqual(playlist.attributes.RESOLUTION, {
    width: 396,
    height: 224
  }, 'should return the correct resolution by player dimensions, if exact match');
  QUnit.equal(
    playlist.attributes.BANDWIDTH,
    440000,
    'should have the expected bandwidth in case of multiple, if exact match'
  );
});

QUnit.test('selects the highest bitrate playlist when the this.playerdimensions are ' +
     'larger than any of the variants', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  // master
  this.requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=2x1\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x1\n' +
                           'media1.m3u8\n');
                           // media
  Helper.standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.bandwidth = 1e10;

  this.player.width(1024);
  this.player.height(768);

  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.equal(playlist.attributes.BANDWIDTH,
        1000,
        'selected the highest bandwidth variant');
});

QUnit.test('filters playlists that are currently excluded', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e10;
  // master
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
    'media1.m3u8\n'
  );
  // media
  Helper.standardXHRResponse(this.requests.shift());

  // exclude the current playlist
  this.player.tech_.hls.playlists.master.playlists[0].excludeUntil = +new Date() + 1000;
  playlist = this.player.tech_.hls.selectPlaylist();
  QUnit.equal(
    playlist,
    this.player.tech_.hls.playlists.master.playlists[1],
    'respected exclusions'
  );

  // timeout the exclusion
  this.clock.tick(1000);
  playlist = this.player.tech_.hls.selectPlaylist();
  QUnit.equal(
    playlist,
    this.player.tech_.hls.playlists.master.playlists[0],
    'expired the exclusion'
  );
});

QUnit.test('blacklists switching from video+audio playlists to audio only', function() {
  let audioPlaylist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e10;
  // master
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
    'media1.m3u8\n'
  );

  // media1
  Helper.standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.playlists.media(),
        this.player.tech_.hls.playlists.master.playlists[1],
        'selected video+audio');
  audioPlaylist = this.player.tech_.hls.playlists.master.playlists[0];
  QUnit.equal(audioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

QUnit.test('blacklists switching from audio-only playlists to video+audio', function() {
  let videoAudioPlaylist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
    'media1.m3u8\n'
  );

  // media1
  Helper.standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.playlists.media(),
        this.player.tech_.hls.playlists.master.playlists[0],
        'selected audio only');
  videoAudioPlaylist = this.player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(
    videoAudioPlaylist.excludeUntil,
    Infinity,
    'excluded incompatible playlist'
  );
});

QUnit.test('blacklists switching from video-only playlists to video+audio', function() {
  let videoAudioPlaylist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n'
  );

  // media
  Helper.standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.playlists.media(),
        this.player.tech_.hls.playlists.master.playlists[0],
        'selected video only');
  videoAudioPlaylist = this.player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(
    videoAudioPlaylist.excludeUntil,
    Infinity,
    'excluded incompatible playlist'
  );
});

QUnit.test('does not blacklist compatible H.264 codec strings', function() {
  let master;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400f,mp4a.40.5"\n' +
    'media1.m3u8\n'
  );

  // media
  Helper.standardXHRResponse(this.requests.shift());
  master = this.player.tech_.hls.playlists.master;
  QUnit.strictEqual(
    typeof master.playlists[0].excludeUntil,
    'undefined',
    'did not blacklist'
  );
  QUnit.strictEqual(
    typeof master.playlists[1].excludeUntil,
    'undefined',
    'did not blacklist'
  );
});

QUnit.test('does not blacklist compatible AAC codec strings', function() {
  let master;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.3"\n' +
    'media1.m3u8\n'
  );

  // media
  Helper.standardXHRResponse(this.requests.shift());
  master = this.player.tech_.hls.playlists.master;
  QUnit.strictEqual(
    typeof master.playlists[0].excludeUntil,
    'undefined',
    'did not blacklist'
  );
  QUnit.strictEqual(
    typeof master.playlists[1].excludeUntil,
    'undefined',
    'did not blacklist'
  );
});

QUnit.test(
'blacklists switching between playlists with incompatible audio codecs',
function() {
  let alternatePlaylist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n'
  );

  // media
  Helper.standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.playlists.media(),
        this.player.tech_.hls.playlists.master.playlists[0],
        'selected HE-AAC stream');
  alternatePlaylist = this.player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(alternatePlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

QUnit.test('cancels outstanding XHRs when seeking', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  Helper.standardXHRResponse(this.requests[0]);
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
  this.clock.tick(1);

  QUnit.ok(this.requests[1].aborted, 'XHR aborted');
  QUnit.strictEqual(this.requests.length, 3, 'opened new XHR');
});

QUnit.test('does not abort segment loading for in-buffer seeking', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  Helper.standardXHRResponse(this.requests.shift());
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };

  this.player.tech_.setCurrentTime(11);
  this.clock.tick(1);
  QUnit.equal(this.requests.length, 1, 'did not abort the outstanding request');
});

QUnit.test('playlist 404 should end stream with a network error', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.requests.pop().respond(404);

  QUnit.equal(this.player.tech_.hls.mediaSource.error_, 'network', 'set a network error');
});

QUnit.test('segment 404 should trigger blacklisting of media', function() {
  let media;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 20000;
  // master
  Helper.standardXHRResponse(this.requests[0]);
  // media
  Helper.standardXHRResponse(this.requests[1]);

  media = this.player.tech_.hls.playlists.media_;

  // segment
  this.requests[2].respond(400);
  QUnit.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
});

QUnit.test('playlist 404 should blacklist media', function() {
  let media;
  let url;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e10;
  // master
  this.requests[0].respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'media1.m3u8\n');

  QUnit.equal(
    typeof this.player.tech_.hls.playlists.media_,
    'undefined',
    'no media is initially set'
  );

  // media
  this.requests[1].respond(400);

  url = this.requests[1].url.slice(this.requests[1].url.lastIndexOf('/') + 1);
  media = this.player.tech_.hls.playlists.master.playlists[url];

  QUnit.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
});

QUnit.test('seeking in an empty playlist is a non-erroring noop', function() {
  let requestsLength;

  this.player.src({
    src: 'manifest/empty-live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.requests.shift().respond(200, null, '#EXTM3U\n');

  requestsLength = this.requests.length;
  this.player.tech_.setCurrentTime(183);
  this.clock.tick(1);

  QUnit.equal(this.requests.length, requestsLength, 'made no additional this.requests');
});

QUnit.test('sets seekable and duration for live playlists', function() {
  this.player.src({
    src: 'http://example.com/manifest/missingEndlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  Helper.standardXHRResponse(this.requests[0]);

  QUnit.equal(this.player.tech_.hls.mediaSource.seekable.length,
        1,
        'set one seekable range');
  QUnit.equal(this.player.tech_.hls.mediaSource.seekable.start(0),
        this.player.tech_.hls.seekable().start(0),
        'set seekable start');
  QUnit.equal(this.player.tech_.hls.mediaSource.seekable.end(0),
        this.player.tech_.hls.seekable().end(0),
        'set seekable end');

  QUnit.strictEqual(this.player.tech_.hls.mediaSource.duration,
              Infinity,
              'duration on the mediaSource is infinity');
});

QUnit.test('live playlist starts three target durations before live', function() {
  /* eslint-disable no-unused-vars */
  let mediaPlaylist;
  /* eslint-enable no-unused-vars */

  this.player.src({
    src: 'live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
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

  QUnit.equal(this.requests.length, 0, 'no outstanding segment request');

  this.player.tech_.paused = function() {
    return false;
  };
  this.player.tech_.readyState = function() {
    return 1;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);
  mediaPlaylist = this.player.tech_.hls.playlists.media();
  QUnit.equal(
    this.player.currentTime(),
    this.player.tech_.hls.seekable().end(0),
    'seeked to the seekable end'
  );

  QUnit.equal(this.requests.length, 1, 'begins buffering');
});

QUnit.test('live playlist starts with correct currentTime value', function() {
  this.player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  Helper.standardXHRResponse(this.requests[0]);

  this.player.tech_.hls.playlists.trigger('loadedmetadata');

  this.player.tech_.paused = function() {
    return false;
  };
  this.player.tech_.readyState = function() {
    return 1;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  QUnit.strictEqual(this.player.currentTime(),
              Hls.Playlist.seekable(this.player.tech_.hls.playlists.media()).end(0),
              'currentTime is updated at playback');
});

QUnit.test(
'adjusts the seekable start based on the amount of expired live content',
function() {
  this.player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  Helper.standardXHRResponse(this.requests.shift());

  // add timeline info to the playlist
  this.player.tech_.hls.playlists.media().segments[1].end = 29.5;
  // expired_ should be ignored if there is timeline information on
  // the playlist
  this.player.tech_.hls.playlists.expired_ = 172;

  QUnit.equal(this.player.seekable().start(0),
        29.5 - 29,
        'offset the seekable start');
});

QUnit.test(
'estimates seekable ranges for live streams that have been paused for a long time',
function() {
  this.player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  Helper.standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.playlists.expired_ = 172;

  QUnit.equal(this.player.seekable().start(0),
        this.player.tech_.hls.playlists.expired_,
        'offset the seekable start');
});

QUnit.test('resets the time to a seekable position when resuming a live stream ' +
     'after a long break', function() {
  let seekTarget;

  this.player.src({
    src: 'live0.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:16\n' +
                           '#EXTINF:10,\n' +
                           '16.ts\n');
  // mock out the this.playerto simulate a live stream that has been
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

  this.player.tech_.trigger('play');
  QUnit.equal(
    seekTarget,
    this.player.seekable().start(0),
    'seeked to the start of seekable'
  );
  this.player.tech_.trigger('seeked');
});

QUnit.test('reloads out-of-date live playlists when switching variants', function() {
  let oldManifest = Helper.testDataManifests['variant-update'];

  this.player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

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

  Helper.testDataManifests['variant-update'] = '#EXTM3U\n' +
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

  QUnit.strictEqual(this.player.mediaIndex, 1, 'mediaIndex points at the next segment');
  Helper.testDataManifests['variant-update'] = oldManifest;
});

QUnit.test(
'if withCredentials global option is used, withCredentials is set on the XHR object',
function() {
  let hlsOptions = videojs.options.hls;

  this.player.dispose();
  videojs.options.hls = {
    withCredentials: true
  };
  this.player = Helper.createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  QUnit.ok(this.requests[0].withCredentials,
     'with credentials should be set to true if that option is passed in');
  videojs.options.hls = hlsOptions;
});

QUnit.test(
'if withCredentials src option is used, withCredentials is set on the XHR object',
function() {
  this.player.dispose();
  this.player = Helper.createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: true
  });
  Helper.openMediaSource(this.player, this.clock);
  QUnit.ok(this.requests[0].withCredentials,
     'with credentials should be set to true if that option is passed in');
});

QUnit.test('src level credentials supersede the global options', function() {
  this.player.dispose();
  this.player = Helper.createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: true
  });
  Helper.openMediaSource(this.player, this.clock);
  QUnit.ok(this.requests[0].withCredentials,
     'with credentials should be set to true if that option is passed in');

});

QUnit.test('does not break if the playlist has no segments', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  try {
    Helper.openMediaSource(this.player, this.clock);
    this.requests[0].respond(200, null,
                        '#EXTM3U\n' +
                        '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                        '#EXT-X-TARGETDURATION:10\n');
  } catch (e) {
    QUnit.ok(false, 'an error was thrown');
    throw e;
  }
  QUnit.ok(true, 'no error was thrown');
  QUnit.strictEqual(
    this.requests.length,
    1,
    'no this.requestsfor non-existent segments were queued'
  );
});

QUnit.skip('aborts segment processing on seek', function() {
  let currentTime = 0;

  this.player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.currentTime = function() {
    return currentTime;
  };
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange();
  };
  // media
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
    '#EXTINF:10,0\n' +
    '1.ts\n' +
    '#EXT-X-DISCONTINUITY\n' +
    '#EXTINF:10,0\n' +
    '2.ts\n' +
    '#EXT-X-ENDLIST\n'
  );
  // 1.ts
  Helper.standardXHRResponse(this.requests.shift());
  // key.php
  Helper.standardXHRResponse(this.requests.shift());
  QUnit.ok(this.player.tech_.hls.pendingSegment_, 'decrypting the segment');

  // seek back to the beginning
  this.player.currentTime(0);
  this.clock.tick(1);
  QUnit.ok(!this.player.tech_.hls.pendingSegment_, 'aborted processing');
});

QUnit.test('can seek before the source buffer opens', function() {
  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  Helper.standardXHRResponse(this.requests.shift());
  this.player.triggerReady();

  this.player.currentTime(1);
  QUnit.equal(this.player.currentTime(), 1, 'seeked');
});

QUnit.test('resets the switching algorithm if a request times out', function() {
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.hls.bandwidth = 1e20;

  // master
  Helper.standardXHRResponse(this.requests.shift());
  // media.m3u8
  Helper.standardXHRResponse(this.requests.shift());
  // simulate a segment timeout
  this.requests[0].timedout = true;
  // segment
  this.requests.shift().abort();

  Helper.standardXHRResponse(this.requests.shift());

  QUnit.strictEqual(this.player.tech_.hls.playlists.media(),
              this.player.tech_.hls.playlists.master.playlists[1],
              'reset to the lowest bitrate playlist');
});

QUnit.test('disposes the playlist loader', function() {
  let disposes = 0;
  let player;
  let loaderDispose;

  player = Helper.createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(player, this.clock);
  loaderDispose = player.tech_.hls.playlists.dispose;
  player.tech_.hls.playlists.dispose = function() {
    disposes++;
    loaderDispose.call(player.tech_.hls.playlists);
  };

  player.dispose();
  QUnit.strictEqual(disposes, 1, 'disposed playlist loader');
});

QUnit.test('remove event handlers on dispose', function() {
  let player;
  let unscoped = 0;

  player = Helper.createPlayer();
  player.on = function(owner) {
    if (typeof owner !== 'object') {
      unscoped++;
    }
  };
  player.off = function(owner) {
    if (typeof owner !== 'object') {
      unscoped--;
    }
  };
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(player, this.clock);

  Helper.standardXHRResponse(this.requests[0]);
  Helper.standardXHRResponse(this.requests[1]);

  player.dispose();

  QUnit.ok(unscoped <= 0, 'no unscoped handlers');
});

QUnit.test('the source handler supports HLS mime types', function() {
  ['html5', 'flash'].forEach(function(techName) {
    QUnit.ok(HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/x-MPegUrl'
    }), 'supports x-mpegurl');
    QUnit.ok(HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/VnD.aPPle.MpEgUrL'
    }), 'supports vnd.apple.mpegurl');
    QUnit.ok(
      HlsSourceHandler(techName).canPlayType('aPplicatiOn/VnD.aPPle.MpEgUrL'),
      'supports vnd.apple.mpegurl'
    );
    QUnit.ok(
      HlsSourceHandler(techName).canPlayType('aPplicatiOn/x-MPegUrl'),
      'supports x-mpegurl'
    );

    QUnit.ok(!(HlsSourceHandler(techName).canHandleSource({
      type: 'video/mp4'
    }) instanceof HlsHandler), 'does not support mp4');
    QUnit.ok(!(HlsSourceHandler(techName).canHandleSource({
      type: 'video/x-flv'
    }) instanceof HlsHandler), 'does not support flv');
    QUnit.ok(
      !(HlsSourceHandler(techName).canPlayType('video/mp4')),
      'does not support mp4'
    );
    QUnit.ok(
      !(HlsSourceHandler(techName).canPlayType('video/x-flv')),
      'does not support flv'
    );
  });
});

QUnit.test('fires loadstart manually if Flash is used', function() {
  let tech = new (videojs.extend(videojs.EventTarget, {
    buffered() {
      return videojs.createTimeRange();
    },
    currentTime() {
      return 0;
    },
    el() {
      return {};
    },
    preload() {
      return 'auto';
    },
    src() {},
    setTimeout: window.setTimeout
  }))();
  let loadstarts = 0;

  tech.on('loadstart', function() {
    loadstarts++;
  });
  HlsSourceHandler('flash').handleSource({
    src: 'movie.m3u8',
    type: 'application/x-mpegURL'
  }, tech);

  QUnit.equal(loadstarts, 0, 'loadstart is not synchronous');
  this.clock.tick(1);
  QUnit.equal(loadstarts, 1, 'fired loadstart');
});

QUnit.test('has no effect if native HLS is available', function() {
  let player;

  Hls.supportsNativeHls = () => true;
  player = Helper.createPlayer();
  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  QUnit.ok(!player.tech_.hls, 'did not load hls tech');
  player.dispose();
});

QUnit.test('is not supported on browsers without typed arrays', function() {
  let oldArray = window.Uint8Array;

  window.Uint8Array = null;
  QUnit.ok(!Hls.isSupported(), 'HLS is not supported');

  // cleanup
  window.Uint8Array = oldArray;
});

QUnit.test('re-emits mediachange events', function() {
  let mediaChanges = 0;

  this.player.on('mediachange', function() {
    mediaChanges++;
  });

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

  this.player.tech_.hls.playlists.trigger('mediachange');
  QUnit.strictEqual(mediaChanges, 1, 'fired mediachange');
});

QUnit.test('can be disposed before finishing initialization', function() {
  let readyHandlers = [];
  /* eslint-disable consistent-this */
  let self = this;
  /* eslint-enable consistent-this */

  this.player.ready = function(callback) {
    readyHandlers.push(callback);
  };
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.src({
    src: 'http://example.com/media.mp4',
    type: 'video/mp4'
  });
  QUnit.ok(readyHandlers.length > 0, 'registered a ready handler');
  try {
    while (readyHandlers.length) {
      readyHandlers.shift().call(self.player);
      Helper.openMediaSource(self.player, self.clock);
    }
    QUnit.ok(true, 'did not throw an exception');
  } catch (e) {
    QUnit.ok(false, 'threw an exception');
  }
});

QUnit.test('calling play() at the end of a video replays', function() {
  let seekTime = -1;

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
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
  Helper.standardXHRResponse(this.requests.shift());
  this.player.tech_.ended = function() {
    return true;
  };

  this.player.tech_.trigger('play');
  QUnit.equal(seekTime, 0, 'seeked to the beginning');
});

QUnit.skip('blacklists playlist if key this.requestsfail more than once', function() {
  let bytes = [];
  let media;

  this.player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');

  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
    '#EXTINF:2.833,\n' +
    'http://media.example.com/fileSequence52-A.ts\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
    '#EXTINF:15.0,\n' +
    'http://media.example.com/fileSequence53-A.ts\n'
  );
  this.player.tech_.hls.sourceBuffer.appendBuffer = function(chunk) {
    bytes.push(chunk);
  };

  media = this.player.tech_.hls.playlists.media_;

  // segment 1
  Helper.standardXHRResponse(this.requests.pop());
  // fail key
  this.requests.shift().respond(404);
  // fail key, again
  this.requests.shift().respond(404);
  this.player.tech_.hls.checkBuffer_();

  QUnit.ok(media.excludeUntil > 0,
        'playlist blacklisted');
});

QUnit.skip(
'treats invalid keys as a key request failure and blacklists playlist',
function() {
  let bytes = [];
  let media;

  this.player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:5\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
    '#EXTINF:2.833,\n' +
    'http://media.example.com/fileSequence52-A.ts\n' +
    '#EXT-X-KEY:METHOD=NONE\n' +
    '#EXTINF:15.0,\n' +
    'http://media.example.com/fileSequence52-B.ts\n'
  );
  this.player.tech_.hls.sourceBuffer.appendBuffer = function(chunk) {
    bytes.push(chunk);
  };

  media = this.player.tech_.hls.playlists.media_;
  // segment request
  Helper.standardXHRResponse(this.requests.pop());
  // keys should be 16 bytes long
  this.requests[0].response = new Uint8Array(1).buffer;
  this.requests.shift().respond(200, null, '');

  QUnit.equal(
    this.requests[0].url,
    'https://priv.example.com/key.php?r=52',
    'retries the key'
  );

  // the retried response is invalid, too
  this.requests[0].response = new Uint8Array(1);
  this.requests.shift().respond(200, null, '');
  this.player.tech_.hls.checkBuffer_();

  // two failed attempts is an error - blacklist this playlist
  QUnit.ok(media.excludeUntil > 0,
        'blacklisted playlist');
});

QUnit.test('seeking should abort an outstanding key request and create a new one',
function() {
  this.player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  Helper.openMediaSource(this.player, this.clock);

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
  // segment 1
  Helper.standardXHRResponse(this.requests.pop());

  this.player.currentTime(11);
  this.clock.tick(1);
  QUnit.ok(this.requests[0].aborted, 'the key XHR should be aborted');
  // aborted key 1
  this.requests.shift();

  QUnit.equal(this.requests.length, 2, 'requested the new key');
  QUnit.equal(this.requests[0].url,
              'https://example.com/' +
              this.player.tech_.hls.playlists.media().segments[1].key.uri,
              'urls should match');
});

QUnit.test('switching playlists with an outstanding key request aborts request and ' +
           'loads segment', function() {
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
  Helper.openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');

  // master playlist
  Helper.standardXHRResponse(this.requests.shift());
  // media playlist
  this.requests.shift().respond(200, null, media);
  // first segment of the original media playlist
  Helper.standardXHRResponse(this.requests.pop());

  QUnit.equal(this.requests.length, 1, 'key request only one outstanding');
  keyXhr = this.requests.shift();
  QUnit.ok(!keyXhr.aborted, 'key request outstanding');

  this.player.tech_.hls.playlists.trigger('mediachange');

  QUnit.ok(keyXhr.aborted, 'key request aborted');
  QUnit.equal(this.requests.length, 2, 'loaded key and segment');
  QUnit.equal(this.requests[0].url, 'https://priv.example.com/key.php?r=52',
              'requested the key');
  QUnit.equal(this.requests[1].url, 'http://media.example.com/fileSequence52-A.ts',
              'requested the segment');
});

QUnit.test('does not download segments if preload option set to none', function() {
  this.player.preload('none');
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  Helper.openMediaSource(this.player, this.clock);
  // master
  Helper.standardXHRResponse(this.requests.shift());
  // media
  Helper.standardXHRResponse(this.requests.shift());
  this.clock.tick(10 * 1000);

  this.requests = this.requests.filter(function(request) {
    return !(/m3u8$/).QUnit.test(request.uri);
  });
  QUnit.equal(this.requests.length, 0, 'did not download any segments');
});

QUnit.module('HLS:integration', {
  beforeEach() {
    let fakeEnvironment = Helper.useFakeEnvironment();

    this.requests = fakeEnvironment.requests;
    this.clock = fakeEnvironment.clock;
    this.tech = new (videojs.getTech('Html5'))({});
  },
  afterEach() {
    Helper.restoreEnvironment();
  }
});

QUnit.test('updates the segment loader on media changes', function() {
  let updates = [];
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');

  hls.bandwidth = 1;
  // master
  Helper.standardXHRResponse(this.requests.shift());
  // media
  Helper.standardXHRResponse(this.requests.shift());
  hls.segments.playlist = function(update) {
    updates.push(update);
  };

  // downloading the new segment will update bandwidth and cause a
  // playlist change
  // segment 0
  Helper.standardXHRResponse(this.requests.shift());
  hls.mediaSource.sourceBuffers[0].trigger('updateend');
  // media
  Helper.standardXHRResponse(this.requests.shift());
  QUnit.equal(updates.length, 1, 'updated the segment list');
});

QUnit.test('aborts all in-flight work when disposed', function() {
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');
  // master
  Helper.standardXHRResponse(this.requests.shift());
  // media
  Helper.standardXHRResponse(this.requests.shift());

  hls.dispose();
  QUnit.ok(this.requests[0].aborted, 'aborted the old segment request');
  QUnit.equal(hls.mediaSource.readyState, 'closed', 'closed the media source');
});

QUnit.test('selects a playlist after segment downloads', function() {
  let calls = 0;
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');
  // Must mock appendBuffer or else source-updater gets stuck in updating state
  hls.mediaSource.sourceBuffers[0].appendBuffer = function() {};
  hls.selectPlaylist = function() {
    calls++;
    return hls.playlists.master.playlists[0];
  };

  // master
  Helper.standardXHRResponse(this.requests[0]);
  // media
  Helper.standardXHRResponse(this.requests[1]);

  // segment
  Helper.standardXHRResponse(this.requests[2]);
  hls.mediaSource.sourceBuffers[0].trigger('updateend');
  QUnit.strictEqual(calls, 2, 'selects after the initial segment');

  // segment
  Helper.standardXHRResponse(this.requests[3]);
  hls.mediaSource.sourceBuffers[0].trigger('updateend');
  QUnit.strictEqual(calls, 3, 'selects after additional segments');
});

QUnit.test('updates the duration after switching playlists', function() {
  let selectedPlaylist = false;
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');

  hls.bandwidth = 1e20;
  // master
  Helper.standardXHRResponse(this.requests[0]);
  // media3
  Helper.standardXHRResponse(this.requests[1]);

  hls.selectPlaylist = function() {
    selectedPlaylist = true;

    // this duration should be overwritten by the playlist change
    hls.mediaSource = {
      duration: 0,
      readyState: 'open'
    };

    return hls.playlists.master.playlists[1];
  };

  // segment 0
  Helper.standardXHRResponse(this.requests[2]);
  hls.mediaSource.sourceBuffers[0].trigger('updateend');
  // media1
  Helper.standardXHRResponse(this.requests[3]);
  QUnit.ok(selectedPlaylist, 'selected playlist');
  QUnit.ok(hls.mediaSource.duration !== 0, 'updates the duration');
});

QUnit.test('downloads additional playlists if required', function() {
  let originalPlaylist;
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');

  hls.bandwidth = 1;
  // master
  Helper.standardXHRResponse(this.requests[0]);
  // media
  Helper.standardXHRResponse(this.requests[1]);
  originalPlaylist = hls.playlists.media();

  // the playlist selection is revisited after a new segment is downloaded
  this.requests[2].bandwidth = 3000000;
  // segment
  Helper.standardXHRResponse(this.requests[2]);
  hls.mediaSource.sourceBuffers[0].trigger('updateend');

  // new media
  Helper.standardXHRResponse(this.requests[3]);

  QUnit.ok((/manifest\/media\d+.m3u8$/).test(this.requests[3].url),
           'made a playlist request');
  QUnit.notEqual(originalPlaylist.resolvedUri,
           hls.playlists.media().resolvedUri,
           'a new playlists was selected');
  QUnit.ok(hls.playlists.media().segments, 'segments are now available');
});

QUnit.test(
'waits to download new segments until the media playlist is stable',
function() {
  let sourceBuffer;
  let hls = HlsSourceHandler('html5').handleSource({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  }, this.tech);

  hls.mediaSource.trigger('sourceopen');
  sourceBuffer = hls.mediaSource.sourceBuffers[0];

  // make sure we stay on the lowest variant
  hls.bandwidth = 1;
  // master
  Helper.standardXHRResponse(this.requests.shift());
  // media1
  Helper.standardXHRResponse(this.requests.shift());

  // force a playlist switch
  hls.playlists.media('media3.m3u8');

  // segment 0
  Helper.standardXHRResponse(this.requests.shift());
  sourceBuffer.trigger('updateend');

  QUnit.equal(this.requests.length, 1, 'only the playlist request outstanding');
  this.clock.tick(10 * 1000);
  QUnit.equal(this.requests.length, 1, 'delays segment fetching');

  // media3
  Helper.standardXHRResponse(this.requests.shift());
  this.clock.tick(10 * 1000);
  QUnit.equal(this.requests.length, 1, 'resumes segment fetching');
});

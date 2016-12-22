import QUnit from 'qunit';
import videojs from 'video.js';
import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  standardXHRResponse,
  openMediaSource
} from './test-helpers.js';
import manifests from './test-manifests.js';
import {
  MasterPlaylistController,
  mimeTypesForPlaylist_,
  mapLegacyAvcCodecs_
} from '../src/master-playlist-controller';
/* eslint-disable no-unused-vars */
// we need this so that it can register hls with videojs
import { Hls } from '../src/videojs-contrib-hls';
/* eslint-enable no-unused-vars */
import Playlist from '../src/playlist';

QUnit.module('MasterPlaylistController', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();

    // force the HLS tech to run
    this.origSupportsNativeHls = videojs.Hls.supportsNativeHls;
    videojs.Hls.supportsNativeHls = false;
    this.oldFirefox = videojs.browser.IS_FIREFOX;
    this.player = createPlayer();
    this.player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
    videojs.Hls.supportsNativeHls = this.origSupportsNativeHls;
    videojs.browser.IS_FIREFOX = this.oldFirefox;
    this.player.dispose();
  }
});

QUnit.test('throws error when given an empty URL', function(assert) {
  let options = {
    url: 'test',
    tech: this.player.tech_
  };

  assert.ok(new MasterPlaylistController(options), 'can create with options');

  options.url = '';
  assert.throws(() => {
    new MasterPlaylistController(options); // eslint-disable-line no-new
  }, /A non-empty playlist URL is required/, 'requires a non empty url');
});

QUnit.test('obeys none preload option', function(assert) {
  this.player.preload('none');
  // master
  standardXHRResponse(this.requests.shift());
  // playlist
  standardXHRResponse(this.requests.shift());

  openMediaSource(this.player, this.clock);

  assert.equal(this.requests.length, 0, 'no segment requests');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('obeys auto preload option', function(assert) {
  this.player.preload('auto');
  // master
  standardXHRResponse(this.requests.shift());
  // playlist
  standardXHRResponse(this.requests.shift());

  openMediaSource(this.player, this.clock);

  assert.equal(this.requests.length, 1, '1 segment request');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('obeys metadata preload option', function(assert) {
  this.player.preload('metadata');
  // master
  standardXHRResponse(this.requests.shift());
  // playlist
  standardXHRResponse(this.requests.shift());

  openMediaSource(this.player, this.clock);

  assert.equal(this.requests.length, 1, '1 segment request');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('resyncs SegmentLoader for a fast quality change', function(assert) {
  let resyncs = 0;

  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  let segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  segmentLoader.resyncLoader = function() {
    resyncs++;
  };

  this.masterPlaylistController.selectPlaylist = () => {
    return this.masterPlaylistController.master().playlists[0];
  };

  this.masterPlaylistController.fastQualityChange_();

  assert.equal(resyncs, 1, 'resynced the segmentLoader');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('does not resync the segmentLoader when no fast quality change occurs',
  function(assert) {
    let resyncs = 0;

    // master
    standardXHRResponse(this.requests.shift());
    // media
    standardXHRResponse(this.requests.shift());
    this.masterPlaylistController.mediaSource.trigger('sourceopen');

    let segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

    segmentLoader.resyncLoader = function() {
      resyncs++;
    };

    this.masterPlaylistController.fastQualityChange_();

    assert.equal(resyncs, 0, 'did not resync the segmentLoader');
    // verify stats
    assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
  });

QUnit.test('if buffered, will request second segment byte range', function(assert) {
  this.requests.length = 0;
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

  // mock that the user has played the video before
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.trigger('play');
  this.player.tech_.paused_ = false;
  this.player.tech_.played = () => videojs.createTimeRanges([[0, 20]]);

  openMediaSource(this.player, this.clock);
  // playlist
  standardXHRResponse(this.requests[0]);

  this.masterPlaylistController.mainSegmentLoader_.sourceUpdater_.buffered = () => {
    return videojs.createTimeRanges([[0, 20]]);
  };
  // 1ms have passed to upload 1kb that gives us a bandwidth of 1024 / 1 * 8 * 1000 = 8192000
  this.clock.tick(1);
  // segment
  standardXHRResponse(this.requests[1]);
  this.masterPlaylistController.mainSegmentLoader_.fetchAtBuffer_ = true;
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  this.clock.tick(10 * 1000);
  assert.equal(this.requests[2].headers.Range, 'bytes=522828-1110327');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 8192000, 'Live stream');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
               1024,
               '1024 bytes downloaded');
});

QUnit.test('re-initializes the combined playlist loader when switching sources',
function(assert) {
  openMediaSource(this.player, this.clock);
  // master
  standardXHRResponse(this.requests.shift());
  // playlist
  standardXHRResponse(this.requests.shift());
  // segment
  standardXHRResponse(this.requests.shift());
  // change the source
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;
  // maybe not needed if https://github.com/videojs/video.js/issues/2326 gets fixed
  this.clock.tick(1);
  assert.ok(!this.masterPlaylistController.masterPlaylistLoader_.media(),
           'no media playlist');
  assert.equal(this.masterPlaylistController.masterPlaylistLoader_.state,
              'HAVE_NOTHING',
              'reset the playlist loader state');
  assert.equal(this.requests.length, 1, 'requested the new src');

  // buffer check
  this.clock.tick(10 * 1000);
  assert.equal(this.requests.length, 1, 'did not request a stale segment');

  // sourceopen
  openMediaSource(this.player, this.clock);

  assert.equal(this.requests.length, 1, 'made one request');
  assert.ok(
    this.requests[0].url.indexOf('master.m3u8') >= 0,
      'requested only the new playlist'
  );
});

QUnit.test('updates the combined segment loader on live playlist refreshes', function(assert) {
  let updates = [];

  openMediaSource(this.player, this.clock);
  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());

  this.masterPlaylistController.mainSegmentLoader_.playlist = function(update) {
    updates.push(update);
  };

  this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');
  assert.equal(updates.length, 1, 'updated the segment list');
  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test(
'fires a progress event after downloading a segment from combined segment loader',
function(assert) {
  let progressCount = 0;

  openMediaSource(this.player, this.clock);

  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());

  this.player.tech_.on('progress', function() {
    progressCount++;
  });
  // 1ms have passed to upload 1kb that gives us a bandwidth of 1024 / 1 * 8 * 1000 = 8192000
  this.clock.tick(1);
  // segment
  standardXHRResponse(this.requests.shift());
  this.masterPlaylistController.mainSegmentLoader_.trigger('progress');
  assert.equal(progressCount, 1, 'fired a progress event');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 8192000, 'Live stream');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
               1024,
               '1024 bytes downloaded');
});

QUnit.test('updates the enabled track when switching audio groups', function(assert) {
  openMediaSource(this.player, this.clock);
  // master
  this.requests.shift().respond(200, null,
                                manifests.multipleAudioGroupsCombinedMain);
  // media
  standardXHRResponse(this.requests.shift());
  // init segment
  standardXHRResponse(this.requests.shift());
  // video segment
  standardXHRResponse(this.requests.shift());
  // audio media
  standardXHRResponse(this.requests.shift());
  // ignore audio segment requests
  this.requests.length = 0;

  let mpc = this.masterPlaylistController;
  let combinedPlaylist = mpc.master().playlists[0];

  mpc.masterPlaylistLoader_.media(combinedPlaylist);
  // updated media
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:5.0\n' +
                                '0.ts\n' +
                                '#EXT-X-ENDLIST\n');

  assert.ok(mpc.activeAudioGroup().filter((track) => track.enabled)[0],
           'enabled a track in the new audio group');
});

QUnit.test('blacklists switching from video+audio playlists to audio only', function(assert) {
  let audioPlaylist;

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e10;

  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                                'media1.m3u8\n');
  // media1
  standardXHRResponse(this.requests.shift());

  assert.equal(this.masterPlaylistController.masterPlaylistLoader_.media(),
              this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1],
              'selected video+audio');
  audioPlaylist = this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0];
  assert.equal(audioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1e10, 'bandwidth we set above');
});

QUnit.test('blacklists switching from audio-only playlists to video+audio', function(assert) {
  let videoAudioPlaylist;

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                                'media1.m3u8\n');

  // media1
  standardXHRResponse(this.requests.shift());
  assert.equal(this.masterPlaylistController.masterPlaylistLoader_.media(),
              this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0],
              'selected audio only');
  videoAudioPlaylist =
    this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1];
  assert.equal(videoAudioPlaylist.excludeUntil,
              Infinity,
              'excluded incompatible playlist');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth we set above');
});

QUnit.test('blacklists switching from video-only playlists to video+audio', function(assert) {
  let videoAudioPlaylist;

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media1.m3u8\n');

  // media
  standardXHRResponse(this.requests.shift());
  assert.equal(this.masterPlaylistController.masterPlaylistLoader_.media(),
              this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0],
              'selected video only');
  videoAudioPlaylist =
    this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1];
  assert.equal(videoAudioPlaylist.excludeUntil,
              Infinity,
              'excluded incompatible playlist');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth we set above');
});

QUnit.test('blacklists switching between playlists with incompatible audio codecs',
function(assert) {
  let alternatePlaylist;

  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media1.m3u8\n');

  // media
  standardXHRResponse(this.requests.shift());
  assert.equal(this.masterPlaylistController.masterPlaylistLoader_.media(),
              this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0],
              'selected HE-AAC stream');
  alternatePlaylist =
    this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1];
  assert.equal(alternatePlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth we set above');
});

QUnit.test('blacklists the current playlist when audio changes in Firefox 48 & below',
  function(assert) {
    videojs.browser.IS_FIREFOX = true;

    let origSupportsAudioInfoChange_ = videojs.Hls.supportsAudioInfoChange_;

    videojs.Hls.supportsAudioInfoChange_ = () => false;

    // master
    standardXHRResponse(this.requests.shift());
    // media
    standardXHRResponse(this.requests.shift());

    let media = this.masterPlaylistController.media();

    // initial audio config
    this.masterPlaylistController.mediaSource.trigger({
      type: 'audioinfo',
      info: {}
    });
    // updated audio config

    this.masterPlaylistController.mediaSource.trigger({
      type: 'audioinfo',
      info: {
        different: true
      }
    });
    assert.ok(media.excludeUntil > 0, 'blacklisted the old playlist');
    assert.equal(this.env.log.warn.callCount, 2, 'logged two warnings');
    this.env.log.warn.callCount = 0;
    videojs.Hls.supportsAudioInfoChange_ = origSupportsAudioInfoChange_;
  });

QUnit.test('updates the combined segment loader on media changes', function(assert) {
  let updates = [];

  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  this.masterPlaylistController.mainSegmentLoader_.bandwidth = 1;

  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());

  this.masterPlaylistController.mainSegmentLoader_.playlist = function(update) {
    updates.push(update);
  };
  // 1ms have passed to upload 1kb that gives us a bandwidth of 1024 / 1 * 8 * 1000 = 8192000
  this.clock.tick(1);

  // downloading the new segment will update bandwidth and cause a
  // playlist change
  // segment 0
  standardXHRResponse(this.requests.shift());
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  // media
  standardXHRResponse(this.requests.shift());
  assert.ok(updates.length > 0, 'updated the segment list');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 8192000, 'Live stream');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
               1024,
               '1024 bytes downloaded');
});

QUnit.test('selects a playlist after main/combined segment downloads', function(assert) {
  let calls = 0;

  this.masterPlaylistController.selectPlaylist = () => {
    calls++;
    return this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0];
  };
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());

  // "downloaded" a segment
  this.masterPlaylistController.mainSegmentLoader_.trigger('progress');
  assert.strictEqual(calls, 2, 'selects after the initial segment');

  // and another
  this.masterPlaylistController.mainSegmentLoader_.trigger('progress');
  assert.strictEqual(calls, 3, 'selects after additional segments');
  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('updates the duration after switching playlists', function(assert) {
  let selectedPlaylist = false;

  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  this.masterPlaylistController.bandwidth = 1e20;

  // master
  standardXHRResponse(this.requests[0]);
  // media
  standardXHRResponse(this.requests[1]);

  this.masterPlaylistController.selectPlaylist = () => {
    selectedPlaylist = true;

    // this duration should be overwritten by the playlist change
    this.masterPlaylistController.mediaSource.duration = 0;
    this.masterPlaylistController.mediaSource.readyState = 'open';

    return this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1];
  };
  // 1ms have passed to upload 1kb that gives us a bandwidth of 1024 / 1 * 8 * 1000 = 8192000
  this.clock.tick(1);
  // segment 0
  standardXHRResponse(this.requests[2]);
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  // media1
  standardXHRResponse(this.requests[3]);
  assert.ok(selectedPlaylist, 'selected playlist');
  assert.ok(this.masterPlaylistController.mediaSource.duration !== 0,
           'updates the duration');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 8192000, 'Live stream');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
               1024,
               '1024 bytes downloaded');
});

QUnit.test('playlist selection uses systemBandwidth', function(assert) {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');
  this.player.width(1000);
  this.player.height(900);

  // master
  standardXHRResponse(this.requests[0]);
  // media
  standardXHRResponse(this.requests[1]);
  assert.ok(/media3\.m3u8/i.test(this.requests[1].url), 'Selected the highest rendition');

  // 1ms have passed to upload 1kb that gives us a bandwidth of 1024 / 1 * 8 * 1000 = 8192000
  this.clock.tick(1);
  // segment 0
  standardXHRResponse(this.requests[2]);
  // 20ms have passed to upload 1kb that gives us a throughput of 1024 / 20 * 8 * 1000 = 409600
  this.clock.tick(20);
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  // systemBandwidth is 1 / (1 / 8192000 + 1 / 409600) = ~390095

  // media1
  standardXHRResponse(this.requests[3]);
  assert.ok(/media\.m3u8/i.test(this.requests[3].url), 'Selected the rendition < 390095');

  assert.ok(this.masterPlaylistController.mediaSource.duration !== 0,
           'updates the duration');

  // verify stats
  assert.equal(this.player.tech_.hls.stats.bandwidth, 8192000, 'Live stream');
  assert.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  assert.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
               1024,
               '1024 bytes downloaded');
});

QUnit.test('removes request timeout when segment timesout on lowest rendition',
function(assert) {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  // master
  standardXHRResponse(this.requests[0]);
  // media
  standardXHRResponse(this.requests[1]);

  assert.equal(this.masterPlaylistController.requestOptions_.timeout,
              this.masterPlaylistController.masterPlaylistLoader_.targetDuration * 1.5 *
              1000,
              'default request timeout');

  assert.ok(!this.masterPlaylistController
            .masterPlaylistLoader_
            .isLowestEnabledRendition_(), 'Not lowest rendition');

  // Cause segment to timeout to force player into lowest rendition
  this.requests[2].timedout = true;

  // Downloading segment should cause media change and timeout removal
  // segment 0
  standardXHRResponse(this.requests[2]);
  // Download new segment after media change
  standardXHRResponse(this.requests[3]);

  assert.ok(this.masterPlaylistController
            .masterPlaylistLoader_.isLowestEnabledRendition_(), 'On lowest rendition');

  assert.equal(this.masterPlaylistController.requestOptions_.timeout, 0,
              'request timeout 0');
});

QUnit.test('seekable uses the intersection of alternate audio and combined tracks',
function(assert) {
  let origSeekable = Playlist.seekable;
  let mpc = this.masterPlaylistController;
  let mainMedia = {};
  let audioMedia = {};
  let mainTimeRanges = [];
  let audioTimeRanges = [];
  let assertTimeRangesEqual = (left, right, message) => {
    if (left.length === 0 && right.length === 0) {
      return;
    }

    assert.equal(left.length, 1, message);
    assert.equal(right.length, 1, message);

    assert.equal(left.start(0), right.start(0), message);
    assert.equal(left.end(0), right.end(0), message);
  };

  this.masterPlaylistController.masterPlaylistLoader_.media = () => mainMedia;

  Playlist.seekable = (media) => {
    if (media === mainMedia) {
      return videojs.createTimeRanges(mainTimeRanges);
    }
    return videojs.createTimeRanges(audioTimeRanges);
  };

  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges(),
                        'empty when main empty');
  mainTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[0, 10]]),
                        'main when no audio');

  mpc.audioPlaylistLoader_ = {
    media: () => audioMedia,
    dispose() {},
    expired_: 0
  };
  mainTimeRanges = [];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();

  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges(),
                        'empty when both empty');
  mainTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges(),
                        'empty when audio empty');
  mainTimeRanges = [];
  audioTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges(),
                        'empty when main empty');
  mainTimeRanges = [[0, 10]];
  audioTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[0, 10]]),
                        'ranges equal');
  mainTimeRanges = [[5, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[5, 10]]),
                        'main later start');
  mainTimeRanges = [[0, 10]];
  audioTimeRanges = [[5, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[5, 10]]),
                        'audio later start');
  mainTimeRanges = [[0, 9]];
  audioTimeRanges = [[0, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[0, 9]]),
                        'main earlier end');
  mainTimeRanges = [[0, 10]];
  audioTimeRanges = [[0, 9]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[0, 9]]),
                        'audio earlier end');
  mainTimeRanges = [[1, 10]];
  audioTimeRanges = [[0, 9]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[1, 9]]),
                        'main later start, audio earlier end');
  mainTimeRanges = [[0, 9]];
  audioTimeRanges = [[1, 10]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[1, 9]]),
                        'audio later start, main earlier end');
  mainTimeRanges = [[2, 9]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[2, 9]]),
                        'main later start, main earlier end');
  mainTimeRanges = [[1, 10]];
  audioTimeRanges = [[2, 9]];
  mpc.seekable_ = videojs.createTimeRanges();
  mpc.onSyncInfoUpdate_();
  assertTimeRangesEqual(mpc.seekable(),
                        videojs.createTimeRanges([[2, 9]]),
                        'audio later start, audio earlier end');

  Playlist.seekable = origSeekable;
});

QUnit.test('calls to update cues on new media', function(assert) {
  let origHlsOptions = videojs.options.hls;

  videojs.options.hls = {
    useCueTags: true
  };

  this.player = createPlayer();
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

  let callCount = 0;

  this.masterPlaylistController.updateAdCues_ = (media) => callCount++;

  // master
  standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 0, 'no call to update cues on master');

  // media
  standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 1, 'calls to update cues on first media');

  this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');

  assert.equal(callCount, 2, 'calls to update cues on subsequent media');

  videojs.options.hls = origHlsOptions;
});

QUnit.test('calls to update cues on media when no master', function(assert) {
  this.requests.length = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;
  this.masterPlaylistController.useCueTags_ = true;

  let callCount = 0;

  this.masterPlaylistController.updateAdCues_ = (media) => callCount++;

  // media
  standardXHRResponse(this.requests.shift());

  assert.equal(callCount, 1, 'calls to update cues on first media');

  this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');

  assert.equal(callCount, 2, 'calls to update cues on subsequent media');
});

QUnit.test('respects useCueTags option', function(assert) {
  let origHlsOptions = videojs.options.hls;

  videojs.options.hls = {
    useCueTags: true
  };

  this.player = createPlayer();
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.masterPlaylistController = this.player.tech_.hls.masterPlaylistController_;

  assert.ok(this.masterPlaylistController.cueTagsTrack_,
           'creates cueTagsTrack_ if useCueTags is truthy');
  assert.equal(this.masterPlaylistController.cueTagsTrack_.label,
              'ad-cues',
              'cueTagsTrack_ has label of ad-cues');
  assert.equal(this.player.textTracks()[0], this.masterPlaylistController.cueTagsTrack_,
           'adds cueTagsTrack as a text track if useCueTags is truthy');

  videojs.options.hls = origHlsOptions;
});

QUnit.module('Codec to MIME Type Conversion');

QUnit.test('recognizes muxed codec configurations', function(assert) {
  assert.deepEqual(mimeTypesForPlaylist_({ mediaGroups: {} }, {}),
                  [ 'video/mp2t; codecs="avc1.4d400d, mp4a.40.2"' ],
                  'returns a default MIME type when no codecs are present');

  assert.deepEqual(mimeTypesForPlaylist_({
    mediaGroups: {},
    playlists: []
  }, {
    attributes: {
      CODECS: 'mp4a.40.E,avc1.deadbeef'
    }
  }), [
    'video/mp2t; codecs="avc1.deadbeef, mp4a.40.E"'
  ], 'returned the parsed muxed type');
});

QUnit.test('recognizes mixed codec configurations', function(assert) {
  assert.deepEqual(mimeTypesForPlaylist_({
    mediaGroups: {
      AUDIO: {
        hi: {
          en: {},
          es: {
            uri: 'http://example.com/alt-audio.m3u8'
          }
        }
      }
    },
    playlists: []
  }, {
    attributes: {
      AUDIO: 'hi'
    }
  }), [
    'video/mp2t; codecs="avc1.4d400d, mp4a.40.2"',
    'audio/mp2t; codecs="mp4a.40.2"'
  ], 'returned a default muxed type with alternate audio');

  assert.deepEqual(mimeTypesForPlaylist_({
    mediaGroups: {
      AUDIO: {
        hi: {
          eng: {},
          es: {
            uri: 'http://example.com/alt-audio.m3u8'
          }
        }
      }
    },
    playlists: []
  }, {
    attributes: {
      CODECS: 'mp4a.40.E,avc1.deadbeef',
      AUDIO: 'hi'
    }
  }), [
    'video/mp2t; codecs="avc1.deadbeef, mp4a.40.E"',
    'audio/mp2t; codecs="mp4a.40.E"'
  ], 'returned a parsed muxed type with alternate audio');
});

QUnit.test('recognizes unmuxed codec configurations', function(assert) {
  assert.deepEqual(mimeTypesForPlaylist_({
    mediaGroups: {
      AUDIO: {
        hi: {
          eng: {
            uri: 'http://example.com/eng.m3u8'
          },
          es: {
            uri: 'http://example.com/eng.m3u8'
          }
        }
      }
    },
    playlists: []
  }, {
    attributes: {
      AUDIO: 'hi'
    }
  }), [
    'video/mp2t; codecs="avc1.4d400d"',
    'audio/mp2t; codecs="mp4a.40.2"'
  ], 'returned default unmuxed types');

  assert.deepEqual(mimeTypesForPlaylist_({
    mediaGroups: {
      AUDIO: {
        hi: {
          eng: {
            uri: 'http://example.com/alt-audio.m3u8'
          },
          es: {
            uri: 'http://example.com/eng.m3u8'
          }
        }
      }
    },
    playlists: []
  }, {
    attributes: {
      CODECS: 'mp4a.40.E,avc1.deadbeef',
      AUDIO: 'hi'
    }
  }), [
    'video/mp2t; codecs="avc1.deadbeef"',
    'audio/mp2t; codecs="mp4a.40.E"'
  ], 'returned parsed unmuxed types');
});

QUnit.module('Map Legacy AVC Codec');

QUnit.test('maps legacy AVC codecs', function(assert) {
  assert.equal(mapLegacyAvcCodecs_('avc1.deadbeef'),
               'avc1.deadbeef',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('avc1.dead.beef, mp4a.something'),
               'avc1.dead.beef, mp4a.something',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('avc1.dead.beef,mp4a.something'),
               'avc1.dead.beef,mp4a.something',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('mp4a.something,avc1.dead.beef'),
               'mp4a.something,avc1.dead.beef',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('mp4a.something, avc1.dead.beef'),
               'mp4a.something, avc1.dead.beef',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('avc1.42001e'),
               'avc1.42001e',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('avc1.4d0020,mp4a.40.2'),
               'avc1.4d0020,mp4a.40.2',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('mp4a.40.2,avc1.4d0020'),
               'mp4a.40.2,avc1.4d0020',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('mp4a.40.40'),
               'mp4a.40.40',
               'does nothing for non video codecs');

  assert.equal(mapLegacyAvcCodecs_('avc1.66.30'),
               'avc1.42001e',
               'translates legacy video codec alone');
  assert.equal(mapLegacyAvcCodecs_('avc1.66.30, mp4a.40.2'),
               'avc1.42001e, mp4a.40.2',
               'translates legacy video codec when paired with audio');
  assert.equal(mapLegacyAvcCodecs_('mp4a.40.2, avc1.66.30'),
               'mp4a.40.2, avc1.42001e',
               'translates video codec when specified second');
});

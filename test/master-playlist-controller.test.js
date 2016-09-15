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
  mimeTypesForPlaylist_
} from '../src/master-playlist-controller';
/* eslint-disable no-unused-vars */
// we need this so that it can register hls with videojs
import { Hls } from '../src/videojs-contrib-hls';
/* eslint-enable no-unused-vars */
import Playlist from '../src/playlist';

QUnit.module('MasterPlaylistController', {
  beforeEach() {
    this.env = useFakeEnvironment();
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();

    // force the HLS tech to run
    this.origSupportsNativeHls = videojs.Hls.supportsNativeHls;
    videojs.Hls.supportsNativeHls = false;

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
    this.player.dispose();
  }
});

QUnit.test('throws error when given an empty URL', function() {
  let options = {
    url: 'test',
    tech: this.player.tech_
  };

  QUnit.ok(new MasterPlaylistController(options), 'can create with options');

  options.url = '';
  QUnit.throws(() => {
    new MasterPlaylistController(options); // eslint-disable-line no-new
  }, /A non-empty playlist URL is required/, 'requires a non empty url');
});

QUnit.test('obeys none preload option', function() {
  this.player.preload('none');
  // master
  standardXHRResponse(this.requests.shift());
  // playlist
  standardXHRResponse(this.requests.shift());

  openMediaSource(this.player, this.clock);

  QUnit.equal(this.requests.length, 0, 'no segment requests');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('obeys auto preload option', function() {
  this.player.preload('auto');
  // master
  standardXHRResponse(this.requests.shift());
  // playlist
  standardXHRResponse(this.requests.shift());

  openMediaSource(this.player, this.clock);

  QUnit.equal(this.requests.length, 1, '1 segment request');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('obeys metadata preload option', function() {
  this.player.preload('metadata');
  // master
  standardXHRResponse(this.requests.shift());
  // playlist
  standardXHRResponse(this.requests.shift());

  openMediaSource(this.player, this.clock);

  QUnit.equal(this.requests.length, 1, '1 segment request');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('clears some of the buffer for a fast quality change', function() {
  let removes = [];

  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  let segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  segmentLoader.sourceUpdater_.remove = function(start, end) {
    removes.push({ start, end });
  };
  this.masterPlaylistController.selectPlaylist = () => {
    return this.masterPlaylistController.master().playlists[0];
  };
  this.masterPlaylistController.tech_.currentTime = () => 7;

  this.masterPlaylistController.fastQualityChange_();

  QUnit.equal(removes.length, 1, 'removed buffered content');
  QUnit.equal(removes[0].start, 7 + 5, 'removed from a bit after current time');
  QUnit.equal(removes[0].end, Infinity, 'removed to the end');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('does not clear the buffer when no fast quality change occurs', function() {
  let removes = [];

  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  let segmentLoader = this.masterPlaylistController.mainSegmentLoader_;

  segmentLoader.sourceUpdater_.remove = function(start, end) {
    removes.push({ start, end });
  };

  this.masterPlaylistController.fastQualityChange_();

  QUnit.equal(removes.length, 0, 'did not remove content');
  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('if buffered, will request second segment byte range', function() {
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
  this.player.tech_.played = () => videojs.createTimeRanges([[0, 20]]);

  openMediaSource(this.player, this.clock);
  // playlist
  standardXHRResponse(this.requests[0]);

  this.masterPlaylistController.mainSegmentLoader_.sourceUpdater_.buffered = () => {
    return videojs.createTimeRanges([[0, 20]]);
  };

  // segment
  standardXHRResponse(this.requests[1]);
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  this.clock.tick(10 * 1000);
  QUnit.equal(this.requests[2].headers.Range, 'bytes=1823412-2299991');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, Infinity, 'Live stream');
  QUnit.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  QUnit.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
              16,
              '16 bytes downloaded');
});

QUnit.test('re-initializes the combined playlist loader when switching sources',
function() {
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
  QUnit.ok(!this.masterPlaylistController.masterPlaylistLoader_.media(),
           'no media playlist');
  QUnit.equal(this.masterPlaylistController.masterPlaylistLoader_.state,
              'HAVE_NOTHING',
              'reset the playlist loader state');
  QUnit.equal(this.requests.length, 1, 'requested the new src');

  // buffer check
  this.clock.tick(10 * 1000);
  QUnit.equal(this.requests.length, 1, 'did not request a stale segment');

  // sourceopen
  openMediaSource(this.player, this.clock);

  QUnit.equal(this.requests.length, 1, 'made one request');
  QUnit.ok(
    this.requests[0].url.indexOf('master.m3u8') >= 0,
      'requested only the new playlist'
  );
});

QUnit.test('updates the combined segment loader on live playlist refreshes', function() {
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
  QUnit.equal(updates.length, 1, 'updated the segment list');
  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test(
'fires a progress event after downloading a segment from combined segment loader',
function() {
  let progressCount = 0;

  openMediaSource(this.player, this.clock);

  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());

  this.player.tech_.on('progress', function() {
    progressCount++;
  });

  // segment
  standardXHRResponse(this.requests.shift());
  this.masterPlaylistController.mainSegmentLoader_.trigger('progress');
  QUnit.equal(progressCount, 1, 'fired a progress event');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, Infinity, 'Live stream');
  QUnit.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  QUnit.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
              16,
              '16 bytes downloaded');
});

QUnit.test('updates the enabled track when switching audio groups', function() {
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

  QUnit.ok(mpc.activeAudioGroup().filter((track) => track.enabled)[0],
           'enabled a track in the new audio group');
});

QUnit.test('blacklists switching from video+audio playlists to audio only', function() {
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

  QUnit.equal(this.masterPlaylistController.masterPlaylistLoader_.media(),
              this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1],
              'selected video+audio');
  audioPlaylist = this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0];
  QUnit.equal(audioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 1e10, 'bandwidth we set above');
});

QUnit.test('blacklists switching from audio-only playlists to video+audio', function() {
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
  QUnit.equal(this.masterPlaylistController.masterPlaylistLoader_.media(),
              this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0],
              'selected audio only');
  videoAudioPlaylist =
    this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1];
  QUnit.equal(videoAudioPlaylist.excludeUntil,
              Infinity,
              'excluded incompatible playlist');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth we set above');
});

QUnit.test('blacklists switching from video-only playlists to video+audio', function() {
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
  QUnit.equal(this.masterPlaylistController.masterPlaylistLoader_.media(),
              this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0],
              'selected video only');
  videoAudioPlaylist =
    this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1];
  QUnit.equal(videoAudioPlaylist.excludeUntil,
              Infinity,
              'excluded incompatible playlist');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth we set above');
});

QUnit.test('blacklists switching between playlists with incompatible audio codecs',
function() {
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
  QUnit.equal(this.masterPlaylistController.masterPlaylistLoader_.media(),
              this.masterPlaylistController.masterPlaylistLoader_.master.playlists[0],
              'selected HE-AAC stream');
  alternatePlaylist =
    this.masterPlaylistController.masterPlaylistLoader_.master.playlists[1];
  QUnit.equal(alternatePlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 1, 'bandwidth we set above');
});

QUnit.test('blacklists the current playlist when audio changes in Firefox', function() {
  videojs.browser.IS_FIREFOX = true;

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
  QUnit.ok(media.excludeUntil > 0, 'blacklisted the old playlist');
  QUnit.equal(this.env.log.warn.callCount, 2, 'logged two warnings');
  this.env.log.warn.callCount = 0;
});

QUnit.test('updates the combined segment loader on media changes', function() {
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

  // downloading the new segment will update bandwidth and cause a
  // playlist change
  // segment 0
  standardXHRResponse(this.requests.shift());
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  // media
  standardXHRResponse(this.requests.shift());
  QUnit.ok(updates.length > 0, 'updated the segment list');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, Infinity, 'Live stream');
  QUnit.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  QUnit.equal(
    this.player.tech_.hls.stats.mediaBytesTransferred,
    16,
    '16 bytes downloaded');
});

QUnit.test('selects a playlist after main/combined segment downloads', function() {
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
  QUnit.strictEqual(calls, 2, 'selects after the initial segment');

  // and another
  this.masterPlaylistController.mainSegmentLoader_.trigger('progress');
  QUnit.strictEqual(calls, 3, 'selects after additional segments');
  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, 4194304, 'default bandwidth');
});

QUnit.test('updates the duration after switching playlists', function() {
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

  // segment 0
  standardXHRResponse(this.requests[2]);
  this.masterPlaylistController.mediaSource.sourceBuffers[0].trigger('updateend');
  // media1
  standardXHRResponse(this.requests[3]);
  QUnit.ok(selectedPlaylist, 'selected playlist');
  QUnit.ok(this.masterPlaylistController.mediaSource.duration !== 0,
           'updates the duration');

  // verify stats
  QUnit.equal(this.player.tech_.hls.stats.bandwidth, Infinity, 'Live stream');
  QUnit.equal(this.player.tech_.hls.stats.mediaRequests, 1, '1 segment request');
  QUnit.equal(this.player.tech_.hls.stats.mediaBytesTransferred,
              16,
              '16 bytes downloaded');
});

QUnit.test('removes request timeout when segment timesout on lowest rendition',
function() {
  this.masterPlaylistController.mediaSource.trigger('sourceopen');

  // master
  standardXHRResponse(this.requests[0]);
  // media
  standardXHRResponse(this.requests[1]);

  QUnit.equal(this.masterPlaylistController.requestOptions_.timeout,
              this.masterPlaylistController.masterPlaylistLoader_.targetDuration * 1.5 *
              1000,
              'default request timeout');

  QUnit.ok(!this.masterPlaylistController
            .masterPlaylistLoader_
            .isLowestEnabledRendition_(), 'Not lowest rendition');

  // Cause segment to timeout to force player into lowest rendition
  this.requests[2].timedout = true;

  // Downloading segment should cause media change and timeout removal
  // segment 0
  standardXHRResponse(this.requests[2]);
  // Download new segment after media change
  standardXHRResponse(this.requests[3]);

  QUnit.ok(this.masterPlaylistController
            .masterPlaylistLoader_.isLowestEnabledRendition_(), 'On lowest rendition');

  QUnit.equal(this.masterPlaylistController.requestOptions_.timeout, 0,
              'request timeout 0');
});

QUnit.test('seekable uses the intersection of alternate audio and combined tracks',
function() {
  let origSeekable = Playlist.seekable;
  let mainMedia = {};
  let audioMedia = {};
  let mainTimeRanges = [];
  let audioTimeRanges = [];
  let assertTimeRangesEqual = (left, right, message) => {
    if (left.length === 0 && right.length === 0) {
      return;
    }

    QUnit.equal(left.length, 1, message);
    QUnit.equal(right.length, 1, message);

    QUnit.equal(left.start(0), right.start(0), message);
    QUnit.equal(left.end(0), right.end(0), message);
  };

  this.masterPlaylistController.masterPlaylistLoader_.media = () => mainMedia;

  Playlist.seekable = (media) => {
    if (media === mainMedia) {
      return videojs.createTimeRanges(mainTimeRanges);
    }
    return videojs.createTimeRanges(audioTimeRanges);
  };

  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges(),
                        'empty when main empty');
  mainTimeRanges = [[0, 10]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[0, 10]]),
                        'main when no audio');

  this.masterPlaylistController.audioPlaylistLoader_ = {
    media: () => audioMedia,
    expired_: 0
  };

  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges(),
                        'empty when both empty');
  mainTimeRanges = [[0, 10]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges(),
                        'empty when audio empty');
  mainTimeRanges = [];
  audioTimeRanges = [[0, 10]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges(),
                        'empty when main empty');
  mainTimeRanges = [[0, 10]];
  audioTimeRanges = [[0, 10]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[0, 10]]),
                        'ranges equal');
  mainTimeRanges = [[5, 10]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[5, 10]]),
                        'main later start');
  mainTimeRanges = [[0, 10]];
  audioTimeRanges = [[5, 10]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[5, 10]]),
                        'audio later start');
  mainTimeRanges = [[0, 9]];
  audioTimeRanges = [[0, 10]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[0, 9]]),
                        'main earlier end');
  mainTimeRanges = [[0, 10]];
  audioTimeRanges = [[0, 9]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[0, 9]]),
                        'audio earlier end');
  mainTimeRanges = [[1, 10]];
  audioTimeRanges = [[0, 9]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[1, 9]]),
                        'main later start, audio earlier end');
  mainTimeRanges = [[0, 9]];
  audioTimeRanges = [[1, 10]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[1, 9]]),
                        'audio later start, main earlier end');
  mainTimeRanges = [[2, 9]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[2, 9]]),
                        'main later start, main earlier end');
  mainTimeRanges = [[1, 10]];
  audioTimeRanges = [[2, 9]];
  assertTimeRangesEqual(this.masterPlaylistController.seekable(),
                        videojs.createTimeRanges([[2, 9]]),
                        'audio later start, audio earlier end');

  Playlist.seekable = origSeekable;
});

QUnit.test('calls to update cues on new media', function() {
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

  QUnit.equal(callCount, 0, 'no call to update cues on master');

  // media
  standardXHRResponse(this.requests.shift());

  QUnit.equal(callCount, 1, 'calls to update cues on first media');

  this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');

  QUnit.equal(callCount, 2, 'calls to update cues on subsequent media');

  videojs.options.hls = origHlsOptions;
});

QUnit.test('calls to update cues on media when no master', function() {
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

  QUnit.equal(callCount, 1, 'calls to update cues on first media');

  this.masterPlaylistController.masterPlaylistLoader_.trigger('loadedplaylist');

  QUnit.equal(callCount, 2, 'calls to update cues on subsequent media');
});

QUnit.test('respects useCueTags option', function() {
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

  QUnit.ok(this.masterPlaylistController.cueTagsTrack_,
           'creates cueTagsTrack_ if useCueTags is truthy');
  QUnit.equal(this.masterPlaylistController.cueTagsTrack_.label,
              'ad-cues',
              'cueTagsTrack_ has label of ad-cues');
  QUnit.equal(this.player.textTracks()[0], this.masterPlaylistController.cueTagsTrack_,
           'adds cueTagsTrack as a text track if useCueTags is truthy');

  videojs.options.hls = origHlsOptions;
});

QUnit.module('Codec to MIME Type Conversion');

QUnit.test('recognizes muxed codec configurations', function() {
  QUnit.deepEqual(mimeTypesForPlaylist_({ mediaGroups: {} }, {}),
                  [ 'video/mp2t; codecs="avc1.4d400d, mp4a.40.2"' ],
                  'returns a default MIME type when no codecs are present');

  QUnit.deepEqual(mimeTypesForPlaylist_({
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

QUnit.test('recognizes mixed codec configurations', function() {
  QUnit.deepEqual(mimeTypesForPlaylist_({
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

  QUnit.deepEqual(mimeTypesForPlaylist_({
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

QUnit.test('recognizes unmuxed codec configurations', function() {
  QUnit.deepEqual(mimeTypesForPlaylist_({
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

  QUnit.deepEqual(mimeTypesForPlaylist_({
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

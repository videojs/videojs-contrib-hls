import QUnit from 'qunit';
import PlaylistLoader from '../src/playlist-loader';
import xhrFactory from '../src/xhr';
import { useFakeEnvironment } from './test-helpers';
import window from 'global/window';

// Attempts to produce an absolute URL to a given relative path
// based on window.location.href
const urlTo = function(path) {
  return window.location.href
    .split('/')
    .slice(0, -1)
    .concat([path])
    .join('/');
};

QUnit.module('Playlist Loader', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeHls = {
      xhr: xhrFactory()
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('throws if the playlist url is empty or undefined', function(assert) {
  assert.throws(function() {
    PlaylistLoader();
  }, 'requires an argument');
  assert.throws(function() {
    PlaylistLoader('');
  }, 'does not accept the empty string');
});

QUnit.test('starts without any metadata', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  assert.strictEqual(loader.state, 'HAVE_NOTHING', 'no metadata has loaded yet');
});

QUnit.test('requests the initial playlist immediately', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  assert.strictEqual(this.requests.length, 1, 'made a request');
  assert.strictEqual(this.requests[0].url,
                    'master.m3u8',
                    'requested the initial playlist');
});

QUnit.test('moves to HAVE_MASTER after loading a master playlist', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);
  let state;

  loader.load();

  loader.on('loadedplaylist', function() {
    state = loader.state;
  });
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:\n' +
                              'media.m3u8\n');
  assert.ok(loader.master, 'the master playlist is available');
  assert.strictEqual(state, 'HAVE_MASTER', 'the state at loadedplaylist correct');
});

QUnit.test('jumps to HAVE_METADATA when initialized with a media playlist', function(assert) {
  let loadedmetadatas = 0;
  let loader = new PlaylistLoader('media.m3u8', this.fakeHls);

  loader.load();

  loader.on('loadedmetadata', function() {
    loadedmetadatas++;
  });
  this.requests.pop().respond(200, null,
                             '#EXTM3U\n' +
                             '#EXTINF:10,\n' +
                             '0.ts\n' +
                             '#EXT-X-ENDLIST\n');
  assert.ok(loader.master, 'infers a master playlist');
  assert.ok(loader.media(), 'sets the media playlist');
  assert.ok(loader.media().uri, 'sets the media playlist URI');
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
  assert.strictEqual(this.requests.length, 0, 'no more requests are made');
  assert.strictEqual(loadedmetadatas, 1, 'fired one loadedmetadata');
});

QUnit.test('resolves relative media playlist URIs', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:\n' +
                                'video/media.m3u8\n');
  assert.equal(loader.master.playlists[0].resolvedUri, urlTo('video/media.m3u8'),
              'resolved media URI');
});

QUnit.test('playlist loader returns the correct amount of enabled playlists', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:\n' +
                                'video1/media.m3u8\n' +
                                '#EXT-X-STREAM-INF:\n' +
                                'video2/media.m3u8\n');
  assert.equal(loader.enabledPlaylists_(), 2, 'Returned initial amount of playlists');
  loader.master.playlists[0].excludeUntil = Date.now() + 100000;
  this.clock.tick(1000);
  assert.equal(loader.enabledPlaylists_(), 1, 'Returned one less playlist');
});

QUnit.test('playlist loader detects if we are on lowest rendition', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:\n' +
                                'video1/media.m3u8\n' +
                                '#EXT-X-STREAM-INF:\n' +
                                'video2/media.m3u8\n');
  loader.media = function() {
    return {attributes: {BANDWIDTH: 10}};
  };

  loader.master.playlists = [{attributes: {BANDWIDTH: 10}},
                              {attributes: {BANDWIDTH: 20}}];
  assert.ok(loader.isLowestEnabledRendition_(), 'Detected on lowest rendition');

  loader.media = function() {
    return {attributes: {BANDWIDTH: 20}};
  };

  assert.ok(!loader.isLowestEnabledRendition_(), 'Detected not on lowest rendition');
});

QUnit.test('resolves media initialization segment URIs', function(assert) {
  let loader = new PlaylistLoader('video/fmp4.m3u8', this.fakeHls);

  loader.load();
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MAP:URI="main.mp4",BYTERANGE="720@0"\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXT-X-ENDLIST\n');

  assert.equal(loader.media().segments[0].map.resolvedUri, urlTo('video/main.mp4'),
              'resolved init segment URI');
});

QUnit.test('recognizes absolute URIs and requests them unmodified', function(assert) {
  let loader = new PlaylistLoader('manifest/media.m3u8', this.fakeHls);

  loader.load();

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:\n' +
                                'http://example.com/video/media.m3u8\n');
  assert.equal(loader.master.playlists[0].resolvedUri,
              'http://example.com/video/media.m3u8', 'resolved media URI');

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                'http://example.com/00001.ts\n' +
                                '#EXT-X-ENDLIST\n');
  assert.equal(loader.media().segments[0].resolvedUri,
              'http://example.com/00001.ts', 'resolved segment URI');
});

QUnit.test('recognizes domain-relative URLs', function(assert) {
  let loader = new PlaylistLoader('manifest/media.m3u8', this.fakeHls);

  loader.load();

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:\n' +
                                '/media.m3u8\n');
  assert.equal(loader.master.playlists[0].resolvedUri,
              window.location.protocol + '//' +
              window.location.host + '/media.m3u8',
              'resolved media URI');

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '/00001.ts\n' +
                                '#EXT-X-ENDLIST\n');
  assert.equal(loader.media().segments[0].resolvedUri,
              window.location.protocol + '//' +
              window.location.host + '/00001.ts',
              'resolved segment URI');
});

QUnit.test('recognizes key URLs relative to master and playlist', function(assert) {
  let loader = new PlaylistLoader('/video/media-encrypted.m3u8', this.fakeHls);

  loader.load();

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
                                'playlist/playlist.m3u8\n' +
                                '#EXT-X-ENDLIST\n');
  assert.equal(loader.master.playlists[0].resolvedUri,
        window.location.protocol + '//' +
        window.location.host + '/video/playlist/playlist.m3u8',
        'resolved media URI');

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:2.833,\n' +
                                'http://example.com/000001.ts\n' +
                                '#EXT-X-ENDLIST\n');
  assert.equal(loader.media().segments[0].key.resolvedUri,
        window.location.protocol + '//' +
        window.location.host + '/video/playlist/keys/key.php',
        'resolved multiple relative paths for key URI');
});

QUnit.test('trigger an error event when a media playlist 404s', function(assert) {
  let count = 0;
  let loader = new PlaylistLoader('manifest/master.m3u8', this.fakeHls);

  loader.load();

  loader.on('error', function() {
    count += 1;
  });

  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
                                'playlist/playlist.m3u8\n' +
                                '#EXT-X-STREAM-INF:PROGRAM-ID=2,BANDWIDTH=170\n' +
                                'playlist/playlist2.m3u8\n' +
                                '#EXT-X-ENDLIST\n');
  assert.equal(count, 0,
    'error not triggered before requesting playlist');

  // playlist
  this.requests.shift().respond(404);

  assert.equal(count, 1,
    'error triggered after playlist 404');
});

QUnit.test('recognizes absolute key URLs', function(assert) {
  let loader = new PlaylistLoader('/video/media-encrypted.m3u8', this.fakeHls);

  loader.load();

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
                                'playlist/playlist.m3u8\n' +
                                '#EXT-X-ENDLIST\n');
  assert.equal(loader.master.playlists[0].resolvedUri,
        window.location.protocol + '//' +
        window.location.host + '/video/playlist/playlist.m3u8',
        'resolved media URI');

  this.requests.shift().respond(
    200,
    null,
    '#EXTM3U\n' +
    '#EXT-X-TARGETDURATION:15\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="http://example.com/keys/key.php"\n' +
    '#EXTINF:2.833,\n' +
    'http://example.com/000001.ts\n' +
    '#EXT-X-ENDLIST\n'
  );
  assert.equal(loader.media().segments[0].key.resolvedUri,
              'http://example.com/keys/key.php', 'resolved absolute path for key URI');
});

QUnit.test('jumps to HAVE_METADATA when initialized with a live media playlist',
function(assert) {
  let loader = new PlaylistLoader('media.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  assert.ok(loader.master, 'infers a master playlist');
  assert.ok(loader.media(), 'sets the media playlist');
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
});

QUnit.test('moves to HAVE_METADATA after loading a media playlist', function(assert) {
  let loadedPlaylist = 0;
  let loadedMetadata = 0;
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  loader.on('loadedplaylist', function() {
    loadedPlaylist++;
  });
  loader.on('loadedmetadata', function() {
    loadedMetadata++;
  });
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:\n' +
                              'media.m3u8\n' +
                              'alt.m3u8\n');
  assert.strictEqual(loadedPlaylist, 1, 'fired loadedplaylist once');
  assert.strictEqual(loadedMetadata, 0, 'did not fire loadedmetadata');
  assert.strictEqual(this.requests.length, 1, 'requests the media playlist');
  assert.strictEqual(this.requests[0].method, 'GET', 'GETs the media playlist');
  assert.strictEqual(this.requests[0].url,
                    urlTo('media.m3u8'),
                    'requests the first playlist');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  assert.ok(loader.master, 'sets the master playlist');
  assert.ok(loader.media(), 'sets the media playlist');
  assert.strictEqual(loadedPlaylist, 2, 'fired loadedplaylist twice');
  assert.strictEqual(loadedMetadata, 1, 'fired loadedmetadata once');
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
});

QUnit.test('defaults missing media groups for a media playlist', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');

  assert.ok(loader.master.mediaGroups.AUDIO, 'defaulted audio');
  assert.ok(loader.master.mediaGroups.VIDEO, 'defaulted video');
  assert.ok(loader.master.mediaGroups['CLOSED-CAPTIONS'], 'defaulted closed captions');
  assert.ok(loader.master.mediaGroups.SUBTITLES, 'defaulted subtitles');
});

QUnit.test('moves to HAVE_CURRENT_METADATA when refreshing the playlist', function(assert) {
  let loader = new PlaylistLoader('live.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  // 10s, one target duration
  this.clock.tick(10 * 1000);
  assert.strictEqual(loader.state, 'HAVE_CURRENT_METADATA', 'the state is correct');
  assert.strictEqual(this.requests.length, 1, 'requested playlist');
  assert.strictEqual(this.requests[0].url,
                    urlTo('live.m3u8'),
                    'refreshes the media playlist');
});

QUnit.test('returns to HAVE_METADATA after refreshing the playlist', function(assert) {
  let loader = new PlaylistLoader('live.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  // 10s, one target duration
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '1.ts\n');
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
});

QUnit.test('emits an error when an initial playlist request fails', function(assert) {
  let errors = [];
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  loader.on('error', function() {
    errors.push(loader.error);
  });
  this.requests.pop().respond(500);

  assert.strictEqual(errors.length, 1, 'emitted one error');
  assert.strictEqual(errors[0].status, 500, 'http status is captured');
});

QUnit.test('errors when an initial media playlist request fails', function(assert) {
  let errors = [];
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  loader.on('error', function() {
    errors.push(loader.error);
  });
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:\n' +
                              'media.m3u8\n');

  assert.strictEqual(errors.length, 0, 'emitted no errors');

  this.requests.pop().respond(500);

  assert.strictEqual(errors.length, 1, 'emitted one error');
  assert.strictEqual(errors[0].status, 500, 'http status is captured');
});

// http://tools.ietf.org/html/draft-pantos-http-live-streaming-12#section-6.3.4
QUnit.test('halves the refresh timeout if a playlist is unchanged since the last reload',
function(assert) {
  let loader = new PlaylistLoader('live.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  // trigger a refresh
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  // half the default target-duration
  this.clock.tick(5 * 1000);

  assert.strictEqual(this.requests.length, 1, 'sent a request');
  assert.strictEqual(this.requests[0].url,
                    urlTo('live.m3u8'),
                    'requested the media playlist');
});

QUnit.test('preserves segment metadata across playlist refreshes', function(assert) {
  let loader = new PlaylistLoader('live.m3u8', this.fakeHls);
  let segment;

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n' +
                              '#EXTINF:10,\n' +
                              '1.ts\n' +
                              '#EXTINF:10,\n' +
                              '2.ts\n');
  // add PTS info to 1.ts
  segment = loader.media().segments[1];
  segment.minVideoPts = 14;
  segment.maxAudioPts = 27;
  segment.preciseDuration = 10.045;

  // trigger a refresh
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:1\n' +
                              '#EXTINF:10,\n' +
                              '1.ts\n' +
                              '#EXTINF:10,\n' +
                              '2.ts\n');

  assert.deepEqual(loader.media().segments[0], segment, 'preserved segment attributes');
});

QUnit.test('clears the update timeout when switching quality', function(assert) {
  let loader = new PlaylistLoader('live-master.m3u8', this.fakeHls);
  let refreshes = 0;

  loader.load();

  // track the number of playlist refreshes triggered
  loader.on('mediaupdatetimeout', function() {
    refreshes++;
  });
  // deliver the master
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'live-low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'live-high.m3u8\n');
  // deliver the low quality playlist
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'low-0.ts\n');
  // change to a higher quality playlist
  loader.media('live-high.m3u8');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'high-0.ts\n');
  // trigger a refresh
  this.clock.tick(10 * 1000);

  assert.equal(1, refreshes, 'only one refresh was triggered');
});

QUnit.test('media-sequence updates are considered a playlist change', function(assert) {
  let loader = new PlaylistLoader('live.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  // trigger a refresh
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:1\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  // half the default target-duration
  this.clock.tick(5 * 1000);

  assert.strictEqual(this.requests.length, 0, 'no request is sent');
});

QUnit.test('emits an error if a media refresh fails', function(assert) {
  let errors = 0;
  let errorResponseText = 'custom error message';
  let loader = new PlaylistLoader('live.m3u8', this.fakeHls);

  loader.load();

  loader.on('error', function() {
    errors++;
  });
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  // trigger a refresh
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(500, null, errorResponseText);

  assert.strictEqual(errors, 1, 'emitted an error');
  assert.strictEqual(loader.error.status, 500, 'captured the status code');
  assert.strictEqual(loader.error.responseText,
                    errorResponseText,
                    'captured the responseText');
});

QUnit.test('switches media playlists when requested', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'low-0.ts\n');

  loader.media(loader.master.playlists[1]);
  assert.strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'high-0.ts\n');
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'switched active media');
  assert.strictEqual(loader.media(),
                    loader.master.playlists[1],
                    'updated the active media');
});

QUnit.test('can switch playlists immediately after the master is downloaded', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  loader.on('loadedplaylist', function() {
    loader.media('high.m3u8');
  });
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  assert.equal(this.requests[0].url, urlTo('high.m3u8'), 'switched variants immediately');
});

QUnit.test('can switch media playlists based on URI', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'low-0.ts\n');

  loader.media('high.m3u8');
  assert.strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'high-0.ts\n');
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'switched active media');
  assert.strictEqual(loader.media(),
                    loader.master.playlists[1],
                    'updated the active media');
});

QUnit.test('aborts in-flight playlist refreshes when switching', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'low-0.ts\n');
  this.clock.tick(10 * 1000);
  loader.media('high.m3u8');
  assert.strictEqual(this.requests[0].aborted, true, 'aborted refresh request');
  assert.ok(!this.requests[0].onreadystatechange,
           'onreadystatechange handlers should be removed on abort');
  assert.strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');
});

QUnit.test('switching to the active playlist is a no-op', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'low-0.ts\n' +
                              '#EXT-X-ENDLIST\n');
  loader.media('low.m3u8');

  assert.strictEqual(this.requests.length, 0, 'no requests are sent');
});

QUnit.test('switching to the active live playlist is a no-op', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'low-0.ts\n');
  loader.media('low.m3u8');

  assert.strictEqual(this.requests.length, 0, 'no requests are sent');
});

QUnit.test('switches back to loaded playlists without re-requesting them', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'low-0.ts\n' +
                              '#EXT-X-ENDLIST\n');
  loader.media('high.m3u8');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'high-0.ts\n' +
                              '#EXT-X-ENDLIST\n');
  loader.media('low.m3u8');

  assert.strictEqual(this.requests.length, 0, 'no outstanding requests');
  assert.strictEqual(loader.state, 'HAVE_METADATA', 'returned to loaded playlist');
});

QUnit.test('aborts outstanding requests if switching back to an already loaded playlist',
function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'low-0.ts\n' +
                              '#EXT-X-ENDLIST\n');
  loader.media('high.m3u8');
  loader.media('low.m3u8');

  assert.strictEqual(this.requests.length,
                    1,
                    'requested high playlist');
  assert.ok(this.requests[0].aborted,
          'aborted playlist request');
  assert.ok(!this.requests[0].onreadystatechange,
           'onreadystatechange handlers should be removed on abort');
  assert.strictEqual(loader.state,
                    'HAVE_METADATA',
                    'returned to loaded playlist');
  assert.strictEqual(loader.media(),
                    loader.master.playlists[0],
                    'switched to loaded playlist');
});

QUnit.test('does not abort requests when the same playlist is re-requested',
function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'low-0.ts\n' +
                              '#EXT-X-ENDLIST\n');
  loader.media('high.m3u8');
  loader.media('high.m3u8');

  assert.strictEqual(this.requests.length, 1, 'made only one request');
  assert.ok(!this.requests[0].aborted, 'request not aborted');
});

QUnit.test('throws an error if a media switch is initiated too early', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  assert.throws(function() {
    loader.media('high.m3u8');
  }, 'threw an error from HAVE_NOTHING');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
});

QUnit.test('throws an error if a switch to an unrecognized playlist is requested',
function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'media.m3u8\n');

  assert.throws(function() {
    loader.media('unrecognized.m3u8');
  }, 'throws an error');
});

QUnit.test('dispose cancels the refresh timeout', function(assert) {
  let loader = new PlaylistLoader('live.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  loader.dispose();
  // a lot of time passes...
  this.clock.tick(15 * 1000);

  assert.strictEqual(this.requests.length, 0, 'no refresh request was made');
});

QUnit.test('dispose aborts pending refresh requests', function(assert) {
  let loader = new PlaylistLoader('live.m3u8', this.fakeHls);

  loader.load();

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  this.clock.tick(10 * 1000);

  loader.dispose();
  assert.ok(this.requests[0].aborted, 'refresh request aborted');
  assert.ok(!this.requests[0].onreadystatechange,
           'onreadystatechange handler should not exist after dispose called'
  );
});

QUnit.test('errors if requests take longer than 45s', function(assert) {
  let loader = new PlaylistLoader('media.m3u8', this.fakeHls);
  let errors = 0;

  loader.load();

  loader.on('error', function() {
    errors++;
  });
  this.clock.tick(45 * 1000);

  assert.strictEqual(errors, 1, 'fired one error');
  assert.strictEqual(loader.error.code, 2, 'fired a network error');
});

QUnit.test('triggers an event when the active media changes', function(assert) {
  let loader = new PlaylistLoader('master.m3u8', this.fakeHls);
  let mediaChanges = 0;
  let mediaChangings = 0;

  loader.load();

  loader.on('mediachange', function() {
    mediaChanges++;
  });
  loader.on('mediachanging', function() {
    mediaChangings++;
  });
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:0\n' +
                                '#EXTINF:10,\n' +
                                'low-0.ts\n' +
                                '#EXT-X-ENDLIST\n');
  assert.strictEqual(mediaChangings, 0, 'initial selection is not a media changing');
  assert.strictEqual(mediaChanges, 0, 'initial selection is not a media change');

  loader.media('high.m3u8');
  assert.strictEqual(mediaChangings, 1, 'mediachanging fires immediately');
  assert.strictEqual(mediaChanges, 0, 'mediachange does not fire immediately');

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:0\n' +
                                '#EXTINF:10,\n' +
                                'high-0.ts\n' +
                                '#EXT-X-ENDLIST\n');
  assert.strictEqual(mediaChangings, 1, 'still one mediachanging');
  assert.strictEqual(mediaChanges, 1, 'fired a mediachange');

  // switch back to an already loaded playlist
  loader.media('low.m3u8');
  assert.strictEqual(mediaChangings, 2, 'mediachanging fires');
  assert.strictEqual(mediaChanges, 2, 'fired a mediachange');

  // trigger a no-op switch
  loader.media('low.m3u8');
  assert.strictEqual(mediaChangings, 2, 'mediachanging ignored the no-op');
  assert.strictEqual(mediaChanges, 2, 'ignored a no-op media change');
});

QUnit.test('does not misintrepret playlists missing newlines at the end', function(assert) {
  let loader = new PlaylistLoader('media.m3u8', this.fakeHls);

  loader.load();

  // no newline
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:0\n' +
                                '#EXTINF:10,\n' +
                                'low-0.ts\n' +
                                '#EXT-X-ENDLIST');
  assert.ok(loader.media().endList, 'flushed the final line of input');
});

import sinon from 'sinon';
import QUnit from 'qunit';
import PlaylistLoader from '../src/playlist-loader';
import videojs from 'video.js';
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
  beforeEach() {
    // fake XHRs
    this.oldXHR = videojs.xhr.XMLHttpRequest;
    this.sinonXhr = sinon.useFakeXMLHttpRequest();
    this.requests = [];
    this.sinonXhr.onCreate = (xhr) => {
      // force the XHR2 timeout polyfill
      xhr.timeout = null;
      this.requests.push(xhr);
    };

    // fake timers
    this.clock = sinon.useFakeTimers();
    videojs.xhr.XMLHttpRequest = this.sinonXhr;
  },
  afterEach() {
    this.sinonXhr.restore();
    this.clock.restore();
    videojs.xhr.XMLHttpRequest = this.oldXHR;
  }
});

QUnit.test('throws if the playlist url is empty or undefined', function() {
  QUnit.throws(function() {
    PlaylistLoader();
  }, 'requires an argument');
  QUnit.throws(function() {
    PlaylistLoader('');
  }, 'does not accept the empty string');
});

QUnit.test('starts without any metadata', function() {
  let loader = new PlaylistLoader('master.m3u8');

  QUnit.strictEqual(loader.state, 'HAVE_NOTHING', 'no metadata has loaded yet');
});

QUnit.test('starts with no expired time', function() {
  let loader = new PlaylistLoader('media.m3u8');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  QUnit.equal(loader.expired_,
              0,
              'zero seconds expired');
});

QUnit.test('requests the initial playlist immediately', function() {
  /* eslint-disable no-unused-vars */
  let loader = new PlaylistLoader('master.m3u8');
  /* eslint-enable no-unused-vars */

  QUnit.strictEqual(this.requests.length, 1, 'made a request');
  QUnit.strictEqual(this.requests[0].url,
                    'master.m3u8',
                    'requested the initial playlist');
});

QUnit.test('moves to HAVE_MASTER after loading a master playlist', function() {
  let loader = new PlaylistLoader('master.m3u8');
  let state;

  loader.on('loadedplaylist', function() {
    state = loader.state;
  });
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:\n' +
                              'media.m3u8\n');
  QUnit.ok(loader.master, 'the master playlist is available');
  QUnit.strictEqual(state, 'HAVE_MASTER', 'the state at loadedplaylist correct');
});

QUnit.test('jumps to HAVE_METADATA when initialized with a media playlist', function() {
  let loadedmetadatas = 0;
  let loader = new PlaylistLoader('media.m3u8');

  loader.on('loadedmetadata', function() {
    loadedmetadatas++;
  });
  this.requests.pop().respond(200, null,
                             '#EXTM3U\n' +
                             '#EXTINF:10,\n' +
                             '0.ts\n' +
                             '#EXT-X-ENDLIST\n');
  QUnit.ok(loader.master, 'infers a master playlist');
  QUnit.ok(loader.media(), 'sets the media playlist');
  QUnit.ok(loader.media().uri, 'sets the media playlist URI');
  QUnit.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
  QUnit.strictEqual(this.requests.length, 0, 'no more requests are made');
  QUnit.strictEqual(loadedmetadatas, 1, 'fired one loadedmetadata');
});

QUnit.test('jumps to HAVE_METADATA when initialized with a live media playlist',
function() {
  let loader = new PlaylistLoader('media.m3u8');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  QUnit.ok(loader.master, 'infers a master playlist');
  QUnit.ok(loader.media(), 'sets the media playlist');
  QUnit.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
});

QUnit.test('moves to HAVE_METADATA after loading a media playlist', function() {
  let loadedPlaylist = 0;
  let loadedMetadata = 0;
  let loader = new PlaylistLoader('master.m3u8');

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
  QUnit.strictEqual(loadedPlaylist, 1, 'fired loadedplaylist once');
  QUnit.strictEqual(loadedMetadata, 0, 'did not fire loadedmetadata');
  QUnit.strictEqual(this.requests.length, 1, 'requests the media playlist');
  QUnit.strictEqual(this.requests[0].method, 'GET', 'GETs the media playlist');
  QUnit.strictEqual(this.requests[0].url,
                    urlTo('media.m3u8'),
                    'requests the first playlist');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  QUnit.ok(loader.master, 'sets the master playlist');
  QUnit.ok(loader.media(), 'sets the media playlist');
  QUnit.strictEqual(loadedPlaylist, 2, 'fired loadedplaylist twice');
  QUnit.strictEqual(loadedMetadata, 1, 'fired loadedmetadata once');
  QUnit.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
});

QUnit.test('moves to HAVE_CURRENT_METADATA when refreshing the playlist', function() {
  let loader = new PlaylistLoader('live.m3u8');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  // 10s, one target duration
  this.clock.tick(10 * 1000);
  QUnit.strictEqual(loader.state, 'HAVE_CURRENT_METADATA', 'the state is correct');
  QUnit.strictEqual(this.requests.length, 1, 'requested playlist');
  QUnit.strictEqual(this.requests[0].url,
                    urlTo('live.m3u8'),
                    'refreshes the media playlist');
});

QUnit.test('returns to HAVE_METADATA after refreshing the playlist', function() {
  let loader = new PlaylistLoader('live.m3u8');

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
  QUnit.strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
});

QUnit.test('does not increment expired seconds before firstplay is triggered',
function() {
  let loader = new PlaylistLoader('live.m3u8');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n' +
                              '#EXTINF:10,\n' +
                              '1.ts\n' +
                              '#EXTINF:10,\n' +
                              '2.ts\n' +
                              '#EXTINF:10,\n' +
                              '3.ts\n');
  // 10s, one target duration
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:1\n' +
                              '#EXTINF:10,\n' +
                              '1.ts\n' +
                              '#EXTINF:10,\n' +
                              '2.ts\n' +
                              '#EXTINF:10,\n' +
                              '3.ts\n' +
                              '#EXTINF:10,\n' +
                              '4.ts\n');
  QUnit.equal(loader.expired_, 0, 'expired one segment');
});

QUnit.test('increments expired seconds after a segment is removed', function() {
  let loader = new PlaylistLoader('live.m3u8');

  loader.trigger('firstplay');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n' +
                              '#EXTINF:10,\n' +
                              '1.ts\n' +
                              '#EXTINF:10,\n' +
                              '2.ts\n' +
                              '#EXTINF:10,\n' +
                              '3.ts\n');
  // 10s, one target duration
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:1\n' +
                              '#EXTINF:10,\n' +
                              '1.ts\n' +
                              '#EXTINF:10,\n' +
                              '2.ts\n' +
                              '#EXTINF:10,\n' +
                              '3.ts\n' +
                              '#EXTINF:10,\n' +
                              '4.ts\n');
  QUnit.equal(loader.expired_, 10, 'expired one segment');
});

QUnit.test('increments expired seconds after a discontinuity', function() {
  let loader = new PlaylistLoader('live.m3u8');

  loader.trigger('firstplay');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n' +
                              '#EXTINF:3,\n' +
                              '1.ts\n' +
                              '#EXT-X-DISCONTINUITY\n' +
                              '#EXTINF:4,\n' +
                              '2.ts\n');
  // 10s, one target duration
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:1\n' +
                              '#EXTINF:3,\n' +
                              '1.ts\n' +
                              '#EXT-X-DISCONTINUITY\n' +
                              '#EXTINF:4,\n' +
                              '2.ts\n');
  QUnit.equal(loader.expired_, 10, 'expired one segment');

  // 10s, one target duration
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:2\n' +
                              '#EXT-X-DISCONTINUITY\n' +
                              '#EXTINF:4,\n' +
                              '2.ts\n');
  QUnit.equal(loader.expired_, 13, 'no expirations after the discontinuity yet');

  // 10s, one target duration
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:3\n' +
                              '#EXT-X-DISCONTINUITY-SEQUENCE:1\n' +
                              '#EXTINF:10,\n' +
                              '3.ts\n');
  QUnit.equal(loader.expired_, 17, 'tracked expiration across the discontinuity');
});

QUnit.test('tracks expired seconds properly when two discontinuities expire at once',
function() {
  let loader = new PlaylistLoader('live.m3u8');

  loader.trigger('firstplay');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:4,\n' +
                              '0.ts\n' +
                              '#EXT-X-DISCONTINUITY\n' +
                              '#EXTINF:5,\n' +
                              '1.ts\n' +
                              '#EXT-X-DISCONTINUITY\n' +
                              '#EXTINF:6,\n' +
                              '2.ts\n' +
                              '#EXTINF:7,\n' +
                              '3.ts\n');
  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:3\n' +
                              '#EXT-X-DISCONTINUITY-SEQUENCE:2\n' +
                              '#EXTINF:7,\n' +
                              '3.ts\n');
  QUnit.equal(loader.expired_, 4 + 5 + 6, 'tracked multiple expiring discontinuities');
});

QUnit.test('estimates expired if an entire window elapses between live playlist updates',
function() {
  let loader = new PlaylistLoader('live.m3u8');

  loader.trigger('firstplay');
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:4,\n' +
                              '0.ts\n' +
                              '#EXTINF:5,\n' +
                              '1.ts\n');

  this.clock.tick(10 * 1000);
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:4\n' +
                              '#EXTINF:6,\n' +
                              '4.ts\n' +
                              '#EXTINF:7,\n' +
                              '5.ts\n');

  QUnit.equal(loader.expired_,
              4 + 5 + (2 * 10),
              'made a very rough estimate of expired time');
});

QUnit.test('emits an error when an initial playlist request fails', function() {
  let errors = [];
  let loader = new PlaylistLoader('master.m3u8');

  loader.on('error', function() {
    errors.push(loader.error);
  });
  this.requests.pop().respond(500);

  QUnit.strictEqual(errors.length, 1, 'emitted one error');
  QUnit.strictEqual(errors[0].status, 500, 'http status is captured');
});

QUnit.test('errors when an initial media playlist request fails', function() {
  let errors = [];
  let loader = new PlaylistLoader('master.m3u8');

  loader.on('error', function() {
    errors.push(loader.error);
  });
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:\n' +
                              'media.m3u8\n');

  QUnit.strictEqual(errors.length, 0, 'emitted no errors');

  this.requests.pop().respond(500);

  QUnit.strictEqual(errors.length, 1, 'emitted one error');
  QUnit.strictEqual(errors[0].status, 500, 'http status is captured');
});

// http://tools.ietf.org/html/draft-pantos-http-live-streaming-12#section-6.3.4
QUnit.test('halves the refresh timeout if a playlist is unchanged since the last reload',
function() {
  /* eslint-disable no-unused-vars */
  let loader = new PlaylistLoader('live.m3u8');
  /* eslint-enable no-unused-vars */

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

  QUnit.strictEqual(this.requests.length, 1, 'sent a request');
  QUnit.strictEqual(this.requests[0].url,
                    urlTo('live.m3u8'),
                    'requested the media playlist');
});

QUnit.test('preserves segment metadata across playlist refreshes', function() {
  let loader = new PlaylistLoader('live.m3u8');
  let segment;

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

  QUnit.deepEqual(loader.media().segments[0], segment, 'preserved segment attributes');
});

QUnit.test('clears the update timeout when switching quality', function() {
  let loader = new PlaylistLoader('live-master.m3u8');
  let refreshes = 0;

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

  QUnit.equal(1, refreshes, 'only one refresh was triggered');
});

QUnit.test('media-sequence updates are considered a playlist change', function() {
  /* eslint-disable no-unused-vars */
  let loader = new PlaylistLoader('live.m3u8');
  /* eslint-enable no-unused-vars */

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

  QUnit.strictEqual(this.requests.length, 0, 'no request is sent');
});

QUnit.test('emits an error if a media refresh fails', function() {
  let errors = 0;
  let errorResponseText = 'custom error message';
  let loader = new PlaylistLoader('live.m3u8');

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

  QUnit.strictEqual(errors, 1, 'emitted an error');
  QUnit.strictEqual(loader.error.status, 500, 'captured the status code');
  QUnit.strictEqual(loader.error.responseText,
                    errorResponseText,
                    'captured the responseText');
});

QUnit.test('switches media playlists when requested', function() {
  let loader = new PlaylistLoader('master.m3u8');

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
  QUnit.strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'high-0.ts\n');
  QUnit.strictEqual(loader.state, 'HAVE_METADATA', 'switched active media');
  QUnit.strictEqual(loader.media(),
                    loader.master.playlists[1],
                    'updated the active media');
});

QUnit.test('can switch playlists immediately after the master is downloaded', function() {
  let loader = new PlaylistLoader('master.m3u8');

  loader.on('loadedplaylist', function() {
    loader.media('high.m3u8');
  });
  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'low.m3u8\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                              'high.m3u8\n');
  QUnit.equal(this.requests[0].url, urlTo('high.m3u8'), 'switched variants immediately');
});

QUnit.test('can switch media playlists based on URI', function() {
  let loader = new PlaylistLoader('master.m3u8');

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
  QUnit.strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              'high-0.ts\n');
  QUnit.strictEqual(loader.state, 'HAVE_METADATA', 'switched active media');
  QUnit.strictEqual(loader.media(),
                    loader.master.playlists[1],
                    'updated the active media');
});

QUnit.test('aborts in-flight playlist refreshes when switching', function() {
  let loader = new PlaylistLoader('master.m3u8');

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
  QUnit.strictEqual(this.requests[0].aborted, true, 'aborted refresh request');
  QUnit.ok(!this.requests[0].onreadystatechange,
           'onreadystatechange handlers should be removed on abort');
  QUnit.strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');
});

QUnit.test('switching to the active playlist is a no-op', function() {
  let loader = new PlaylistLoader('master.m3u8');

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

  QUnit.strictEqual(this.requests.length, 0, 'no requests are sent');
});

QUnit.test('switching to the active live playlist is a no-op', function() {
  let loader = new PlaylistLoader('master.m3u8');

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

  QUnit.strictEqual(this.requests.length, 0, 'no requests are sent');
});

QUnit.test('switches back to loaded playlists without re-requesting them', function() {
  let loader = new PlaylistLoader('master.m3u8');

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

  QUnit.strictEqual(this.requests.length, 0, 'no outstanding requests');
  QUnit.strictEqual(loader.state, 'HAVE_METADATA', 'returned to loaded playlist');
});

QUnit.test('aborts outstanding requests if switching back to an already loaded playlist',
function() {
  let loader = new PlaylistLoader('master.m3u8');

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

  QUnit.strictEqual(this.requests.length,
                    1,
                    'requested high playlist');
  QUnit.ok(this.requests[0].aborted,
          'aborted playlist request');
  QUnit.ok(!this.requests[0].onreadystatechange,
           'onreadystatechange handlers should be removed on abort');
  QUnit.strictEqual(loader.state,
                    'HAVE_METADATA',
                    'returned to loaded playlist');
  QUnit.strictEqual(loader.media(),
                    loader.master.playlists[0],
                    'switched to loaded playlist');
});

QUnit.test('does not abort requests when the same playlist is re-requested',
function() {
  let loader = new PlaylistLoader('master.m3u8');

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

  QUnit.strictEqual(this.requests.length, 1, 'made only one request');
  QUnit.ok(!this.requests[0].aborted, 'request not aborted');
});

QUnit.test('throws an error if a media switch is initiated too early', function() {
  let loader = new PlaylistLoader('master.m3u8');

  QUnit.throws(function() {
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
function() {
  let loader = new PlaylistLoader('master.m3u8');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                              'media.m3u8\n');

  QUnit.throws(function() {
    loader.media('unrecognized.m3u8');
  }, 'throws an error');
});

QUnit.test('dispose cancels the refresh timeout', function() {
  let loader = new PlaylistLoader('live.m3u8');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  loader.dispose();
  // a lot of time passes...
  this.clock.tick(15 * 1000);

  QUnit.strictEqual(this.requests.length, 0, 'no refresh request was made');
});

QUnit.test('dispose aborts pending refresh requests', function() {
  let loader = new PlaylistLoader('live.m3u8');

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXT-X-MEDIA-SEQUENCE:0\n' +
                              '#EXTINF:10,\n' +
                              '0.ts\n');
  this.clock.tick(10 * 1000);

  loader.dispose();
  QUnit.ok(this.requests[0].aborted, 'refresh request aborted');
  QUnit.ok(!this.requests[0].onreadystatechange,
           'onreadystatechange handler should not exist after dispose called'
  );
});

QUnit.test('errors if requests take longer than 45s', function() {
  let loader = new PlaylistLoader('media.m3u8');
  let errors = 0;

  loader.on('error', function() {
    errors++;
  });
  this.clock.tick(45 * 1000);

  QUnit.strictEqual(errors, 1, 'fired one error');
  QUnit.strictEqual(loader.error.code, 2, 'fired a network error');
});

QUnit.test('triggers an event when the active media changes', function() {
  let loader = new PlaylistLoader('master.m3u8');
  let mediaChanges = 0;

  loader.on('mediachange', function() {
    mediaChanges++;
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
  QUnit.strictEqual(mediaChanges, 0, 'initial selection is not a media change');

  loader.media('high.m3u8');
  QUnit.strictEqual(mediaChanges, 0, 'mediachange does not fire immediately');

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:0\n' +
                                '#EXTINF:10,\n' +
                                'high-0.ts\n' +
                                '#EXT-X-ENDLIST\n');
  QUnit.strictEqual(mediaChanges, 1, 'fired a mediachange');

  // switch back to an already loaded playlist
  loader.media('low.m3u8');
  QUnit.strictEqual(mediaChanges, 2, 'fired a mediachange');

  // trigger a no-op switch
  loader.media('low.m3u8');
  QUnit.strictEqual(mediaChanges, 2, 'ignored a no-op media change');
});

QUnit.test('can get media index by playback position for non-live videos', function() {
  let loader = new PlaylistLoader('media.m3u8');

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:0\n' +
                                '#EXTINF:4,\n' +
                                '0.ts\n' +
                                '#EXTINF:5,\n' +
                                '1.ts\n' +
                                '#EXTINF:6,\n' +
                                '2.ts\n' +
                                '#EXT-X-ENDLIST\n');

  QUnit.equal(loader.getMediaIndexForTime_(-1),
              0,
              'the index is never less than zero');
  QUnit.equal(loader.getMediaIndexForTime_(0), 0, 'time zero is index zero');
  QUnit.equal(loader.getMediaIndexForTime_(3), 0, 'time three is index zero');
  QUnit.equal(loader.getMediaIndexForTime_(10), 2, 'time 10 is index 2');
  QUnit.equal(loader.getMediaIndexForTime_(22),
              2,
              'time greater than the length is index 2');
});

QUnit.test('returns the lower index when calculating for a segment boundary', function() {
  let loader = new PlaylistLoader('media.m3u8');

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:0\n' +
                                '#EXTINF:4,\n' +
                                '0.ts\n' +
                                '#EXTINF:5,\n' +
                                '1.ts\n' +
                                '#EXT-X-ENDLIST\n');
  QUnit.equal(loader.getMediaIndexForTime_(4), 1, 'rounds up exact matches');
  QUnit.equal(loader.getMediaIndexForTime_(3.7), 0, 'rounds down');
  QUnit.equal(loader.getMediaIndexForTime_(4.5), 1, 'rounds up at 0.5');
});

QUnit.test('accounts for non-zero starting segment time when calculating media index',
function() {
  let loader = new PlaylistLoader('media.m3u8');

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:1001\n' +
                                '#EXTINF:4,\n' +
                                '1001.ts\n' +
                                '#EXTINF:5,\n' +
                                '1002.ts\n');
  loader.media().segments[0].end = 154;

  QUnit.equal(loader.getMediaIndexForTime_(0),
              -1,
              'the lowest returned value is  negative one');
  QUnit.equal(loader.getMediaIndexForTime_(45),
              -1,
              'expired content returns negative one');
  QUnit.equal(loader.getMediaIndexForTime_(75),
              -1,
              'expired content returns  negative one');
  QUnit.equal(loader.getMediaIndexForTime_(50 + 100),
              0,
              'calculates the earliest available position');
  QUnit.equal(loader.getMediaIndexForTime_(50 + 100 + 2),
              0,
              'calculates within the first segment');
  QUnit.equal(loader.getMediaIndexForTime_(50 + 100 + 4),
              1,
              'calculates within the second segment');
  QUnit.equal(loader.getMediaIndexForTime_(50 + 100 + 4.5),
              1,
              'calculates within the second segment');
  QUnit.equal(loader.getMediaIndexForTime_(50 + 100 + 6),
              1,
              'calculates within the second segment');
});

QUnit.test('prefers precise segment timing when tracking expired time', function() {
  let loader = new PlaylistLoader('media.m3u8');

  loader.trigger('firstplay');
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:1001\n' +
                                '#EXTINF:4,\n' +
                                '1001.ts\n' +
                                '#EXTINF:5,\n' +
                                '1002.ts\n');
  // setup the loader with an "imprecise" value as if it had been
  // accumulating segment durations as they expire
  loader.expired_ = 160;
  // annotate the first segment with a start time
  // this number would be coming from the Source Buffer in practice
  loader.media().segments[0].end = 150;

  QUnit.equal(loader.getMediaIndexForTime_(149),
              0,
              'prefers the value on the first segment');

  // trigger a playlist refresh
  this.clock.tick(10 * 1000);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:1002\n' +
                                '#EXTINF:5,\n' +
                                '1002.ts\n');
  QUnit.equal(loader.getMediaIndexForTime_(150 + 4 + 1),
              0,
              'tracks precise expired times');
});

QUnit.test('accounts for expired time when calculating media index', function() {
  let loader = new PlaylistLoader('media.m3u8');

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:1001\n' +
                                '#EXTINF:4,\n' +
                                '1001.ts\n' +
                                '#EXTINF:5,\n' +
                                '1002.ts\n');
  loader.expired_ = 150;

  QUnit.equal(loader.getMediaIndexForTime_(0),
              -1,
              'expired content returns a negative index');
  QUnit.equal(loader.getMediaIndexForTime_(75),
              -1,
              'expired content returns a negative index');
  QUnit.equal(loader.getMediaIndexForTime_(50 + 100),
              0,
              'calculates the earliest available position');
  QUnit.equal(loader.getMediaIndexForTime_(50 + 100 + 2),
              0,
              'calculates within the first segment');
  QUnit.equal(loader.getMediaIndexForTime_(50 + 100 + 4.5),
              1,
              'calculates within the second segment');
  QUnit.equal(loader.getMediaIndexForTime_(50 + 100 + 6),
              1,
              'calculates within the second segment');
});

QUnit.test('does not misintrepret playlists missing newlines at the end', function() {
  let loader = new PlaylistLoader('media.m3u8');

  // no newline
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:0\n' +
                                '#EXTINF:10,\n' +
                                'low-0.ts\n' +
                                '#EXT-X-ENDLIST');
  QUnit.ok(loader.media().endList, 'flushed the final line of input');
});

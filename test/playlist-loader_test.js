(function(window) {
  'use strict';
  var
    sinonXhr,
    clock,
    requests,
    videojs = window.videojs,

    // Attempts to produce an absolute URL to a given relative path
    // based on window.location.href
    urlTo = function(path) {
      return window.location.href
        .split('/')
        .slice(0, -1)
        .concat([path])
        .join('/');
    };

  module('Playlist Loader', {
    setup: function() {
      // fake XHRs
      sinonXhr = sinon.useFakeXMLHttpRequest();
      requests = [];
      sinonXhr.onCreate = function(xhr) {
        requests.push(xhr);
      };

      // fake timers
      clock = sinon.useFakeTimers();
    },
    teardown: function() {
      sinonXhr.restore();
      clock.restore();
    }
  });

  test('throws if the playlist url is empty or undefined', function() {
    throws(function() {
      videojs.hls.PlaylistLoader();
    }, 'requires an argument');
    throws(function() {
      videojs.hls.PlaylistLoader('');
    }, 'does not accept the empty string');
  });

  test('starts without any metadata', function() {
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');
    strictEqual(loader.state, 'HAVE_NOTHING', 'no metadata has loaded yet');
  });

  test('requests the initial playlist immediately', function() {
    new videojs.hls.PlaylistLoader('master.m3u8');
    strictEqual(requests.length, 1, 'made a request');
    strictEqual(requests[0].url, 'master.m3u8', 'requested the initial playlist');
  });

  test('moves to HAVE_MASTER after loading a master playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:\n' +
                           'media.m3u8\n');
    ok(loader.master, 'the master playlist is available');
    strictEqual(loader.state, 'HAVE_MASTER', 'the state is correct');
  });

  test('jumps to HAVE_METADATA when initialized with a media playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('media.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXT-X-ENDLIST\n');
    ok(loader.master, 'infers a master playlist');
    ok(loader.media(), 'sets the media playlist');
    ok(loader.media().uri, 'sets the media playlist URI');
    strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
    strictEqual(0, requests.length, 'no more requests are made');
  });

  test('jumps to HAVE_METADATA when initialized with a live media playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('media.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n');
    ok(loader.master, 'infers a master playlist');
    ok(loader.media(), 'sets the media playlist');
    strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
  });

  test('moves to HAVE_METADATA after loading a media playlist', function() {
    var
      loadedPlaylist = false,
      loader = new videojs.hls.PlaylistLoader('master.m3u8');
    loader.on('loadedplaylist', function() {
      loadedPlaylist = true;
    });
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:\n' +
                           'media.m3u8\n' +
                           'alt.m3u8\n');
    ok(loadedPlaylist, 'loadedplaylist fired');
    strictEqual(requests.length, 1, 'requests the media playlist');
    strictEqual(requests[0].method, 'GET', 'GETs the media playlist');
    strictEqual(requests[0].url,
                urlTo('media.m3u8'),
                'requests the first playlist');

    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n');
    ok(loader.master, 'sets the master playlist');
    ok(loader.media(), 'sets the media playlist');
    strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
  });

  test('moves to HAVE_CURRENT_METADATA when refreshing the playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('live.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n');
    clock.tick(10 * 1000); // 10s, one target duration
    strictEqual(loader.state, 'HAVE_CURRENT_METADATA', 'the state is correct');
    strictEqual(requests.length, 1, 'requested playlist');
    strictEqual(requests[0].url,
                urlTo('live.m3u8'),
                'refreshes the media playlist');
  });

  test('returns to HAVE_METADATA after refreshing the playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('live.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n');
    clock.tick(10 * 1000); // 10s, one target duration
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '1.ts\n');
    strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
  });

  test('emits an error when an initial playlist request fails', function() {
    var
      errors = [],
      loader = new videojs.hls.PlaylistLoader('master.m3u8');

    loader.on('error', function() {
      errors.push(loader.error);
    });
    requests.pop().respond(500);

    strictEqual(errors.length, 1, 'emitted one error');
    strictEqual(errors[0].status, 500, 'http status is captured');
  });

  test('errors when an initial media playlist request fails', function() {
    var
      errors = [],
      loader = new videojs.hls.PlaylistLoader('master.m3u8');

    loader.on('error', function() {
      errors.push(loader.error);
    });
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:\n' +
                           'media.m3u8\n');

    strictEqual(errors.length, 0, 'emitted no errors');

    requests.pop().respond(500);

    strictEqual(errors.length, 1, 'emitted one error');
    strictEqual(errors[0].status, 500, 'http status is captured');
  });


  // http://tools.ietf.org/html/draft-pantos-http-live-streaming-12#section-6.3.4
  test('halves the refresh timeout if a playlist is unchanged' +
       'since the last reload', function() {
    new videojs.hls.PlaylistLoader('live.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n');
    clock.tick(10 * 1000); // trigger a refresh
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n');
    clock.tick(5 * 1000); // half the default target-duration

    strictEqual(requests.length, 1, 'sent a request');
    strictEqual(requests[0].url,
                urlTo('live.m3u8'),
                'requested the media playlist');
  });

  test('media-sequence updates are considered a playlist change', function() {
    new videojs.hls.PlaylistLoader('live.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n');
    clock.tick(10 * 1000); // trigger a refresh
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:1\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n');
    clock.tick(5 * 1000); // half the default target-duration

    strictEqual(requests.length, 0, 'no request is sent');
  });

  test('emits an error if a media refresh fails', function() {
    var
      errors = 0,
      loader = new videojs.hls.PlaylistLoader('live.m3u8');

    loader.on('error', function() {
      errors++;
    });
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n');
    clock.tick(10 * 1000); // trigger a refresh
    requests.pop().respond(500);

    strictEqual(errors, 1, 'emitted an error');
    strictEqual(loader.error.status, 500, 'captured the status code');
  });

  test('switches media playlists when requested', function() {
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'low.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                           'high.m3u8\n');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:10,\n' +
                           'low-0.ts\n');

    loader.media(loader.master.playlists[1]);
    strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');

    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:10,\n' +
                           'high-0.ts\n');
    strictEqual(loader.state, 'HAVE_METADATA', 'switched active media');
    strictEqual(loader.media(),
                loader.master.playlists[1],
                'updated the active media');
  });

  test('can switch media playlists based on URI', function() {
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'low.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                           'high.m3u8\n');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:10,\n' +
                           'low-0.ts\n');

    loader.media('high.m3u8');
    strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');

    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:10,\n' +
                           'high-0.ts\n');
    strictEqual(loader.state, 'HAVE_METADATA', 'switched active media');
    strictEqual(loader.media(),
                loader.master.playlists[1],
                'updated the active media');
  });

  test('aborts in-flight playlist refreshes when switching', function() {
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'low.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                           'high.m3u8\n');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:10,\n' +
                           'low-0.ts\n');
    clock.tick(10 * 1000);
    loader.media('high.m3u8');
    strictEqual(requests[0].aborted, true, 'aborted refresh request');
    strictEqual(loader.state, 'SWITCHING_MEDIA', 'updated the state');
  });

  test('throws an error if a media switch is initiated too early', function() {
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');

    throws(function() {
      loader.media('high.m3u8');
    }, 'threw an error from HAVE_NOTHING');

    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'low.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=2\n' +
                           'high.m3u8\n');
    throws(function() {
      loader.media('high.m3u8');
    }, 'throws an error from HAVE_MASTER');
  });

  test('throws an error if a switch to an unrecognized playlist is requested', function() {
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');
    requests.pop().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'media.m3u8\n');

    throws(function() {
      loader.media('unrecognized.m3u8');
    }, 'throws an error');
  });
})(window);

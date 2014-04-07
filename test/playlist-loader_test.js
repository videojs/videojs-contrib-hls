(function(window) {
  'use strict';
  var
    oldXhr,
    requests,
    videojs = window.videojs;

  module('Playlist Loader', {
    setup: function() {
      oldXhr = window.XMLHttpRequest;
      requests = [];

      window.XMLHttpRequest = function() {
        this.open = function(method, url) {
          this.method = method;
          this.url = url;
        };
        this.send = function() {
          requests.push(this);
        };
        this.respond = function(response) {
          this.responseText = response;
          this.readyState = 4;
          this.onreadystatechange();
        };
      };
      this.send = function() {
      };
    },
    teardown: function() {
      window.XMLHttpRequest = oldXhr;
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
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');
    strictEqual(requests.length, 1, 'made a request');
    strictEqual(requests[0].url, 'master.m3u8', 'requested the initial playlist');
  });

  test('moves to HAVE_MASTER after loading a master playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');
    requests.pop().respond('#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:\n' +
                           'media.m3u8\n');
    ok(loader.master, 'the master playlist is available');
    strictEqual(loader.state, 'HAVE_MASTER', 'the state is correct');
  });

  test('jumps to HAVE_METADATA when initialized with a media playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('media.m3u8');
    requests.pop().respond('#EXTM3U\n' +
                           '#EXTINF:10,\n' + 
                           '0.ts\n' +
                           '#EXT-X-ENDLIST\n');
    ok(loader.master, 'infers a master playlist');
    ok(loader.media, 'sets the media playlist');
    strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
    strictEqual(0, requests.length, 'no more requests are made');
  });

  test('jumps to HAVE_METADATA when initialized with a live media playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('media.m3u8');
    requests.pop().respond('#EXTM3U\n' +
                           '#EXTINF:10,\n' + 
                           '0.ts\n');
    ok(loader.master, 'infers a master playlist');
    ok(loader.media, 'sets the media playlist');
    strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
  });

  test('moves to HAVE_METADATA after loading a media playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('master.m3u8');
    requests.pop().respond('#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:\n' +
                           'media.m3u8\n' +
                           'alt.m3u8\n');
    strictEqual(requests.length, 1, 'requests the media playlist');
    strictEqual(requests[0].method, 'GET', 'GETs the media playlist');
    strictEqual(requests[0].url, 'media.m3u8', 'requests the first playlist');

    requests.pop().response('#EXTM3U\n' +
                            '#EXTINF:10,\n' + 
                            '0.ts\n');
    ok(loader.master, 'sets the master playlist');
    ok(loader.media, 'sets the media playlist');
    strictEqual(loader.state, 'HAVE_METADATA', 'the state is correct');
  });

  test('moves to HAVE_CURRENT_METADATA when refreshing the playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('live.m3u8');
    requests.pop().response('#EXTM3U\n' +
                            '#EXTINF:10,\n' + 
                            '0.ts\n');
    loader.refreshMedia();
    strictEqual(loader.state, 'HAVE_CURRENT_METADATA', 'the state is correct');
    strictEqual(requests.length, 1, 'requested playlist');
    strictEqual(requests[0].url, 'live.m3u8', 'refreshes the media playlist');
  });

  test('returns to HAVE_METADATA after refreshing the playlist', function() {
    var loader = new videojs.hls.PlaylistLoader('live.m3u8');
    requests.pop().response('#EXTM3U\n' +
                            '#EXTINF:10,\n' + 
                            '0.ts\n');
    loader.refreshMedia();
    requests.pop().response('#EXTM3U\n' +
                            '#EXTINF:10,\n' + 
                            '1.ts\n');
    strictEqual(loader.state, 'HAVE_CURRENT_METADATA', 'the state is correct');
  });
})(window);

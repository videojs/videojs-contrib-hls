(function(window, videojs, undefined) {
  /*
    ======== A Handy Little QUnit Reference ========
    http://api.qunitjs.com/

    Test methods:
    module(name, {[setup][ ,teardown]})
    test(name, callback)
    expect(numberOfAssertions)
    stop(increment)
    start(decrement)
    Test assertions:
    ok(value, [message])
    equal(actual, expected, [message])
    notEqual(actual, expected, [message])
    deepEqual(actual, expected, [message])
    notDeepEqual(actual, expected, [message])
    strictEqual(actual, expected, [message])
    notStrictEqual(actual, expected, [message])
    throws(block, [expected], [message])
  */

var
  player,
  segmentController,
  oldFlashSupported,
  oldXhr,
  oldSourceBuffer,
  xhrUrls;

module('HLS', {
  setup: function() {

    // mock out Flash feature for phantomjs
    oldFlashSupported = videojs.Flash.isSupported;
    videojs.Flash.isSupported = function() {
      return true;
    };
    oldSourceBuffer = window.videojs.SourceBuffer;
    window.videojs.SourceBuffer = function() {
      this.appendBuffer = function() {};
    };

    // create the test player
    var video = document.createElement('video');
    document.querySelector('#qunit-fixture').appendChild(video);
    player = videojs(video, {
      flash: {
        swf: '../node_modules/video.js/dist/video-js/video-js.swf'
      },
      techOrder: ['flash']
    });
    player.buffered = function() {
      return videojs.createTimeRange(0, 0);
    };

    // make XHR synchronous
    oldXhr = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
      this.open = function(method, url) {
        xhrUrls.push(url);
      };
      this.send = function() {
        // if the request URL looks like one of the test manifests, grab the
        // contents off the global object
        var manifestName = (/(?:.*\/)?(.*)\.m3u8/).exec(xhrUrls.slice(-1)[0]);
        if (manifestName) {
          manifestName = manifestName[1];
        }
        this.responseText = window.manifests[manifestName || xhrUrls.slice(-1)[0]];
        this.response = new Uint8Array([1]).buffer;

        this.readyState = 4;
        this.onreadystatechange();
      };
    };
    xhrUrls = [];
  },
  teardown: function() {
    videojs.Flash.isSupported = oldFlashSupported;
    window.videojs.SourceBuffer = oldSourceBuffer;
    window.XMLHttpRequest = oldXhr;
  }
});

test('loads the specified manifest URL on init', function() {
  var loadedmanifest = false, loadedmetadata = false;
  player.on('loadedmanifest', function() {
    loadedmanifest = true;
  });
  player.on('loadedmetadata', function() {
    loadedmetadata = true;
  });

  player.hls('manifest/playlist.m3u8');
  strictEqual(player.hls.readyState(), 0, 'the readyState is HAVE_NOTHING');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  ok(loadedmanifest, 'loadedmanifest fires');
  ok(loadedmetadata, 'loadedmetadata fires');
  ok(player.hls.master, 'a master is inferred');
  ok(player.hls.media, 'the manifest is available');
  ok(player.hls.media.segments, 'the segment entries are parsed');
  strictEqual(player.hls.master.playlists[0],
              player.hls.media,
              'the playlist is selected');
  strictEqual(player.hls.readyState(), 1, 'the readyState is HAVE_METADATA');
});

test('sets the duration if one is available on the playlist', function() {
  var calls = 0;
  player.duration = function(value) {
    if (value === undefined) {
      return 0;
    }
    calls++;
  };
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(1, calls, 'duration is set');
});

test('starts downloading a segment on loadedmetadata', function() {
  player.hls('manifest/media.m3u8');
  player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(xhrUrls[1],
              window.location.origin +
              window.location.pathname.split('/').slice(0, -1).join('/') +
              '/manifest/00001.ts',
              'the first segment is requested');
});

test('recognizes absolute URIs and requests them unmodified', function() {
  player.hls('manifest/absoluteUris.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(xhrUrls[1],
              'http://example.com/00001.ts',
              'the first segment is requested');
});

test('recognizes domain-relative URLs', function() {
  player.hls('manifest/domainUris.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(xhrUrls[1],
              window.location.origin + '/00001.ts',
              'the first segment is requested');
});

test('re-initializes the plugin for each source', function() {
  var firstInit, secondInit;
  player.hls('manifest/master.m3u8');
  firstInit = player.hls;
  player.hls('manifest/master.m3u8');
  secondInit = player.hls;

  notStrictEqual(firstInit, secondInit, 'the plugin object is replaced');
});

test('downloads media playlists after loading the master', function() {
  player.hls('manifest/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(xhrUrls[0], 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(xhrUrls[1],
              window.location.origin +
              window.location.pathname.split('/').slice(0, -1).join('/') +
              '/manifest/media.m3u8',
              'media playlist requested');
  strictEqual(xhrUrls[2],
              window.location.origin +
              window.location.pathname.split('/').slice(0, -1).join('/') +
              '/manifest/00001.ts',
              'first segment requested');
});

test('calculates the bandwidth after downloading a segment', function() {
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  ok(player.hls.bandwidth, 'bandwidth is calculated');
  ok(player.hls.bandwidth > 0,
     'bandwidth is positive: ' + player.hls.bandwidth);
  ok(player.hls.segmentXhrTime >= 0,
     'saves segment request time: ' + player.hls.segmentXhrTime + 's');
});

test('selects a playlist after segment downloads', function() {
  var calls = 0;
  player.hls('manifest/master.m3u8');
  player.hls.selectPlaylist = function() {
    calls++;
    return player.hls.master.playlists[0];
  };
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(calls, 1, 'selects after the initial segment');
  player.currentTime = function() {
    return 1;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 2);
  };
  player.trigger('timeupdate');
  strictEqual(calls, 2, 'selects after additional segments');
});

test('downloads additional playlists if required', function() {
  var
    called = false,
    playlist = {
      uri: 'media3.m3u8'
    };
  player.hls('manifest/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  // before an m3u8 is downloaded, no segments are available
  player.hls.selectPlaylist = function() {
    if (!called) {
      called = true;
      return playlist;
    }
    playlist.segments = [];
    return playlist;
  };
  xhrUrls = [];

  // the playlist selection is revisited after a new segment is downloaded
  player.currentTime = function() {
    return 1;
  };
  player.trigger('timeupdate');

  strictEqual(2, xhrUrls.length, 'requests were made');
  strictEqual(xhrUrls[1],
              window.location.origin +
              window.location.pathname.split('/').slice(0, -1).join('/') +
              '/manifest/' +
              playlist.uri,
              'made playlist request');
  strictEqual(playlist, player.hls.media, 'a new playlists was selected');
  ok(player.hls.media.segments, 'segments are now available');
});

test('selects a playlist below the current bandwidth', function() {
  var playlist;
  player.hls('manifest/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  // the default playlist has a really high bitrate
  player.hls.master.playlists[0].attributes.BANDWIDTH = 9e10;
  // playlist 1 has a very low bitrate
  player.hls.master.playlists[1].attributes.BANDWIDTH = 1;
  // but the detected client bandwidth is really low
  player.hls.bandwidth = 10;

  playlist = player.hls.selectPlaylist();
  strictEqual(playlist,
              player.hls.master.playlists[1],
              'the low bitrate stream is selected');
});

test('raises the minimum bitrate for a stream proportionially', function() {
  var playlist;
  player.hls('manifest/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  // the default playlist's bandwidth + 10% is equal to the current bandwidth
  player.hls.master.playlists[0].attributes.BANDWIDTH = 10;
  player.hls.bandwidth = 11;

  // 9.9 * 1.1 < 11
  player.hls.master.playlists[1].attributes.BANDWIDTH = 9.9;
  playlist = player.hls.selectPlaylist();

  strictEqual(playlist,
              player.hls.master.playlists[1],
              'a lower bitrate stream is selected');
});

test('uses the lowest bitrate if no other is suitable', function() {
  var playlist;
  player.hls('manifest/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  // the lowest bitrate playlist is much greater than 1b/s
  player.hls.bandwidth = 1;
  playlist = player.hls.selectPlaylist();

  // playlist 1 has the lowest advertised bitrate
  strictEqual(playlist,
              player.hls.master.playlists[1],
              'the lowest bitrate stream is selected');
});

test('does not download the next segment if the buffer is full', function() {
  player.hls('manifest/media.m3u8');
  player.currentTime = function() {
    return 15;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  player.trigger('timeupdate');

  strictEqual(xhrUrls.length, 1, 'no segment request was made');
});

test('downloads the next segment if the buffer is getting low', function() {
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  strictEqual(xhrUrls.length, 2, 'did not make a request');
  player.currentTime = function() {
    return 15;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 19.999);
  };
  player.trigger('timeupdate');

  strictEqual(xhrUrls.length, 3, 'made a request');
  strictEqual(xhrUrls[2],
              window.location.origin +
              window.location.pathname.split('/').slice(0, -1).join('/') +
              '/manifest/00002.ts',
              'made segment request');
});

test('stops downloading segments at the end of the playlist', function() {
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  xhrUrls = [];
  player.hls.mediaIndex = 4;
  player.trigger('timeupdate');

  strictEqual(xhrUrls.length, 0, 'no request is made');
});

test('only makes one segment request at a time', function() {
  var openedXhrs = 0;
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  // mock out a long-running XHR
  window.XMLHttpRequest = function() {
    this.send = function() {};
    this.open = function() {
      openedXhrs++;
    };
  };
  player.trigger('timeupdate');

  strictEqual(1, openedXhrs, 'one XHR is made');
  player.trigger('timeupdate');
  strictEqual(1, openedXhrs, 'only one XHR is made');
});

test('uses the currentSrc if no options are provided and it ends in ".m3u8"', function() {
  var url = 'http://example.com/services/mobile/streaming/index/master.m3u8?videoId=1824650741001';
  player.src(url);
  player.hls();
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(url, xhrUrls[0], 'currentSrc is used');
});

test('ignores currentSrc if it doesn\'t have the "m3u8" extension', function() {
  player.src('basdfasdfasdfliel//.m3u9');
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(xhrUrls.length, 0, 'no request is made');

  player.src('');
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(xhrUrls.length, 0, 'no request is made');

  player.src('http://example.com/movie.mp4?q=why.m3u8');
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(xhrUrls.length, 0, 'no request is made');

  player.src('http://example.m3u8/movie.mp4');
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(xhrUrls.length, 0, 'no request is made');

  player.src('//example.com/movie.mp4#http://tricky.com/master.m3u8');
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(xhrUrls.length, 0, 'no request is made');
});


module('segment controller', {
  setup: function() {
    segmentController = new window.videojs.hls.SegmentController();

  },
  teardown: function() {
    window.videojs.get = this.vjsget;
  }
});

test('bandwidth calulation test', function() {
  var
    multiSecondData = segmentController.calculateThroughput(10000, 1000, 2000),
    subSecondData = segmentController.calculateThroughput(10000, 1000, 1500);
  equal(multiSecondData, 80000, 'MULTI-Second bits per second calculation');
  equal(subSecondData, 160000, 'SUB-Second bits per second calculation');
});

})(window, window.videojs);

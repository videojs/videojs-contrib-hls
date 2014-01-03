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
        swf: '../node_modules/video.js/dist/video-js/video-js.swf',
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
        var manifestName = (/.*\/(.*)\.m3u8/).exec(xhrUrls.slice(-1)[0]);
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
  ok(player.hls.manifest, 'the manifest is available');
  ok(player.hls.manifest.segments, 'the segment entries are parsed');
  strictEqual(player.hls.manifest,
              player.hls.currentPlaylist,
              'the playlist is selected');
  strictEqual(player.hls.readyState(), 1, 'the readyState is HAVE_METADATA');
});

test('starts downloading a segment on loadedmetadata', function() {
  player.hls('manifest/media.m3u8');
  player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(xhrUrls[1], 'manifest/00001.ts', 'the first segment is requested');
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
  strictEqual(xhrUrls[2], 'manifest/00002.ts', 'made segment request');
});

test('stops downloading segments at the end of the playlist', function() {
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  xhrUrls = [];
  player.hls.currentMediaIndex = 4;
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

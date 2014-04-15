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
  oldFlashSupported,
  oldSegmentParser,
  oldSetTimeout,
  oldSourceBuffer,
  oldSupportsNativeHls,
  xhrUrls,
  requests,
  xhr,

  standardXHRResponse = function(request) {
    if (!request.url) {
      return;
    }

    var contentType = "application/json",
        // contents off the global object
        manifestName = (/(?:.*\/)?(.*)\.m3u8/).exec(request.url);

    if (manifestName) {
      manifestName = manifestName[1];
    } else {
      manifestName = request.url;
    }

    if (/\.m3u8?/.test(request.url)) {
      contentType = 'application/vnd.apple.mpegurl';
    } else if (/\.ts/.test(request.url)) {
      contentType = 'video/MP2T';
    }

    request.response = new Uint8Array([1]).buffer;
    request.respond(200,
                    {'Content-Type': contentType},
                    window.manifests[manifestName]);
  },

  mockSegmentParser = function(tags) {
    if (tags === undefined) {
      tags = [];
    }
    return function() {
      this.getFlvHeader = function() {
        return 'flv';
      };
      this.parseSegmentBinaryData = function() {};
      this.flushTags = function() {};
      this.tagsAvailable = function() {
        return tags.length;
      };
      this.getTags = function() {
        return tags;
      };
      this.getNextTag = function() {
        return tags.shift();
      };
    };
  };

module('HLS', {
  setup: function() {

    // mock out Flash features for phantomjs
    oldFlashSupported = videojs.Flash.isSupported;
    videojs.Flash.isSupported = function() {
      return true;
    };
    oldSourceBuffer = window.videojs.SourceBuffer;
    window.videojs.SourceBuffer = function() {
      this.appendBuffer = function() {};
      this.abort = function() {};
    };

    // force native HLS to be ignored
    oldSupportsNativeHls = videojs.hls.supportsNativeHls;
    videojs.hls.supportsNativeHls = false;

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

    // store functionality that some tests need to mock
    oldSegmentParser = videojs.hls.SegmentParser;
    oldSetTimeout = window.setTimeout;

    // make XHRs synchronous
    xhr = sinon.useFakeXMLHttpRequest();
    requests = [];
    xhr.onCreate = function(xhr) {
      requests.push(xhr);
    };
    xhrUrls = [];
  },

  teardown: function() {
    videojs.Flash.isSupported = oldFlashSupported;
    videojs.hls.supportsNativeHls = oldSupportsNativeHls;
    videojs.hls.SegmentParser = oldSegmentParser;
    videojs.SourceBuffer = oldSourceBuffer;
    window.setTimeout = oldSetTimeout;
    xhr.restore();
  }
});

test('starts playing if autoplay is specified', function() {
  var plays = 0;
  player.play = function() {
    plays++;
  };
  player.options().autoplay = true;
  player.hls('manifest/playlist.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  strictEqual(1, plays, 'play was called');
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
  standardXHRResponse(requests[0]);
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

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(calls, 2, 'duration is set');
});

test('calculates the duration if needed', function() {
  var durations = [];
  player.duration = function(duration) {
    if (duration === undefined) {
      return 0;
    }
    durations.push(duration);
  };
  player.hls('http://example.com/manifest/missingExtinf.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(durations.length, 2, 'duration is set');
  strictEqual(durations[0],
              player.hls.media.segments.length * 10,
              'duration is calculated');
});

test('starts downloading a segment on loadedmetadata', function() {
  player.hls('manifest/media.m3u8');
  player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(requests[1].url,
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

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(requests[1].url,
              'http://example.com/00001.ts',
              'the first segment is requested');
});

test('recognizes domain-relative URLs', function() {
  player.hls('manifest/domainUris.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(requests[1].url,
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

test('triggers an error when a master playlist request errors', function() {
  var
    status = 0,
    error;
  window.XMLHttpRequest = function() {
    this.open = function() {};
    this.send = function() {
      this.readyState = 4;
      this.status = status;
      this.onreadystatechange();
    };
  };

  player.on('error', function() {
    error = player.hls.error;
  });
  player.hls('manifest/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  ok(error, 'an error is triggered');
  strictEqual(2, error.code, 'a network error is triggered');
});

test('downloads media playlists after loading the master', function() {
  player.hls('manifest/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              window.location.origin +
              window.location.pathname.split('/').slice(0, -1).join('/') +
              '/manifest/media.m3u8',
              'media playlist requested');
  strictEqual(requests[2].url,
              window.location.origin +
              window.location.pathname.split('/').slice(0, -1).join('/') +
              '/manifest/00001.ts',
              'first segment requested');
});

test('timeupdates do not check to fill the buffer until a media playlist is ready', function() {
  var urls = [];
  window.XMLHttpRequest = function() {
    this.open = function(method, url) {
      urls.push(url);
    };
    this.send = function() {};
  };
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  player.trigger('timeupdate');

  strictEqual(1, urls.length, 'one request was made');
  strictEqual('manifest/media.m3u8', urls[0], 'media playlist requested');
});

test('calculates the bandwidth after downloading a segment', function() {
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

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

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(calls, 1, 'selects after the initial segment');
  player.currentTime = function() {
    return 1;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 2);
  };
  player.trigger('timeupdate');

  standardXHRResponse(requests[3]);
  strictEqual(calls, 2, 'selects after additional segments');
});

test('moves to the next segment if there is a network error', function() {
  var mediaIndex;

  player.hls('manifest/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  mediaIndex = player.hls.mediaIndex;
  player.trigger('timeupdate');

  requests[2].respond(400);
  strictEqual(mediaIndex + 1, player.hls.mediaIndex, 'media index is incremented');
});

test('updates the duration after switching playlists', function() {
  var
    calls = 0,
    selectedPlaylist = false;
  player.hls('manifest/master.m3u8');
  player.hls.selectPlaylist = function() {
    selectedPlaylist = true;
    return player.hls.master.playlists[1];
  };
  player.duration = function(duration) {
    if (duration === undefined) {
      return 0;
    }
    // only track calls that occur after the playlist has been switched
    if (player.hls.media === player.hls.master.playlists[1]) {
      calls++;
    }
  };
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);
  standardXHRResponse(requests[3]);
  ok(selectedPlaylist, 'selected playlist');
  strictEqual(calls, 1, 'updates the duration');
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

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  // before an m3u8 is downloaded, no segments are available
  player.hls.selectPlaylist = function() {
    if (!called) {
      called = true;
      return playlist;
    }
    playlist.segments = [1, 1, 1];
    return playlist;
  };

  // the playlist selection is revisited after a new segment is downloaded
  player.trigger('timeupdate');

  standardXHRResponse(requests[2]);
  standardXHRResponse(requests[3]);

  strictEqual(4, requests.length, 'requests were made');
  strictEqual(requests[3].url,
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

  standardXHRResponse(requests[0]);

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

  standardXHRResponse(requests[0]);

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

  standardXHRResponse(requests[0]);

  // the lowest bitrate playlist is much greater than 1b/s
  player.hls.bandwidth = 1;
  playlist = player.hls.selectPlaylist();

  // playlist 1 has the lowest advertised bitrate
  strictEqual(playlist,
              player.hls.master.playlists[1],
              'the lowest bitrate stream is selected');
});

test('selects the correct rendition by player dimensions', function() {
  var playlist;

  player.hls('manifest/master.m3u8');

  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);

  player.width(640);
  player.height(360);
  player.hls.bandwidth = 3000000;

  playlist = player.hls.selectPlaylist();

  deepEqual(playlist.attributes.RESOLUTION, {width:396,height:224},'should return the correct resolution by player dimensions');
  equal(playlist.attributes.BANDWIDTH, 440000, 'should have the expected bandwidth in case of multiple');

  player.width(1920);
  player.height(1080);
  player.hls.bandwidth = 3000000;

  playlist = player.hls.selectPlaylist();

  deepEqual(playlist.attributes.RESOLUTION, {width:960,height:540},'should return the correct resolution by player dimensions');
  equal(playlist.attributes.BANDWIDTH, 1928000, 'should have the expected bandwidth in case of multiple');

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

  standardXHRResponse(requests[0]);

  player.trigger('timeupdate');

  strictEqual(requests.length, 1, 'no segment request was made');
});

test('downloads the next segment if the buffer is getting low', function() {
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  strictEqual(requests.length, 2, 'did not make a request');
  player.currentTime = function() {
    return 15;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 19.999);
  };
  player.trigger('timeupdate');

  standardXHRResponse(requests[2]);

  strictEqual(requests.length, 3, 'made a request');
  strictEqual(requests[2].url,
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
  standardXHRResponse(requests[0]);
  requests = [];
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
  xhr.restore();
  var oldXHR = window.XMLHttpRequest;
  // mock out a long-running XHR
  window.XMLHttpRequest = function() {
    this.send = function() {};
    this.open = function() {
      openedXhrs++;
    };
  };
  standardXHRResponse(requests[0]);
  player.trigger('timeupdate');

  strictEqual(1, openedXhrs, 'one XHR is made');
  player.trigger('timeupdate');
  strictEqual(1, openedXhrs, 'only one XHR is made');
  window.XMLHttpRequest = oldXHR;
  xhr = sinon.useFakeXMLHttpRequest();
});

test('uses the src attribute if no options are provided and it ends in ".m3u8"', function() {
  var url = 'http://example.com/services/mobile/streaming/index/master.m3u8?videoId=1824650741001';
  player.el().querySelector('.vjs-tech').src = url;
  player.hls();
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(requests[0].url, url, 'currentSrc is used');
});

test('ignores src attribute if it doesn\'t have the "m3u8" extension', function() {
  var tech = player.el().querySelector('.vjs-tech');
  tech.src = 'basdfasdfasdfliel//.m3u9';
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(requests.length, 0, 'no request is made');

  tech.src = '';
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(requests.length, 0, 'no request is made');

  tech.src = 'http://example.com/movie.mp4?q=why.m3u8';
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(requests.length, 0, 'no request is made');

  tech.src = 'http://example.m3u8/movie.mp4';
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(requests.length, 0, 'no request is made');

  tech.src = '//example.com/movie.mp4#http://tricky.com/master.m3u8';
  player.hls();
  ok(!(player.currentSrc() in videojs.mediaSources), 'no media source is created');
  strictEqual(requests.length, 0, 'no request is made');
});

test('activates if the first playable source is HLS', function() {
  var video;
  document.querySelector('#qunit-fixture').innerHTML =
    '<video controls>' +
      '<source type="slartibartfast$%" src="movie.slarti">' +
      '<source type="application/x-mpegURL" src="movie.m3u8">' +
      '<source type="video/mp4" src="movie.mp4">' +
    '</video>';
  video = document.querySelector('#qunit-fixture video');
  player = videojs(video, {
    flash: {
      swf: '../node_modules/video.js/dist/video-js/video-js.swf'
    },
    techOrder: ['flash']
  });
  player.hls();

  ok(player.currentSrc() in videojs.mediaSources, 'media source created');
});

test('cancels outstanding XHRs when seeking', function() {
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  standardXHRResponse(requests[0]);
  player.hls.media = {
    segments: [{
      uri: '0.ts',
      duration: 10
    }, {
      uri: '1.ts',
      duration: 10
    }]
  };

  // trigger a segment download request
  player.trigger('timeupdate');
  // attempt to seek while the download is in progress
  player.trigger('seeking');

  ok(requests[1].aborted, 'XHR aborted');
  strictEqual(requests.length, 3, 'opened new XHR');
});

test('flushes the parser after each segment', function() {
  var flushes = 0;
  // mock out the segment parser
  videojs.hls.SegmentParser = function() {
    this.getFlvHeader = function() {
      return [];
    };
    this.parseSegmentBinaryData = function() {};
    this.flushTags = function() {
      flushes++;
    };
    this.tagsAvailable = function() {};
  };

  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(flushes, 1, 'tags are flushed at the end of a segment');
});

test('drops tags before the target timestamp when seeking', function() {
  var i = 10,
      callbacks = [],
      tags = [],
      bytes = [];

  // mock out the parser and source buffer
  videojs.hls.SegmentParser = mockSegmentParser(tags);
  window.videojs.SourceBuffer = function() {
    this.appendBuffer = function(chunk) {
      bytes.push(chunk);
    };
    this.abort = function() {};
  };
  // capture timeouts
  window.setTimeout = function(callback) {
    callbacks.push(callback);
  };

  // push a tag into the buffer
  tags.push({ pts: 0, bytes: 0 });

  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  while (callbacks.length) {
    callbacks.shift()();
  }

  // mock out a new segment of FLV tags
  bytes = [];
  while (i--) {
    tags.unshift({
      pts: i * 1000,
      bytes: i
    });
  }
  player.currentTime = function() {
    return 7;
  };
  player.trigger('seeking');
  standardXHRResponse(requests[2]);

  while (callbacks.length) {
    callbacks.shift()();
  }

  deepEqual(bytes, [7,8,9], 'three tags are appended');
});

test('clears pending buffer updates when seeking', function() {
  var
    bytes = [],
    callbacks = [],
    aborts = 0,
    tags = [{ pts: 0, bytes: 0 }];

  // mock out the parser and source buffer
  videojs.hls.SegmentParser = mockSegmentParser(tags);
  window.videojs.SourceBuffer = function() {
    this.appendBuffer = function(chunk) {
      bytes.push(chunk);
    };
    this.abort = function() {
      aborts++;
    };
  };
  // capture timeouts
  window.setTimeout = function(callback) {
    callbacks.push(callback);
  };

  // queue up a tag to be pushed into the buffer (but don't push it yet!)
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  // seek to 7s
  tags.push({ pts: 7000, bytes: 7 });
  player.currentTime = function() {
    return 7;
  };
  player.trigger('seeking');
  standardXHRResponse(requests[2]);

  while (callbacks.length) {
    callbacks.shift()();
  }

  strictEqual(1, aborts, 'aborted pending buffer');
});

test('playlist 404 should trigger MEDIA_ERR_NETWORK', function() {
  var errorTriggered = false;

  window.XMLHttpRequest = function() {
    this.open = function(method, url) {
      xhrUrls.push(url);
    };
    this.send = function() {
      this.readyState = 4;
      this.status = 404;
      this.onreadystatechange();
    };
  };

  player.hls('manifest/media.m3u8');

  player.on('error', function() {
    errorTriggered = true;
  });

  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  equal(true, errorTriggered, 'Missing Playlist error event should trigger');
  equal(2, player.hls.error.code, 'Player error code should be set to MediaError.MEDIA_ERR_NETWORK');
  ok(player.hls.error.message, 'Player error type should inform user correctly');
});

test('segment 404 should trigger MEDIA_ERR_NETWORK', function () {
  player.hls('manifest/media.m3u8');

  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  requests[1].respond(404);
  ok(player.hls.error.message, 'an error message is available');
  equal(2, player.hls.error.code, 'Player error code should be set to MediaError.MEDIA_ERR_NETWORK');
});

test('segment 500 should trigger MEDIA_ERR_ABORTED', function () {
  player.hls('manifest/media.m3u8');

  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  requests[1].respond(500);
  ok(player.hls.error.message, 'an error message is available');
  equal(4, player.hls.error.code, 'Player error code should be set to MediaError.MEDIA_ERR_ABORTED');
});

test('has no effect if native HLS is available', function() {
  videojs.hls.supportsNativeHls = true;
  player.hls('http://example.com/manifest/master.m3u8');

  ok(!(player.currentSrc() in videojs.mediaSources),
     'no media source was opened');
});

test('reloads live playlists', function() {
  var callbacks = [];
  // capture timeouts
  window.setTimeout = function(callback, timeout) {
    callbacks.push({ callback: callback, timeout: timeout });
  };
  player.hls('http://example.com/manifest/missingEndlist.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  standardXHRResponse(requests[0]);

  strictEqual(1, callbacks.length, 'refresh was scheduled');
  strictEqual(player.hls.media.targetDuration * 1000,
              callbacks[0].timeout,
              'waited one target duration');
});

test('duration is Infinity for live playlists', function() {
  player.hls('http://example.com/manifest/missingEndlist.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);

  strictEqual(player.duration(), Infinity, 'duration is infinity');
});

test('does not reload playlists with an endlist tag', function() {
  var callbacks = [];
  // capture timeouts
  window.setTimeout = function(callback, timeout) {
    callbacks.push({ callback: callback, timeout: timeout });
  };
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(0, callbacks.length, 'no refresh was scheduled');
});

test('reloads a live playlist after half a target duration if it has not ' +
     'changed since the last request', function() {
  var callbacks = [];
  // capture timeouts
  window.setTimeout = function(callback, timeout) {
    callbacks.push({ callback: callback, timeout: timeout });
  };
  player.hls('http://example.com/manifest/missingEndlist.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(callbacks.length, 1, 'full-length refresh scheduled');
  callbacks.pop().callback();
  standardXHRResponse(requests[2]);

  strictEqual(callbacks.length, 1, 'half-length refresh was scheduled');
  strictEqual(callbacks[0].timeout,
              player.hls.media.targetDuration / 2 * 1000,
              'waited half a target duration');
});

test('merges playlist reloads', function() {
  var oldPlaylist,
      callback;

  // capture timeouts
  window.setTimeout = function(cb) {
    callback = cb;
  };

  player.hls('http://example.com/manifest/missingEndlist.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  oldPlaylist = player.hls.media;

  callback();
  standardXHRResponse(requests[2]);
  ok(oldPlaylist !== player.hls.media, 'player.hls.media was updated');
});

test('updates the media index when a playlist reloads', function() {
  var callback;
  window.setTimeout = function(cb) {
    callback = cb;
  };
  // the initial playlist
  window.manifests['live-updating'] =
    '#EXTM3U\n' +
    '#EXTINF:10,\n' +
    '0.ts\n' +
    '#EXTINF:10,\n' +
    '1.ts\n' +
    '#EXTINF:10,\n' +
    '2.ts\n';

  player.hls('http://example.com/live-updating.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  // play the stream until 2.ts is playing
  player.hls.mediaIndex = 3;

  // reload the updated playlist
  window.manifests['live-updating'] =
    '#EXTM3U\n' +
    '#EXTINF:10,\n' +
    '1.ts\n' +
    '#EXTINF:10,\n' +
    '2.ts\n' +
    '#EXTINF:10,\n' +
    '3.ts\n';
  callback();
  standardXHRResponse(requests[2]);

  strictEqual(player.hls.mediaIndex, 2, 'mediaIndex is updated after the reload');
});

test('mediaIndex is zero before the first segment loads', function() {
  window.manifests['first-seg-load'] =
    '#EXTM3U\n' +
    '#EXTINF:10,\n' +
    '0.ts\n';
  window.XMLHttpRequest = function() {
    this.open = function() {};
    this.send = function() {};
  };
  player.hls('http://example.com/first-seg-load.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(player.hls.mediaIndex, 0, 'mediaIndex is zero');
});

test('reloads out-of-date live playlists when switching variants', function() {
  player.hls('http://example.com/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  player.hls.master = {
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
  player.hls.media = player.hls.master.playlists[0];
  player.mediaIndex = 1;
  window.manifests['variant-update'] = '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:16\n' +
    '#EXTINF:10,\n' +
    '16.ts\n' +
    '#EXTINF:10,\n' +
    '17.ts\n';

  // switch playlists
  player.hls.selectPlaylist = function() {
    return player.hls.master.playlists[1];
  };
  // timeupdate downloads segment 16 then switches playlists
  player.trigger('timeupdate');

  strictEqual(player.mediaIndex, 1, 'mediaIndex points at the next segment');
});

test('does not reload master playlists', function() {
  var callbacks = [];
  window.setTimeout = function(callback) {
    callbacks.push(callback);
  };

  player.hls('http://example.com/master.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(callbacks.length, 0, 'no reload scheduled');
});

test('only reloads the active media playlist', function() {
  var callbacks = [],
      i = 0,
      filteredRequests = [],
      customResponse;

  customResponse = function(request) {
    request.response = new Uint8Array([1]).buffer;
    request.respond(200,
                    {'Content-Type': 'application/vnd.apple.mpegurl'},
                    '#EXTM3U\n' +
                    '#EXT-X-MEDIA-SEQUENCE:1\n' +
                    '#EXTINF:10,\n' +
                    '1.ts\n');
  };

  window.setTimeout = function(callback) {
    callbacks.push(callback);
  };

  player.hls('http://example.com/missingEndlist.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  videojs.mediaSources[player.currentSrc()].endOfStream = function() {};

  player.hls.selectPlaylist = function() {
    return player.hls.master.playlists[1];
  };
  player.hls.master.playlists.push({
    uri: 'http://example.com/switched.m3u8'
  });

  player.trigger('timeupdate');
  strictEqual(callbacks.length, 1, 'a refresh is scheduled');

  standardXHRResponse(requests[2]); // segment response
  customResponse(requests[3]); // loaded witched.m3u8

  callbacks.shift()(); // out-of-date refresh of missingEndlist.m3u8
  callbacks.shift()(); // refresh switched.m3u8

  for (; i < requests.length; i++) {
    if (/switched/.test(requests[i].url)) {
      filteredRequests.push(requests[i]);
    }
  }
  strictEqual(filteredRequests.length, 2, 'one refresh was made');
  strictEqual(filteredRequests[1].url,
              'http://example.com/switched.m3u8',
              'refreshed the active playlist');

});

test('if withCredentials option is used, withCredentials is set on the XHR object', function() {
  player.hls({
    url: 'http://example.com/media.m3u8',
    withCredentials: true
  });
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
  ok(requests[0].withCredentials, "with credentials should be set to true if that option is passed in");
});

test('does not break if the playlist has no segments', function() {
  var customResponse = function(request) {
    request.response = new Uint8Array([1]).buffer;
    request.respond(200,
                    {'Content-Type': 'application/vnd.apple.mpegurl'},
                    '#EXTM3U\n' +
                    '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                    '#EXT-X-TARGETDURATION:10\n');
  };
  player.hls('manifest/master.m3u8');
  try {
    videojs.mediaSources[player.currentSrc()].trigger({
      type: 'sourceopen'
    });
    customResponse(requests[0]);
  } catch(e) {
    ok(false, 'an error was thrown');
    throw e;
  }
  ok(true, 'no error was thrown');
  strictEqual(requests.length, 1, 'no requests for non-existent segments were queued');
});

})(window, window.videojs);

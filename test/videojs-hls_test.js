(function(window, videojs, undefined) {
  'use strict';
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
  oldMediaSourceOpen,
  oldSegmentParser,
  oldSetTimeout,
  oldSourceBuffer,
  oldFlashSupported,
  requests,
  xhr,

  createPlayer = function(options) {
    var tech, video, player;
    video = document.createElement('video');
    document.querySelector('#qunit-fixture').appendChild(video);
    player = videojs(video, {
      flash: {
        swf: ''
      },
      techOrder: ['hls'],
      hls: options || {}
    });

    player.buffered = function() {
      return videojs.createTimeRange(0, 0);
    };

    tech = player.el().querySelector('.vjs-tech');
    tech.vjs_getProperty = function() {};
    tech.vjs_setProperty = function() {};
    tech.vjs_src = function() {};
    videojs.Flash.onReady(tech.id);

    return player;
  },
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
    oldMediaSourceOpen = videojs.MediaSource.open;
    videojs.MediaSource.open = function() {};

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

    // store functionality that some tests need to mock
    oldSegmentParser = videojs.Hls.SegmentParser;
    oldSetTimeout = window.setTimeout;

    // fake XHRs
    xhr = sinon.useFakeXMLHttpRequest();
    requests = [];
    xhr.onCreate = function(xhr) {
      requests.push(xhr);
    };

    // create the test player
    player = createPlayer();
  },

  teardown: function() {
    player.dispose();
    videojs.Flash.isSupported = oldFlashSupported;
    videojs.MediaSource.open = oldMediaSourceOpen;
    videojs.Hls.SegmentParser = oldSegmentParser;
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
  player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  strictEqual(1, plays, 'play was called');
});

test('creates a PlaylistLoader on init', function() {
  var loadedmetadata = false;
  player.on('loadedmetadata', function() {
    loadedmetadata = true;
  });

  ok(!player.hls.playlists, 'waits for set src to create the loader');
  player.src({
    src:'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });
  standardXHRResponse(requests[0]);
  ok(loadedmetadata, 'loadedmetadata fires');
  ok(player.hls.playlists.master, 'set the master playlist');
  ok(player.hls.playlists.media(), 'set the media playlist');
  ok(player.hls.playlists.media().segments, 'the segment entries are parsed');
  strictEqual(player.hls.playlists.master.playlists[0],
              player.hls.playlists.media(),
              'the playlist is selected');
});

test('sets the duration if one is available on the playlist', function() {
  var calls = 0;
  player.duration = function(value) {
    if (value === undefined) {
      return 0;
    }
    calls++;
  };
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  strictEqual(calls, 1, 'duration is set');
  standardXHRResponse(requests[1]);
  strictEqual(calls, 1, 'duration is set');
});

test('calculates the duration if needed', function() {
  var durations = [];
  player.duration = function(duration) {
    if (duration === undefined) {
      return 0;
    }
    durations.push(duration);
  };
  player.src({
    src: 'http://example.com/manifest/missingExtinf.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  strictEqual(durations.length, 1, 'duration is set');
  strictEqual(durations[0],
              player.hls.playlists.media().segments.length * 10,
              'duration is calculated');
});

test('starts downloading a segment on loadedmetadata', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  player.hls.mediaSource.trigger({
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
  player.src({
    src: 'manifest/absoluteUris.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(requests[1].url,
              'http://example.com/00001.ts',
              'the first segment is requested');
});

test('recognizes domain-relative URLs', function() {
  player.src({
    src: 'manifest/domainUris.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(requests[1].url,
              window.location.origin + '/00001.ts',
              'the first segment is requested');
});

test('re-initializes the tech for each source', function() {
  var firstPlaylists, secondPlaylists, firstMSE, secondMSE;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });
  firstPlaylists = player.hls.playlists;
  firstMSE = player.hls.mediaSource;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });
  secondPlaylists = player.hls.playlists;
  secondMSE = player.hls.mediaSource;

  notStrictEqual(firstPlaylists, secondPlaylists, 'the playlist object is not reused');
  notStrictEqual(firstMSE, secondMSE, 'the media source object is not reused');
});

test('triggers an error when a master playlist request errors', function() {
  var error;
  player.on('error', function() {
    error = player.hls.error;
  });
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });
  requests.pop().respond(500);

  ok(error, 'an error is triggered');
  strictEqual(2, error.code, 'a network error is triggered');
});

test('downloads media playlists after loading the master', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });
  player.trigger('timeupdate');

  strictEqual(1, urls.length, 'one request was made');
  strictEqual('manifest/media.m3u8', urls[0], 'media playlist requested');
});

test('calculates the bandwidth after downloading a segment', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.selectPlaylist = function() {
    calls++;
    return player.hls.playlists.master.playlists[0];
  };
  player.hls.mediaSource.trigger({
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
  console.log(requests.map(function(i) { return i.url; }));
  strictEqual(calls, 2, 'selects after additional segments');
});

test('moves to the next segment if there is a network error', function() {
  var mediaIndex;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.selectPlaylist = function() {
    selectedPlaylist = true;
    return player.hls.playlists.master.playlists[1];
  };
  player.duration = function(duration) {
    if (duration === undefined) {
      return 0;
    }
    // only track calls that occur after the playlist has been switched
    if (player.hls.playlists.media() === player.hls.playlists.master.playlists[1]) {
      calls++;
    }
  };
  player.hls.mediaSource.trigger({
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
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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
  strictEqual(playlist.uri,
              player.hls.playlists.media().uri,
              'a new playlists was selected');
  ok(player.hls.playlists.media().segments, 'segments are now available');
});

test('selects a playlist below the current bandwidth', function() {
  var playlist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);

  // the default playlist has a really high bitrate
  player.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 9e10;
  // playlist 1 has a very low bitrate
  player.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 1;
  // but the detected client bandwidth is really low
  player.hls.bandwidth = 10;

  playlist = player.hls.selectPlaylist();
  strictEqual(playlist,
              player.hls.playlists.master.playlists[1],
              'the low bitrate stream is selected');
});

test('raises the minimum bitrate for a stream proportionially', function() {
  var playlist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);

  // the default playlist's bandwidth + 10% is equal to the current bandwidth
  player.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 10;
  player.hls.bandwidth = 11;

  // 9.9 * 1.1 < 11
  player.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 9.9;
  playlist = player.hls.selectPlaylist();

  strictEqual(playlist,
              player.hls.playlists.master.playlists[1],
              'a lower bitrate stream is selected');
});

test('uses the lowest bitrate if no other is suitable', function() {
  var playlist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);

  // the lowest bitrate playlist is much greater than 1b/s
  player.hls.bandwidth = 1;
  playlist = player.hls.selectPlaylist();

  // playlist 1 has the lowest advertised bitrate
  strictEqual(playlist,
              player.hls.playlists.master.playlists[1],
              'the lowest bitrate stream is selected');
});

test('selects the correct rendition by player dimensions', function() {
  var playlist;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  player.hls.mediaSource.trigger({
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
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.currentTime = function() {
    return 15;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);

  player.trigger('timeupdate');

  strictEqual(requests.length, 1, 'no segment request was made');
});

test('downloads the next segment if the buffer is getting low', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });
  standardXHRResponse(requests[0]);
  requests = [];
  player.hls.mediaIndex = 4;
  player.trigger('timeupdate');

  strictEqual(requests.length, 0, 'no request is made');
});

test('only makes one segment request at a time', function() {
  var openedXhrs = 0;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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

test('cancels outstanding XHRs when seeking', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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
  player.currentTime(7);

  ok(requests[1].aborted, 'XHR aborted');
  strictEqual(requests.length, 3, 'opened new XHR');
});

test('flushes the parser after each segment', function() {
  var flushes = 0;
  // mock out the segment parser
  videojs.Hls.SegmentParser = function() {
    this.getFlvHeader = function() {
      return [];
    };
    this.parseSegmentBinaryData = function() {};
    this.flushTags = function() {
      flushes++;
    };
    this.tagsAvailable = function() {};
  };

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
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

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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
  player.currentTime(7);
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
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
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
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  // seek to 7s
  tags.push({ pts: 7000, bytes: 7 });
  player.currentTime(7);
  standardXHRResponse(requests[2]);

  while (callbacks.length) {
    callbacks.shift()();
  }

  strictEqual(1, aborts, 'aborted pending buffer');
});

test('playlist 404 should trigger MEDIA_ERR_NETWORK', function() {
  var errorTriggered = false;
  player.on('error', function() {
    errorTriggered = true;
  });
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });
  requests.pop().respond(404);

  equal(errorTriggered,
        true,
        'Missing Playlist error event should trigger');
  equal(player.hls.error.code,
        2,
        'Player error code should be set to MediaError.MEDIA_ERR_NETWORK');
  ok(player.hls.error.message, 'Player error type should inform user correctly');
});

test('segment 404 should trigger MEDIA_ERR_NETWORK', function () {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  requests[1].respond(404);
  ok(player.hls.error.message, 'an error message is available');
  equal(2, player.hls.error.code, 'Player error code should be set to MediaError.MEDIA_ERR_NETWORK');
});

test('segment 500 should trigger MEDIA_ERR_ABORTED', function () {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  standardXHRResponse(requests[0]);
  requests[1].respond(500);
  ok(player.hls.error.message, 'an error message is available');
  equal(4, player.hls.error.code, 'Player error code should be set to MediaError.MEDIA_ERR_ABORTED');
});

test('duration is Infinity for live playlists', function() {
  player.src({
    src: 'http://example.com/manifest/missingEndlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  strictEqual(0, callbacks.length, 'no refresh was scheduled');
});

test('updates the media index when a playlist reloads', function() {
  player.src({
    src: 'http://example.com/live-updating.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  requests[0].respond(200, null,
                      '#EXTM3U\n' +
                      '#EXTINF:10,\n' +
                      '0.ts\n' +
                      '#EXTINF:10,\n' +
                      '1.ts\n' +
                      '#EXTINF:10,\n' +
                      '2.ts\n');
  standardXHRResponse(requests[1]);
  // play the stream until 2.ts is playing
  player.hls.mediaIndex = 3;

  // reload the updated playlist
  player.hls.playlists.media = function() {
    return {
      segments: [{
        uri: '1.ts'
      }, {
        uri: '2.ts'
      }, {
        uri: '3.ts'
      }]
    };
  };
  player.hls.playlists.trigger('loadedplaylist');

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
  player.src({
    src: 'http://example.com/first-seg-load.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  strictEqual(player.hls.mediaIndex, 0, 'mediaIndex is zero');
});

test('reloads out-of-date live playlists when switching variants', function() {
  player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
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

  player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });

  strictEqual(callbacks.length,
              0, 'no reload scheduled');
});

test('if withCredentials option is used, withCredentials is set on the XHR object', function() {
  player.dispose();
  player = createPlayer({
    withCredentials: true
  });
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });
  ok(requests[0].withCredentials, "with credentials should be set to true if that option is passed in");
});

test('does not break if the playlist has no segments', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  try {
    player.hls.mediaSource.trigger({
      type: 'sourceopen'
    });
    requests[0].respond(200, null,
                        '#EXTM3U\n' +
                        '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                        '#EXT-X-TARGETDURATION:10\n');
  } catch(e) {
    ok(false, 'an error was thrown');
    throw e;
  }
  ok(true, 'no error was thrown');
  strictEqual(requests.length, 1, 'no requests for non-existent segments were queued');
});

test('disposes the playlist loader', function() {
  var disposes = 0, player;
  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.mediaSource.trigger({
    type: 'sourceopen'
  });
  player.hls.playlists.dispose = function() {
    disposes++;
  };

  player.dispose();
  strictEqual(disposes, 1, 'disposed playlist loader');
});

})(window, window.videojs);

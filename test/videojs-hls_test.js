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
  oldNativeHlsSupport,
  oldDecrypt,
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
      hls: options || {}
    });

    player.buffered = function() {
      return videojs.createTimeRange(0, 0);
    };

    tech = player.el().querySelector('.vjs-tech');
    tech.vjs_getProperty = function() {};
    tech.vjs_setProperty = function() {};
    tech.vjs_src = function() {};
    tech.vjs_play = function() {};
    videojs.Flash.onReady(tech.id);

    return player;
  },
  openMediaSource = function(player) {
    player.hls.mediaSource.trigger({
      type: 'sourceopen'
    });
    // endOfStream triggers an exception if flash isn't available
    player.hls.mediaSource.endOfStream = function() {};
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
                    { 'Content-Type': contentType },
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

    oldNativeHlsSupport = videojs.Hls.supportsNativeHls;

    oldDecrypt = videojs.Hls.decrypt;
    videojs.Hls.decrypt = function() {
      return new Uint8Array([0]);
    };

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
    videojs.Hls.supportsNativeHls = oldNativeHlsSupport;
    videojs.Hls.decrypt = oldDecrypt;
    videojs.SourceBuffer = oldSourceBuffer;
    window.setTimeout = oldSetTimeout;
    xhr.restore();
  }
});

test('starts playing if autoplay is specified', function() {
  var plays = 0;
  player.options().autoplay = true;
  player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  // make sure play() is called *after* the media source opens
  player.play = function() {
    plays++;
  };
  openMediaSource(player);

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
  openMediaSource(player);
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
  openMediaSource(player);

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
  openMediaSource(player);

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
  openMediaSource(player);

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
  openMediaSource(player);

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
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(requests[1].url,
              window.location.origin + '/00001.ts',
              'the first segment is requested');
});

test('re-initializes the tech for each source', function() {
  var firstPlaylists, secondPlaylists, firstMSE, secondMSE, aborts;

  aborts = 0;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  firstPlaylists = player.hls.playlists;
  firstMSE = player.hls.mediaSource;
  player.hls.sourceBuffer.abort = function() {
    aborts++;
  };
  standardXHRResponse(requests.shift());
  standardXHRResponse(requests.shift());

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  secondPlaylists = player.hls.playlists;
  secondMSE = player.hls.mediaSource;

  equal(1, aborts, 'aborted the old source buffer');
  ok(requests[0].aborted, 'aborted the old segment request');
  notStrictEqual(firstPlaylists, secondPlaylists, 'the playlist object is not reused');
  notStrictEqual(firstMSE, secondMSE, 'the media source object is not reused');
});

test('triggers an error when a master playlist request errors', function() {
  var errors = 0;
  player.on('error', function() {
    errors++;
  });
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.pop().respond(500);

  ok(player.error(), 'an error is triggered');
  strictEqual(1, errors, 'fired one error');
  strictEqual(2, player.error().code, 'a network error is triggered');
});

test('downloads media playlists after loading the master', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

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
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.trigger('timeupdate');

  strictEqual(1, requests.length, 'one request was made');
  strictEqual('manifest/media.m3u8', requests[0].url, 'media playlist requested');
});

test('calculates the bandwidth after downloading a segment', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  // set the request time to be a bit earlier so our bandwidth calculations are NaN
  requests[1].requestTime = (new Date())-100;

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
  openMediaSource(player);

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

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

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
  openMediaSource(player);

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
  openMediaSource(player);

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
  openMediaSource(player);

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
  openMediaSource(player);

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
  openMediaSource(player);

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

  openMediaSource(player);

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
  var currentTime = 15;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.currentTime = function() {
    return currentTime;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, currentTime + videojs.Hls.GOAL_BUFFER_LENGTH);
  };
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.trigger('timeupdate');

  strictEqual(requests.length, 1, 'no segment request was made');
});

test('downloads the next segment if the buffer is getting low', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

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
  openMediaSource(player);
  standardXHRResponse(requests[0]);
  requests = [];
  player.hls.mediaIndex = 4;
  player.trigger('timeupdate');

  strictEqual(requests.length, 0, 'no request is made');
});

test('only makes one segment request at a time', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop());
  player.trigger('timeupdate');

  strictEqual(1, requests.length, 'one XHR is made');
  player.trigger('timeupdate');
  strictEqual(1, requests.length, 'only one XHR is made');
});

test('cancels outstanding XHRs when seeking', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
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

test('when outstanding XHRs are cancelled, they get aborted properly', function() {
  var readystatechanges = 0;

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests[0]);

  // trigger a segment download request
  player.trigger('timeupdate');

  player.hls.segmentXhr_.onreadystatechange = function() {
    readystatechanges++;
  };

  // attempt to seek while the download is in progress
  player.currentTime(12);

  ok(requests[1].aborted, 'XHR aborted');
  strictEqual(requests.length, 3, 'opened new XHR');
  notEqual(player.hls.segmentXhr_.url, requests[1].url, 'a new segment is request that is not the aborted one');
  strictEqual(readystatechanges, 0, 'onreadystatechange was not called');
});

test('segmentXhr is properly nulled out when dispose is called', function() {
  var
    readystatechanges = 0,
    oldDispose = videojs.Flash.prototype.dispose;
  videojs.Flash.prototype.dispose = function() {};

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests[0]);

  // trigger a segment download request
  player.trigger('timeupdate');

  player.hls.segmentXhr_.onreadystatechange = function() {
    readystatechanges++;
  };

  player.hls.dispose();

  ok(requests[1].aborted, 'XHR aborted');
  strictEqual(requests.length, 2, 'did not open a new XHR');
  equal(player.hls.segmentXhr_, null, 'the segment xhr is nulled out');
  strictEqual(readystatechanges, 0, 'onreadystatechange was not called');

  videojs.Flash.prototype.dispose = oldDispose;
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
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  strictEqual(flushes, 1, 'tags are flushed at the end of a segment');
});

test('drops tags before the target timestamp when seeking', function() {
  var i = 10,
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

  // push a tag into the buffer
  tags.push({ pts: 0, bytes: 0 });

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

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

  deepEqual(bytes, [7,8,9], 'three tags are appended');
});

test('calls abort() on the SourceBuffer before seeking', function() {
  var
    aborts = 0,
    bytes = [],
    tags = [{ pts: 0, bytes: 0 }];


  // track calls to abort()
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  window.videojs.SourceBuffer = function() {
    this.appendBuffer = function(chunk) {
      bytes.push(chunk);
    };
    this.abort = function() {
      aborts++;
    };
  };

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  // drainBuffer() uses the first PTS value to account for any timestamp discontinuities in the stream
  // adding a tag with a PTS of zero looks like a stream with no discontinuities
  tags.push({ pts: 0, bytes: 0 });
  tags.push({ pts: 7000, bytes: 7 });
  // seek to 7s
  player.currentTime(7);
  standardXHRResponse(requests[2]);

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
  openMediaSource(player);
  requests.pop().respond(404);

  equal(errorTriggered,
        true,
        'Missing Playlist error event should trigger');
  equal(player.error().code,
        2,
        'Player error code should be set to MediaError.MEDIA_ERR_NETWORK');
  ok(player.error().message, 'included an error message');
});

test('segment 404 should trigger MEDIA_ERR_NETWORK', function () {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(player);

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

  openMediaSource(player);

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
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  strictEqual(player.duration(), Infinity, 'duration is infinity');
  ok((' ' + player.el().className + ' ').indexOf(' vjs-live ') >= 0, 'added vjs-live class');
});

test('updates the media index when a playlist reloads', function() {
  player.src({
    src: 'http://example.com/live-updating.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

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
  player.src({
    src: 'http://example.com/first-seg-load.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  strictEqual(player.hls.mediaIndex, 0, 'mediaIndex is zero');
});

test('reloads out-of-date live playlists when switching variants', function() {
  player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

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

test('if withCredentials option is used, withCredentials is set on the XHR object', function() {
  player.dispose();
  player = createPlayer({
    withCredentials: true
  });
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  ok(requests[0].withCredentials, "with credentials should be set to true if that option is passed in");
});

test('does not break if the playlist has no segments', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  try {
    openMediaSource(player);
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

test('waits until the buffer is empty before appending bytes at a discontinuity', function() {
  var aborts = 0, setTime, currentTime, bufferEnd;

  player.src({
    src: 'disc.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.currentTime = function() { return currentTime; };
  player.buffered = function() {
    return videojs.createTimeRange(0, bufferEnd);
  };
  player.hls.sourceBuffer.abort = function() {
    aborts++;
  };
  player.hls.el().vjs_setProperty = function(name, value) {
    if (name === 'currentTime') {
      return setTime = value;
    }
  };

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXTINF:10,0\n' +
                         '1.ts\n' +
                         '#EXT-X-DISCONTINUITY\n' +
                         '#EXTINF:10,0\n' +
                         '2.ts\n');
  standardXHRResponse(requests.pop());

  // play to 6s to trigger the next segment request
  currentTime = 6;
  bufferEnd = 10;
  player.trigger('timeupdate');
  strictEqual(aborts, 0, 'no aborts before the buffer empties');

  standardXHRResponse(requests.pop());
  strictEqual(aborts, 0, 'no aborts before the buffer empties');

  // pretend the buffer has emptied
  player.trigger('waiting');
  strictEqual(aborts, 1, 'aborted before appending the new segment');
  strictEqual(setTime, 10, 'updated the time after crossing the discontinuity');
});

test('clears the segment buffer on seek', function() {
  var aborts = 0, tags = [], currentTime, bufferEnd, oldCurrentTime;

  videojs.Hls.SegmentParser = mockSegmentParser(tags);

  player.src({
    src: 'disc.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  oldCurrentTime = player.currentTime;
  player.currentTime = function(time) {
    if (time !== undefined) {
      return oldCurrentTime.call(player, time);
    }
    return currentTime;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, bufferEnd);
  };
  player.hls.sourceBuffer.abort = function() {
    aborts++;
  };

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXTINF:10,0\n' +
                         '1.ts\n' +
                         '#EXT-X-DISCONTINUITY\n' +
                         '#EXTINF:10,0\n' +
                         '2.ts\n');
  standardXHRResponse(requests.pop());

  // play to 6s to trigger the next segment request
  currentTime = 6;
  bufferEnd = 10;
  player.trigger('timeupdate');

  standardXHRResponse(requests.pop());

  // seek back to the beginning
  player.currentTime(0);
  tags.push({ pts: 0, bytes: 0 });
  standardXHRResponse(requests.pop());
  strictEqual(aborts, 1, 'aborted once for the seek');

  // the source buffer empties. is 2.ts still in the segment buffer?
  player.trigger('waiting');
  strictEqual(aborts, 1, 'cleared the segment buffer on a seek');
});

test('resets the switching algorithm if a request times out', function() {
  player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media.m3u8
  // simulate a segment timeout
  requests[0].timedout = true;
  requests.shift().abort();

  standardXHRResponse(requests.shift());

  strictEqual(player.hls.playlists.media(),
              player.hls.playlists.master.playlists[1],
              'reset to the lowest bitrate playlist');
});

test('disposes the playlist loader', function() {
  var disposes = 0, player, loaderDispose;
  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  loaderDispose = player.hls.playlists.dispose;
  player.hls.playlists.dispose = function() {
    disposes++;
    loaderDispose.call(player.hls.playlists);
  };

  player.dispose();
  strictEqual(disposes, 1, 'disposed playlist loader');
});

test('remove event handlers on dispose', function() {
  var
    player,
    onhandlers = 0,
    offhandlers = 0,
    oldOn,
    oldOff;

  player = createPlayer();
  oldOn = player.on;
  oldOff = player.off;
  player.on = function(type, handler) {
    onhandlers++;
    oldOn.call(player, type, handler);
  };
  player.off = function(type, handler) {
    // ignore the top-level videojs removals that aren't relevant to HLS
    if (type && type !== 'dispose') {
      offhandlers++;
    }
    oldOff.call(player, type, handler);
  };
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.hls.playlists.trigger('loadedmetadata');

  player.dispose();

  equal(offhandlers, onhandlers, 'the amount of on and off handlers is the same');

  player.off = oldOff;
  player.on = oldOn;
});

test('aborts the source buffer on disposal', function() {
  var aborts = 0, player;
  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.hls.sourceBuffer.abort = function() {
    aborts++;
  };

  player.dispose();
  strictEqual(aborts, 1, 'aborted the source buffer');
});

test('only supports HLS MIME types', function() {
  ok(videojs.Hls.canPlaySource({
    type: 'aPplicatiOn/x-MPegUrl'
  }), 'supports x-mpegurl');
  ok(videojs.Hls.canPlaySource({
    type: 'aPplicatiOn/VnD.aPPle.MpEgUrL'
  }), 'supports vnd.apple.mpegurl');

  ok(!videojs.Hls.canPlaySource({
    type: 'video/mp4'
  }), 'does not support mp4');
  ok(!videojs.Hls.canPlaySource({
    type: 'video/x-flv'
  }), 'does not support flv');
});

test('adds Hls to the default tech order', function() {
  strictEqual(videojs.options.techOrder[0], 'hls', 'first entry is Hls');
});

test('has no effect if native HLS is available', function() {
  var player;
  videojs.Hls.supportsNativeHls = true;
  player = createPlayer();
  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  ok(!player.hls, 'did not load hls tech');
  player.dispose();
});

test('is not supported on browsers without typed arrays', function() {
  var oldArray = window.Uint8Array;
  window.Uint8Array = null;
  ok(!videojs.Hls.isSupported(), 'HLS is not supported');

  // cleanup
  window.Uint8Array = oldArray;
});

test('tracks the bytes downloaded', function() {
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  strictEqual(player.hls.bytesReceived, 0, 'no bytes received');

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXTINF:10,\n' +
                           '1.ts\n' +
                           '#EXT-X-ENDLIST\n');
  // transmit some segment bytes
  requests[0].response = new ArrayBuffer(17);
  requests.shift().respond(200, null, '');

  strictEqual(player.hls.bytesReceived, 17, 'tracked bytes received');

  player.trigger('timeupdate');

  // transmit some more
  requests[0].response = new ArrayBuffer(5);
  requests.shift().respond(200, null, '');

  strictEqual(player.hls.bytesReceived, 22, 'tracked more bytes');
});

test('re-emits mediachange events', function() {
  var mediaChanges = 0;
  player.on('mediachange', function() {
    mediaChanges++;
  });

  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.hls.playlists.trigger('mediachange');
  strictEqual(mediaChanges, 1, 'fired mediachange');
});

test('can be disposed before finishing initialization', function() {
  var player = createPlayer(), readyHandlers = [];
  player.ready = function(callback) {
    readyHandlers.push(callback);
  };
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.src({
    src: 'http://example.com/media.mp4',
    type: 'video/mp4'
  });
  ok(readyHandlers.length > 0, 'registered a ready handler');
  try {
    while (readyHandlers.length) {
      readyHandlers.shift().call(player);
    }
    ok(true, 'did not throw an exception');
  } catch (e) {
    ok(false, 'threw an exception');
  }
});

test('calls ended() on the media source at the end of a playlist', function() {
  var endOfStreams = 0;
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.hls.mediaSource.endOfStream = function() {
    endOfStreams++;
  };
  // playlist response
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXT-X-ENDLIST\n');
  // segment response
  requests[0].response = new ArrayBuffer(17);
  requests.shift().respond(200, null, '');

  strictEqual(endOfStreams, 1, 'ended media source');
});

test('calling play() at the end of a video resets the media index', function() {
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.shift());

  strictEqual(player.hls.mediaIndex, 1, 'index is 1 after the first segment');
  player.hls.ended = function() {
    return true;
  };
  player.play();
  strictEqual(player.hls.mediaIndex, 0, 'index is 1 after the first segment');
});

test('calling fetchKeys() when a new playlist is loaded will create an XHR', function() {
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  var oldMedia = player.hls.playlists.media;
  player.hls.playlists.media = function() {
    return {
      segments: [{
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=52'
        },
        uri: 'http://media.example.com/fileSequence52-A.ts'
      }, {
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=53'
        },
        uri: 'http://media.example.com/fileSequence53-B.ts'
      }]
    };
  };

  player.hls.playlists.trigger('loadedplaylist');
  strictEqual(requests.length, 2, 'a key XHR is created');
  strictEqual(requests[1].url, player.hls.playlists.media().segments[0].key.uri, 'a key XHR is created with correct uri');

  player.hls.playlists.media = oldMedia;
});

test('a new keys XHR is created when a previous key XHR finishes', function() {
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  var oldMedia = player.hls.playlists.media;
  player.hls.playlists.media = function() {
    return {
      segments: [{
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=52'
        },
        uri: 'http://media.example.com/fileSequence52-A.ts'
      }, {
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=53'
        },
        uri: 'http://media.example.com/fileSequence53-B.ts'
      }]
    };
  };
  // we're inject the media playlist, so drop the request
  requests.shift();

  player.hls.playlists.trigger('loadedplaylist');
  // key response
  requests[0].response = new Uint32Array([0, 0, 0, 0]).buffer;
  requests.shift().respond(200, null, '');
  strictEqual(requests.length, 1, 'a key XHR is created');
  strictEqual(requests[0].url, player.hls.playlists.media().segments[1].key.uri, 'a key XHR is created with the correct uri');

  player.hls.playlists.media = oldMedia;
});

test('calling fetchKeys() when a seek happens will create an XHR', function() {
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  var oldMedia = player.hls.playlists.media;
  player.hls.playlists.media = function() {
    return {
      segments: [{
        duration: 10,
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=52'
        },
        uri: 'http://media.example.com/fileSequence52-A.ts'
      }, {
        duration: 10,
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=53'
        },
        uri: 'http://media.example.com/fileSequence53-B.ts'
      }]
    };
  };

  player.hls.fetchKeys(player.hls.playlists.media(), 0);
  player.currentTime(11);
  ok(requests[1].aborted, 'the key XHR should be aborted');
  equal(requests.length, 3, 'we should get a new key XHR');
  equal(requests[2].url, player.hls.playlists.media().segments[1].key.uri, 'urls should match');

  player.hls.playlists.media = oldMedia;
});

test('calling fetchKeys() when a key XHR is in progress will *not* create an XHR', function() {
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  var oldMedia = player.hls.playlists.media;
  player.hls.playlists.media = function() {
    return {
      segments: [{
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=52'
        },
        uri: 'http://media.example.com/fileSequence52-A.ts'
      }, {
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=53'
        },
        uri: 'http://media.example.com/fileSequence53-B.ts'
      }]
    };
  };

  strictEqual(requests.length, 1, 'no key XHR created for the player');
  player.hls.playlists.trigger('loadedplaylist');
  player.hls.fetchKeys(player.hls.playlists.media(), 0);
  strictEqual(requests.length, 2, 'only the original XHR is available');

  player.hls.playlists.media = oldMedia;
});

test('calling fetchKeys() when all keys are fetched, will *not* create an XHR', function() {
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  var oldMedia = player.hls.playlists.media;
  player.hls.playlists.media = function() {
    return {
      segments: [{
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=52',
          bytes: new Uint8Array([1])
        },
        uri: 'http://media.example.com/fileSequence52-A.ts'
      }, {
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=53',
          bytes: new Uint8Array([1])
        },
        uri: 'http://media.example.com/fileSequence53-B.ts'
      }]
    };
  };

  player.hls.fetchKeys(player.hls.playlists.media(), 0);
  strictEqual(requests.length, 1, 'no XHR for keys created since they were all downloaded');

  player.hls.playlists.media = oldMedia;
});

test('retries key requests once upon failure', function() {
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  var oldMedia = player.hls.playlists.media;
  player.hls.playlists.media = function() {
    return {
      segments: [{
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=52'
        },
        uri: 'http://media.example.com/fileSequence52-A.ts'
      }, {
        key: {
          'method': 'AES-128',
          'uri': 'https://priv.example.com/key.php?r=53'
        },
        uri: 'http://media.example.com/fileSequence53-B.ts'
      }]
    };
  };

  player.hls.fetchKeys(player.hls.playlists.media(), 0);

  requests[1].respond(404);
  equal(requests.length, 3, 'create a new XHR for the same key');
  equal(requests[2].url, requests[1].url, 'should be the same key');

  requests[2].respond(404);
  equal(requests.length, 4, 'create a new XHR for the same key');
  notEqual(requests[3].url, requests[2].url, 'should be the same key');
  equal(requests[3].url, player.hls.playlists.media().segments[1].key.uri);

  player.hls.playlists.media = oldMedia;
});

test('skip segments if key requests fail more than once', function() {
  var bytes = [],
      tags = [{ pats: 0, bytes: 0 }];

  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  window.videojs.SourceBuffer = function() {
    this.appendBuffer = function(chunk) {
      bytes.push(chunk);
    };
    this.abort = function() {};
  };

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence53-A.ts\n');

  player.hls.playlists.trigger('loadedplaylist');

  player.trigger('timeupdate');

  // respond to ts segment
  standardXHRResponse(requests.pop());
  // fail key
  requests.pop().respond(404);
  // fail key, again
  requests.pop().respond(404);

  // key for second segment
  requests[0].response = new Uint32Array([0,0,0,0]).buffer;
  requests[0].respond(200, null, '');
  requests.shift();

  equal(bytes.length, 1, 'bytes from the ts segments should not be added');

  player.trigger('timeupdate');

  tags.length = 0;
  tags.push({pts: 0, bytes: 1});

  // second segment
  standardXHRResponse(requests.pop());

  equal(bytes.length, 2, 'bytes from the second ts segment should be added');
  equal(bytes[1], 1, 'the bytes from the second segment are added and not the first');
});

test('the key is supplied to the decrypter in the correct format', function() {
  var keys = [];

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-MEDIA-SEQUENCE:5\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence52-B.ts\n');


  videojs.Hls.decrypt = function(bytes, key) {
    keys.push(key);
    return new Uint8Array([0]);
  };

  requests[0].response = new Uint32Array([0,1,2,3]).buffer;
  requests[0].respond(200, null, '');
  requests.shift();
  standardXHRResponse(requests.pop());

  equal(keys.length, 1, 'only one call to decrypt was made');
  deepEqual(keys[0],
            new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
            'passed the specified segment key');

});
test('supplies the media sequence of current segment as the IV by default, if no IV is specified', function() {
  var ivs = [];

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-MEDIA-SEQUENCE:5\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence52-B.ts\n');


  videojs.Hls.decrypt = function(bytes, key, iv) {
    ivs.push(iv);
    return new Uint8Array([0]);
  };

  requests[0].response = new Uint32Array([0,0,0,0]).buffer;
  requests[0].respond(200, null, '');
  requests.shift();
  standardXHRResponse(requests.pop());

  equal(ivs.length, 1, 'only one call to decrypt was made');
  deepEqual(ivs[0],
        new Uint32Array([0, 0, 0, 5]),
        'the IV for the segment is the media sequence');
});

test('switching playlists with an outstanding key request does not stall playback', function() {
  var media = '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:5\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
    '#EXTINF:2.833,\n' +
    'http://media.example.com/fileSequence52-A.ts\n' +
    '#EXTINF:15.0,\n' +
    'http://media.example.com/fileSequence52-B.ts\n';
  player.src({
    src: 'https://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  // master playlist
  standardXHRResponse(requests.shift());
  // media playlist
  requests.shift().respond(200, null, media);
  // mock out media switching from this point on
  player.hls.playlists.media = function() {
    return player.hls.playlists.master.playlists[0];
  };
  // don't respond to the initial key request
  requests.shift();
  // first segment of the original media playlist
  standardXHRResponse(requests.shift());

  // "switch" media
  player.hls.playlists.trigger('mediachange');

  player.trigger('timeupdate');

  ok(requests.length, 'made a request');
  equal(requests[0].url,
        'https://priv.example.com/key.php?r=52',
        'requested the segment and key');
});

test('resovles relative key URLs against the playlist', function() {
  player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:5\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="key.php?r=52"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence52-A.ts\n');
  equal(requests[0].url, 'https://example.com/key.php?r=52', 'resolves the key URL');
});

test('treats invalid keys as a key request failure', function() {
  var tags = [{ pts: 0, bytes: 0 }], bytes = [];
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  window.videojs.SourceBuffer = function() {
    this.appendBuffer = function(chunk) {
      bytes.push(chunk);
    };
    this.abort = function() {};
  };
  player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:5\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence52-A.ts\n' +
                           '#EXT-X-KEY:METHOD=NONE\n' +
                           '#EXTINF:15.0,\n' +
                           'http://media.example.com/fileSequence52-B.ts\n');
  // keys should be 16 bytes long
  requests[0].response = new Uint8Array(1).buffer;
  requests.shift().respond(200, null, '');
  // segment request
  standardXHRResponse(requests.shift());

  equal(requests[0].url, 'https://priv.example.com/key.php?r=52', 'retries the key');

  // the retried response is invalid, too
  requests[0].response = new Uint8Array(1);
  requests.shift().respond(200, null, '');

  // the first segment should be dropped and playback moves on
  player.trigger('timeupdate');
  equal(bytes.length, 1, 'did not append bytes');
  equal(bytes[0], 'flv', 'appended the flv header');

  tags.length = 0;
  tags.push({ pts: 1, bytes: 1 });
  // second segment request
  standardXHRResponse(requests.shift());

  equal(bytes.length, 2, 'appended bytes');
  equal(1, bytes[1], 'skipped to the second segment');
});

})(window, window.videojs);

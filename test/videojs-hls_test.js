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
  oldClearTimeout,
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
    tech.vjs_getProperty = function(name) {
      if (name === 'paused') {
        return this.paused_;
      }
    };
    tech.vjs_setProperty = function() {};
    tech.vjs_src = function() {};
    tech.vjs_play = function() {
      this.paused_ = false;
    };
    tech.vjs_pause = function() {
      this.paused_ = true;
    };
    tech.vjs_discontinuity = function() {};
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

    request.response = new Uint8Array(16).buffer;
    request.respond(200,
                    { 'Content-Type': contentType },
                    window.manifests[manifestName]);
  },

  mockSegmentParser = function(tags) {
    var MockSegmentParser;

    if (tags === undefined) {
      tags = [{ pts: 0, bytes: new Uint8Array(1) }];
    }
    MockSegmentParser = function() {
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
      this.metadataStream = new videojs.Hls.Stream();
      this.metadataStream.init();
      this.metadataStream.descriptor = new Uint8Array([
        1, 2, 3, 0xbb
      ]);

      this.stats = {
        h264Tags: function() {
          return tags.length;
        },
        minVideoPts: function() {
          return tags[0].pts;
        },
        maxVideoPts: function() {
          return tags[tags.length - 1].pts;
        },
        aacTags: function() {
          return tags.length;
        },
        minAudioPts: function() {
          return tags[0].pts;
        },
        maxAudioPts: function() {
          return tags[tags.length - 1].pts;
        },
      };
    };

    MockSegmentParser.STREAM_TYPES = videojs.Hls.SegmentParser.STREAM_TYPES;

    return MockSegmentParser;
  },

  // return an absolute version of a page-relative URL
  absoluteUrl = function(relativeUrl) {
    return window.location.origin +
      (window.location.pathname
         .split('/')
         .slice(0, -1)
         .concat(relativeUrl)
         .join('/'));
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
    oldClearTimeout = window.clearTimeout;

    oldNativeHlsSupport = videojs.Hls.supportsNativeHls;

    oldDecrypt = videojs.Hls.Decrypter;
    videojs.Hls.Decrypter = function() {};

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
    videojs.Flash.isSupported = oldFlashSupported;
    videojs.MediaSource.open = oldMediaSourceOpen;
    videojs.Hls.SegmentParser = oldSegmentParser;
    videojs.Hls.supportsNativeHls = oldNativeHlsSupport;
    videojs.Hls.Decrypter = oldDecrypt;
    videojs.SourceBuffer = oldSourceBuffer;
    window.setTimeout = oldSetTimeout;
    window.clearTimeout = oldClearTimeout;
    player.dispose();
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

test('autoplay seeks to the live point after playlist load', function() {
  var currentTime = 0;
  player.options().autoplay = true;
  player.hls.setCurrentTime = function(time) {
    currentTime = time;
    return currentTime;
  };
  player.hls.currentTime = function() {
    return currentTime;
  };
  player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift());

  notEqual(currentTime, 0, 'seeked on autoplay');
});

test('autoplay seeks to the live point after media source open', function() {
  var currentTime = 0;
  player.options().autoplay = true;
  player.hls.setCurrentTime = function(time) {
    currentTime = time;
    return currentTime;
  };
  player.hls.currentTime = function() {
    return currentTime;
  };
  player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  standardXHRResponse(requests.shift());
  openMediaSource(player);

  notEqual(currentTime, 0, 'seeked on autoplay');
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

test('re-initializes the playlist loader when switching sources', function() {
  // source is set
  player.src({
    src:'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  // loader gets media playlist
  standardXHRResponse(requests.shift());
  // request a segment
  standardXHRResponse(requests.shift());
  // change the source
  player.src({
    src:'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  ok(!player.hls.playlists.media(), 'no media playlist');
  equal(player.hls.playlists.state,
        'HAVE_NOTHING',
        'reset the playlist loader state');
  equal(requests.length, 1, 'requested the new src');

  // buffer check
  player.hls.checkBuffer_();
  equal(requests.length, 1, 'did not request a stale segment');

  // sourceopen
  openMediaSource(player);

  equal(requests.length, 1, 'made one request');
  ok(requests[0].url.indexOf('master.m3u8') >= 0, 'requested only the new playlist');
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

test('translates seekable by the starting time for live playlists', function() {
  var seekable, seekableEnd;
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:15\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXTINF:10,\n' +
                           '1.ts\n' +
                           '#EXTINF:10,\n' +
                           '2.ts\n' +
                           '#EXTINF:10,\n' +
                           '3.ts\n');

  seekable = player.seekable();

  if (videojs.Hls.LIVE_SYNC_DURATION_COUNT <= 3) {
    seekableEnd = 40 - (10 * videojs.Hls.LIVE_SYNC_DURATION_COUNT);
  } else {
    //if we make this const bigger than 3, we need to update the manifest in this test to remain useful,
    //so fail to remind someone to do that.
    seekableEnd = -1;
  }

  equal(seekable.length, 1, 'one seekable range');
  equal(seekable.start(0), 0, 'the earliest possible position is at zero');
  equal(seekable.end(0), seekableEnd, 'end is relative to the start');
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
              absoluteUrl('manifest/media-00001.ts'),
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

  // set bandwidth to an appropriate number so we don't switch
  player.hls.bandwidth = 200000;
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media.m3u8'),
              'media playlist requested');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media-00001.ts'),
              'first segment requested');
});

test('upshift if initial bandwidth is high', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.hls.playlists.setBandwidth = function() {
    player.hls.playlists.bandwidth = 1000000000;
  };

  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  standardXHRResponse(requests[3]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media.m3u8'),
              'media playlist requested');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media3.m3u8'),
              'media playlist requested');
  strictEqual(requests[3].url,
              absoluteUrl('manifest/media3-00001.ts'),
              'first segment requested');
});

test('dont downshift if bandwidth is low', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.hls.playlists.setBandwidth = function() {
    player.hls.playlists.bandwidth = 100;
  };

  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media.m3u8'),
              'media playlist requested');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media-00001.ts'),
              'first segment requested');
});

test('starts checking the buffer on init', function() {
  var player, i, calls, callbacks = [], fills = 0, drains = 0;
  // capture timeouts
  window.setTimeout = function(callback) {
    callbacks.push(callback);
    return callbacks.length - 1;
  };
  window.clearTimeout = function(index) {
    callbacks[index] = Function.prototype;
  };

  player = createPlayer();
  player.hls.fillBuffer = function() {
    fills++;
  };
  player.hls.drainBuffer = function() {
    drains++;
  };
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  ok(callbacks.length > 0, 'set timeouts');

  // run the initial set of callbacks. this should cause
  // fill/drainBuffer to be run
  calls = callbacks.slice();
  for (i = 0; i < calls.length; i++) {
    calls[i]();
  }
  equal(fills, 1, 'called fillBuffer');
  equal(drains, 1, 'called drainBuffer');

  player.dispose();
  // the remaining callbacks do not run any buffer checks
  calls = callbacks.slice();
  for (i = 0; i < calls.length; i++) {
    calls[i]();
  }
  equal(fills, 1, 'did not call fillBuffer again');
  equal(drains, 1, 'did not call drainBuffer again');
});

test('buffer checks are noops until a media playlist is ready', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.hls.checkBuffer_();

  strictEqual(1, requests.length, 'one request was made');
  strictEqual(requests[0].url, 'manifest/media.m3u8', 'media playlist requested');
});

test('buffer checks are noops when only the master is ready', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift());
  standardXHRResponse(requests.shift());
  // ignore any outstanding segment requests
  requests.length = 0;

  // load in a new playlist which will cause playlists.media() to be
  // undefined while it is being fetched
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  // respond with the master playlist but don't send the media playlist yet
  standardXHRResponse(requests.shift());
  // trigger fillBuffer()
  player.hls.checkBuffer_();

  strictEqual(1, requests.length, 'one request was made');
  strictEqual(requests[0].url,
              absoluteUrl('manifest/media.m3u8'),
              'media playlist requested');
});

test('calculates the bandwidth after downloading a segment', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  // set the request time to be a bit earlier so our bandwidth calculations are not NaN
  requests[1].requestTime = (new Date())-100;

  standardXHRResponse(requests[1]);

  ok(player.hls.bandwidth, 'bandwidth is calculated');
  ok(player.hls.bandwidth > 0,
     'bandwidth is positive: ' + player.hls.bandwidth);
  ok(player.hls.segmentXhrTime >= 0,
     'saves segment request time: ' + player.hls.segmentXhrTime + 's');
});

test('fires a progress event after downloading a segment', function() {
  var progressCount = 0;

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift());
  player.on('progress', function() {
    progressCount++;
  });
  standardXHRResponse(requests.shift());

  equal(progressCount, 1, 'fired a progress event');
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

  player.hls.bandwidth = 3000000;
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(calls, 2, 'selects after the initial segment');
  player.currentTime = function() {
    return 1;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 2);
  };
  player.hls.checkBuffer_();

  standardXHRResponse(requests[3]);

  strictEqual(calls, 3, 'selects after additional segments');
});

test('moves to the next segment if there is a network error', function() {
  var mediaIndex;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.hls.bandwidth = 20000;
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

  player.hls.bandwidth = 20000;
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

  requests[2].bandwidth = 3000000;
  requests[2].response = new Uint8Array([0]);
  requests[2].respond(200, null, '');
  standardXHRResponse(requests[3]);

  strictEqual(4, requests.length, 'requests were made');
  strictEqual(requests[3].url,
              absoluteUrl('manifest/' + playlist.uri),
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

test('scales the bandwidth estimate for the first segment', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests[0].bandwidth = 500;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                           '#EXT-X-TARGETDURATION:10\n');
  equal(player.hls.bandwidth, 500 * 5, 'scaled the bandwidth estimate by 5');
});

test('allows initial bandwidth to be provided', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.hls.bandwidth = 500;
  openMediaSource(player);

  requests[0].bandwidth = 1;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                           '#EXT-X-TARGETDURATION:10\n');
  equal(player.hls.bandwidth, 500, 'prefers user-specified intial bandwidth');
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

  deepEqual(playlist.attributes.RESOLUTION, {width:960,height:540},'should return the correct resolution by player dimensions');
  equal(playlist.attributes.BANDWIDTH, 1928000, 'should have the expected bandwidth in case of multiple');

  player.width(1920);
  player.height(1080);
  player.hls.bandwidth = 3000000;

  playlist = player.hls.selectPlaylist();

  deepEqual(playlist.attributes.RESOLUTION, {width:960,height:540},'should return the correct resolution by player dimensions');
  equal(playlist.attributes.BANDWIDTH, 1928000, 'should have the expected bandwidth in case of multiple');

  player.width(396);
  player.height(224);
  playlist = player.hls.selectPlaylist();

  deepEqual(playlist.attributes.RESOLUTION, {width:396,height:224},'should return the correct resolution by player dimensions, if exact match');
  equal(playlist.attributes.BANDWIDTH, 440000, 'should have the expected bandwidth in case of multiple, if exact match');

});

test('selects the highest bitrate playlist when the player dimensions are ' +
     'larger than any of the variants', function() {
  var playlist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=2x1\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x1\n' +
                           'media1.m3u8\n'); // master
  standardXHRResponse(requests.shift()); // media
  player.hls.bandwidth = 1e10;

  player.width(1024);
  player.height(768);

  playlist = player.hls.selectPlaylist();

  equal(playlist.attributes.BANDWIDTH,
        1000,
        'selected the highest bandwidth variant');
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
  player.hls.checkBuffer_();

  standardXHRResponse(requests[2]);

  strictEqual(requests.length, 3, 'made a request');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media-00002.ts'),
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

test('only appends one segment at a time', function() {
  var appends = 0, tags = [{ pts: 0, bytes: new Uint8Array(1) }];
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop()); // media.m3u8
  standardXHRResponse(requests.pop()); // segment 0

  player.hls.sourceBuffer.updating = true;
  player.hls.sourceBuffer.appendBuffer = function() {
    appends++;
  };
  tags.push({ pts: 0, bytes: new Uint8Array(1) });

  player.hls.checkBuffer_();
  standardXHRResponse(requests.pop()); // segment 1
  player.hls.checkBuffer_(); // should be a no-op
  equal(appends, 0, 'did not append while updating');
});

test('records the min and max PTS values for a segment', function() {
  var tags = [];
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop()); // media.m3u8

  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  tags.push({ pts: 10, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.pop()); // segment 0

  equal(player.hls.playlists.media().segments[0].minVideoPts, 0, 'recorded min video pts');
  equal(player.hls.playlists.media().segments[0].maxVideoPts, 10, 'recorded max video pts');
  equal(player.hls.playlists.media().segments[0].minAudioPts, 0, 'recorded min audio pts');
  equal(player.hls.playlists.media().segments[0].maxAudioPts, 10, 'recorded max audio pts');
});

test('records PTS values for video-only segments', function() {
  var tags = [];
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop()); // media.m3u8

  player.hls.segmentParser_.stats.aacTags = function() {
    return 0;
  };
  player.hls.segmentParser_.stats.minAudioPts = function() {
    throw new Error('No audio tags');
  };
  player.hls.segmentParser_.stats.maxAudioPts = function() {
    throw new Error('No audio tags');
  };
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  tags.push({ pts: 10, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.pop()); // segment 0

  equal(player.hls.playlists.media().segments[0].minVideoPts, 0, 'recorded min video pts');
  equal(player.hls.playlists.media().segments[0].maxVideoPts, 10, 'recorded max video pts');
  strictEqual(player.hls.playlists.media().segments[0].minAudioPts, undefined, 'min audio pts is undefined');
  strictEqual(player.hls.playlists.media().segments[0].maxAudioPts, undefined, 'max audio pts is undefined');
});

test('records PTS values for audio-only segments', function() {
  var tags = [];
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop()); // media.m3u8

  player.hls.segmentParser_.stats.h264Tags = function() {
    return 0;
  };
  player.hls.segmentParser_.stats.minVideoPts = function() {
    throw new Error('No video tags');
  };
  player.hls.segmentParser_.stats.maxVideoPts = function() {
    throw new Error('No video tags');
  };
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  tags.push({ pts: 10, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.pop()); // segment 0

  equal(player.hls.playlists.media().segments[0].minAudioPts, 0, 'recorded min audio pts');
  equal(player.hls.playlists.media().segments[0].maxAudioPts, 10, 'recorded max audio pts');
  strictEqual(player.hls.playlists.media().segments[0].minVideoPts, undefined, 'min video pts is undefined');
  strictEqual(player.hls.playlists.media().segments[0].maxVideoPts, undefined, 'max video pts is undefined');
});

test('waits to download new segments until the media playlist is stable', function() {
  var media;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift()); // master
  player.hls.bandwidth = 1; // make sure we stay on the lowest variant
  standardXHRResponse(requests.shift()); // media

  // mock a playlist switch
  media = player.hls.playlists.media();
  player.hls.playlists.media = function() {
    return media;
  };
  player.hls.playlists.state = 'SWITCHING_MEDIA';

  standardXHRResponse(requests.shift()); // segment 0

  equal(requests.length, 0, 'no requests outstanding');
  player.hls.checkBuffer_();
  equal(requests.length, 0, 'delays segment fetching');

  player.hls.playlists.state = 'LOADED_METADATA';
  player.hls.checkBuffer_();
  equal(requests.length, 1, 'resumes segment fetching');
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
    this.metadataStream = {
      on: Function.prototype
    };
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

test('exposes in-band metadata events as cues', function() {
  var track;
  videojs.Hls.SegmentParser = mockSegmentParser();
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 2000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }, {
        id: 'WXXX',
        url: 'http://example.com'
      }, {
        id: 'PRIV',
        owner: 'owner@example.com',
        privateData: new Uint8Array([1, 2, 3])
      }]
    });
  };

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  equal(player.textTracks().length, 1, 'created a text track');
  track = player.textTracks()[0];
  equal(track.kind, 'metadata', 'kind is metadata');
  equal(track.inBandMetadataTrackDispatchType, '15010203BB', 'set the dispatch type');
  equal(track.cues.length, 3, 'created three cues');
  equal(track.cues[0].startTime, 2, 'cue starts at 2 seconds');
  equal(track.cues[0].endTime, 2, 'cue ends at 2 seconds');
  equal(track.cues[0].pauseOnExit, false, 'cue does not pause on exit');
  equal(track.cues[0].text, 'cue text', 'set cue text');

  equal(track.cues[1].startTime, 2, 'cue starts at 2 seconds');
  equal(track.cues[1].endTime, 2, 'cue ends at 2 seconds');
  equal(track.cues[1].pauseOnExit, false, 'cue does not pause on exit');
  equal(track.cues[1].text, 'http://example.com', 'set cue text');

  equal(track.cues[2].startTime, 2, 'cue starts at 2 seconds');
  equal(track.cues[2].endTime, 2, 'cue ends at 2 seconds');
  equal(track.cues[2].pauseOnExit, false, 'cue does not pause on exit');
  equal(track.cues[2].text, '', 'did not set cue text');
  equal(track.cues[2].frame.owner, 'owner@example.com', 'set the owner');
  deepEqual(track.cues[2].frame.privateData,
            new Uint8Array([1, 2, 3]),
            'set the private data');
});

test('only adds in-band cues the first time they are encountered', function() {
  var tags = [{ pts: 0, bytes: new Uint8Array(1) }], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 2000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }]
    });
  };
  standardXHRResponse(requests.shift());
  standardXHRResponse(requests.shift());
  // seek back to the first segment
  player.currentTime(0);
  player.hls.trigger('seeking');
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.shift());

  track = player.textTracks()[0];
  equal(track.cues.length, 1, 'only added the cue once');
});

test('clears in-band cues ahead of current time on seek', function() {
  var
    tags = [],
    events = [],
    track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    while (events.length) {
      player.hls.segmentParser_.metadataStream.trigger('data', events.shift());
    }
  };
  standardXHRResponse(requests.shift()); // media
  tags.push({ pts: 0, bytes: new Uint8Array(1) },
            { pts: 10 * 1000, bytes: new Uint8Array(1) });
  events.push({
      pts: 9.9 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 1'
      }]
  });
  events.push({
      pts: 20 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 3'
      }]
  });
  standardXHRResponse(requests.shift()); // segment 0
  tags.push({ pts: 10 * 1000 + 1, bytes: new Uint8Array(1) },
            { pts: 20 * 1000, bytes: new Uint8Array(1) });
  events.push({
      pts: 19.9 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 2'
      }]
  });
  player.hls.checkBuffer_();
  standardXHRResponse(requests.shift()); // segment 1

  track = player.textTracks()[0];
  equal(track.cues.length, 3, 'added the cues');

  // seek into segment 1
  player.currentTime(11);
  player.trigger('seeking');
  equal(track.cues.length, 1, 'removed later cues');
  equal(track.cues[0].startTime, 9.9, 'retained the earlier cue');
});

test('translates ID3 PTS values to cue media timeline positions', function() {
  var tags = [{ pts: 4 * 1000, bytes: new Uint8Array(1) }], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 5 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }]
    });
  };
  standardXHRResponse(requests.shift()); // media
  standardXHRResponse(requests.shift()); // segment 0

  track = player.textTracks()[0];
  equal(track.cues[0].startTime, 1, 'translated startTime');
  equal(track.cues[0].endTime, 1, 'translated startTime');
});

test('translates ID3 PTS values with expired segments', function() {
  var tags = [{ pts: 4 * 1000, bytes: new Uint8Array(1) }], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.play();

  // 20.9 seconds of content have expired
  player.hls.playlists.expiredPostDiscontinuity_ = 20.9;

  player.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 5 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }]
    });
  };
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:2\n' +
                           '#EXTINF:10,\n' +
                           '2.ts\n' +
                           '#EXTINF:10,\n' +
                           '3.ts\n');    // media
  standardXHRResponse(requests.shift()); // segment 0

  track = player.textTracks()[0];
  equal(track.cues[0].startTime, 20.9 + 1, 'translated startTime');
  equal(track.cues[0].endTime, 20.9 + 1, 'translated startTime');
});

test('translates id3 PTS values for audio-only media', function() {
  var tags = [{ pts: 4 * 1000, bytes: new Uint8Array(1) }], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 5 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }]
    });
  };
  player.hls.segmentParser_.stats.h264Tags = function() { return 0; };
  player.hls.segmentParser_.stats.minVideoPts = null;
  standardXHRResponse(requests.shift()); // media
  standardXHRResponse(requests.shift()); // segment 0

  track = player.textTracks()[0];
  equal(track.cues[0].startTime, 1, 'translated startTime');
});

test('translates ID3 PTS values across discontinuities', function() {
  var tags = [], events = [], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'cues-and-discontinuities.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    if (events.length) {
      player.hls.segmentParser_.metadataStream.trigger('data', events.shift());
    }
  };

  // media playlist
  player.trigger('play');
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXT-X-DISCONTINUITY\n' +
                           '#EXTINF:10,\n' +
                           '1.ts\n');

  // segment 0 starts at PTS 14000 and has a cue point at 15000
  tags.push({ pts: 14 * 1000, bytes: new Uint8Array(1) },
            { pts: 24 * 1000, bytes: new Uint8Array(1) });
  events.push({
      pts:  15 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 0'
      }]
  });
  standardXHRResponse(requests.shift()); // segment 0

  // segment 1 is after a discontinuity, starts at PTS 22000
  // and has a cue point at 23000
  tags.push({ pts: 22 * 1000, bytes: new Uint8Array(1) });
  events.push({
      pts:  23 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 1'
      }]
  });
  player.hls.checkBuffer_();
  standardXHRResponse(requests.shift());

  track = player.textTracks()[0];
  equal(track.cues.length, 2, 'created cues');
  equal(track.cues[0].startTime, 1, 'first cue started at the correct time');
  equal(track.cues[0].endTime, 1, 'first cue ended at the correct time');
  equal(track.cues[1].startTime, 11, 'second cue started at the correct time');
  equal(track.cues[1].endTime, 11, 'second cue ended at the correct time');
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
  tags.push({ pts: 0, bytes: new Uint8Array(1) });

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
      bytes: new Uint8Array([i])
    });
  }
  player.currentTime(7);
  standardXHRResponse(requests[2]);

  deepEqual(bytes, [new Uint8Array([7,8,9])], 'three tags are appended');
});

test('calls abort() on the SourceBuffer before seeking', function() {
  var
    aborts = 0,
    bytes = [],
    tags = [{ pts: 0, bytes: new Uint8Array(1) }];


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
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  tags.push({ pts: 7000, bytes: new Uint8Array([7]) });
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

test('seeking in an empty playlist is a non-erroring noop', function() {
  player.src({
    src: 'manifest/empty-live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.shift().respond(200, null, '#EXTM3U\n');

  player.currentTime(183);
  equal(player.currentTime(), 0, 'remains at time zero');
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
  player.trigger('play');

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
      mediaSequence: 1,
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

test('does not reset live currentTime if mediaIndex is one beyond the last available segment', function() {
  var playlist = {
    mediaSequence: 20,
    targetDuration: 9,
    segments: [{
      duration: 3
    }, {
      duration: 3
    }, {
      duration: 3
    }]
  };

  equal(playlist.segments.length,
        videojs.Hls.translateMediaIndex(playlist.segments.length, playlist, playlist),
        'did not change mediaIndex');
});

test('live playlist starts with correct currentTime value', function() {
  player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.hls.playlists.trigger('loadedmetadata');

  player.hls.play();

  strictEqual(player.currentTime(),
              videojs.Hls.Playlist.seekable(player.hls.playlists.media()).end(0),
              'currentTime is updated at playback');
});

test('resets the time to a seekable position when resuming a live stream ' +
     'after a long break', function() {
  var seekTarget;
  player.src({
    src: 'live0.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:16\n' +
                           '#EXTINF:10,\n' +
                           '16.ts\n');
  // mock out the player to simulate a live stream that has been
  // playing for awhile
  player.hls.hasPlayed_ = true;
  player.hls.seekable = function() {
    return {
      start: function() {
        return 160;
      },
      end: function() {
        return 170;
      },
      length: 1
    };
  };
  player.hls.currentTime = function() {
    return 0;
  };
  player.hls.setCurrentTime = function(time) {
    if (time !== undefined) {
      seekTarget = time;
    }
  };

  player.play();
  equal(seekTarget, player.seekable().start(0), 'seeked to the start of seekable');
});

test('clamps seeks to the seekable window', function() {
  var seekTarget;
  player.src({
    src: 'live0.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:16\n' +
                           '#EXTINF:10,\n' +
                           '16.ts\n');
  // mock out a seekable window
  player.hls.seekable = function() {
    return {
      start: function() {
        return 160;
      },
      end: function() {
        return 170;
      }
    };
  };
  player.hls.fillBuffer = function(time) {
    if (time !== undefined) {
      seekTarget = time;
    }
  };

  player.currentTime(180);
  equal(seekTarget * 0.001, player.seekable().end(0), 'forward seeks are clamped');

  player.currentTime(45);
  equal(seekTarget * 0.001, player.seekable().start(0), 'backward seeks are clamped');
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

test('mediaIndex returns correctly at playlist boundaries', function() {
  player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(player);
  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media

  strictEqual(player.hls.mediaIndex, 0, 'mediaIndex is zero at first segment');

  // seek to end
  player.currentTime(40);

  strictEqual(player.hls.mediaIndex, 3, 'mediaIndex is 3 at last segment');
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

test('calls vjs_discontinuity() before appending bytes at a discontinuity', function() {
  var discontinuities = 0, tags = [], currentTime, bufferEnd;

  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.trigger('play');
  player.currentTime = function() { return currentTime; };
  player.buffered = function() {
    return videojs.createTimeRange(0, bufferEnd);
  };
  player.el().querySelector('.vjs-tech').vjs_discontinuity = function() {
    discontinuities++;
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
  player.hls.checkBuffer_();
  strictEqual(discontinuities, 0, 'no discontinuities before the segment is received');

  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.pop());
  strictEqual(discontinuities, 1, 'signals a discontinuity');
});

test('clears the segment buffer on seek', function() {
  var aborts = 0, tags = [], currentTime, bufferEnd, oldCurrentTime;

  videojs.Hls.SegmentParser = mockSegmentParser(tags);

  player.src({
    src: 'discontinuity.m3u8',
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
                         '2.ts\n' +
                         '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.pop());

  // play to 6s to trigger the next segment request
  currentTime = 6;
  bufferEnd = 10;
  player.hls.checkBuffer_();

  standardXHRResponse(requests.pop());

  // seek back to the beginning
  player.currentTime(0);
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.pop());
  strictEqual(aborts, 1, 'aborted once for the seek');

  // the source buffer empties. is 2.ts still in the segment buffer?
  player.trigger('waiting');
  strictEqual(aborts, 1, 'cleared the segment buffer on a seek');
});

test('can seek before the source buffer opens', function() {
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  standardXHRResponse(requests.shift());
  player.triggerReady();

  player.currentTime(1);
  equal(player.currentTime(), 1, 'seeked');
});

test('continues playing after seek to discontinuity', function() {
  var aborts = 0, tags = [], currentTime, bufferEnd, oldCurrentTime;

  videojs.Hls.SegmentParser = mockSegmentParser(tags);

  player.src({
    src: 'discontinuity.m3u8',
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
    '2.ts\n' +
    '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.pop()); // 1.ts

  currentTime = 1;
  bufferEnd = 10;
  player.hls.checkBuffer_();

  standardXHRResponse(requests.pop()); // 2.ts

  // seek to the discontinuity
  player.currentTime(10);
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  tags.push({ pts: 11 * 1000, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.pop()); // 1.ts, again
  strictEqual(aborts, 1, 'aborted once for the seek');

  // the source buffer empties. is 2.ts still in the segment buffer?
  player.trigger('waiting');
  strictEqual(aborts, 1, 'cleared the segment buffer on a seek');
});

test('seeking does not fail when targeted between segments', function() {
  var tags = [], currentTime, segmentUrl;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  // mock out the currentTime callbacks
  player.hls.el().vjs_setProperty = function(property, value) {
    if (property === 'currentTime') {
      currentTime = value;
    }
  };
  player.hls.el().vjs_getProperty = function(property) {
    if (property === 'currentTime') {
      return currentTime;
    }
  };

  standardXHRResponse(requests.shift()); // media
  tags.push({ pts: 100, bytes: new Uint8Array(1) },
            { pts: 9 * 1000 + 100, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.shift()); // segment 0
  player.hls.checkBuffer_();
  tags.push({ pts: 9.5 * 1000 + 100, bytes: new Uint8Array(1) },
            { pts: 20 * 1000 + 100, bytes: new Uint8Array(1) });
  segmentUrl = requests[0].url;
  standardXHRResponse(requests.shift()); // segment 1

  // seek to a time that is greater than the last tag in segment 0 but
  // less than the first in segment 1
  player.currentTime(9.4);
  equal(requests[0].url, segmentUrl, 'requested the later segment');

  tags.push({ pts: 9.5 * 1000 + 100, bytes: new Uint8Array(1) },
            { pts: 20 * 1000 + 100, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.shift()); // segment 1
  equal(player.currentTime(), 9.5, 'seeked to the later time');
});

test('resets the switching algorithm if a request times out', function() {
  player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.hls.bandwidth = 20000;

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
    offhandlers++;
    oldOff.call(player, type, handler);
  };
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  player.dispose();

  ok(offhandlers > onhandlers, 'removed all registered handlers');
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

  player.hls.checkBuffer_();

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

test('drainBuffer will not proceed with empty source buffer', function() {
  var oldMedia, newMedia, compareBuffer;
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  oldMedia = player.hls.playlists.media;
  newMedia = {segments: [{
    key: {
      'retries': 5
    },
    uri: 'http://media.example.com/fileSequence52-A.ts'
  }, {
    key: {
      'method': 'AES-128',
      'uri': 'https://priv.example.com/key.php?r=53'
    },
    uri: 'http://media.example.com/fileSequence53-B.ts'
  }]};
  player.hls.playlists.media = function() {
    return newMedia;
  };

  player.hls.sourceBuffer = undefined;
  compareBuffer = [{mediaIndex: 0, playlist: newMedia, offset: 0, bytes: new Uint8Array(3)}];
  player.hls.segmentBuffer_ = [{mediaIndex: 0, playlist: newMedia, offset: 0, bytes: new Uint8Array(3)}];

  player.hls.drainBuffer();

  /* Normally, drainBuffer() calls segmentBuffer.shift(), removing a segment from the stack.
   * Comparing two buffers to ensure no segment was popped verifies that we returned early
   * from drainBuffer() because sourceBuffer was empty.
   */
  deepEqual(player.hls.segmentBuffer_, compareBuffer, 'playlist remains unchanged');

  player.hls.playlists.media = oldMedia;
});

test('keys are requested when an encrypted segment is loaded', function() {
  player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.trigger('play');
  standardXHRResponse(requests.shift()); // playlist
  standardXHRResponse(requests.shift()); // first segment

  strictEqual(requests.length, 1, 'a key XHR is created');
  strictEqual(requests[0].url,
              player.hls.playlists.media().segments[0].key.uri,
              'a key XHR is created with correct uri');
});

test('keys are resolved relative to the master playlist', function() {
  player.src({
    src: 'video/master-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
                           'playlist/playlist.m3u8\n' +
                           '#EXT-X-ENDLIST\n');
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-TARGETDURATION:15\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence1.ts\n' +
                           '#EXT-X-ENDLIST\n');

  standardXHRResponse(requests.shift());
  equal(requests.length, 1, 'requested the key');
  ok((/video\/playlist\/keys\/key\.php$/).test(requests[0].url),
     'resolves multiple relative paths');
});

test('keys are resolved relative to their containing playlist', function() {
  player.src({
    src: 'video/media-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-TARGETDURATION:15\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence1.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.shift());
  equal(requests.length, 1, 'requested a key');
  ok((/video\/keys\/key\.php$/).test(requests[0].url),
     'resolves multiple relative paths');
});

test('a new key XHR is created when a the segment is received', function() {
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-TARGETDURATION:15\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence1.ts\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key2.php"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence2.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.shift()); // segment 1
  standardXHRResponse(requests.shift()); // key 1
  // "finish" decrypting segment 1
  player.hls.segmentBuffer_[0].bytes = new Uint8Array(16);
  player.hls.checkBuffer_();

  standardXHRResponse(requests.shift()); // segment 2

  strictEqual(requests.length, 1, 'a key XHR is created');
  strictEqual(requests[0].url,
              'https://example.com/' +
              player.hls.playlists.media().segments[1].key.uri,
              'a key XHR is created with the correct uri');
});

test('seeking should abort an outstanding key request and create a new one', function() {
  player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-TARGETDURATION:15\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                           '#EXTINF:9,\n' +
                           'http://media.example.com/fileSequence1.ts\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key2.php"\n' +
                           '#EXTINF:9,\n' +
                           'http://media.example.com/fileSequence2.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.shift()); // segment 1

  player.currentTime(11);
  ok(requests[0].aborted, 'the key XHR should be aborted');
  requests.shift(); // aborted key 1

  equal(requests.length, 1, 'requested the new segment');
  standardXHRResponse(requests.shift()); // segment 2
  equal(requests.length, 1, 'requested the new key');
  equal(requests[0].url,
        'https://example.com/' +
        player.hls.playlists.media().segments[1].key.uri,
        'urls should match');
});

test('retries key requests once upon failure', function() {
  player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.trigger('play');

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence52-A.ts\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
                           '#EXTINF:15.0,\n' +
                           'http://media.example.com/fileSequence53-A.ts\n');
  standardXHRResponse(requests.shift()); // segment
  requests[0].respond(404);
  equal(requests.length, 2, 'create a new XHR for the same key');
  equal(requests[1].url, requests[0].url, 'should be the same key');

  requests[1].respond(404);
  equal(requests.length, 2, 'gives up after one retry');
});

test('skip segments if key requests fail more than once', function() {
  var bytes = [],
      tags = [{ pts: 0, bytes: new Uint8Array(1) }];

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
  player.trigger('play');

  requests.shift().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence53-A.ts\n');
  standardXHRResponse(requests.shift()); // segment 1
  requests.shift().respond(404); // fail key
  requests.shift().respond(404); // fail key, again

  tags.length = 0;
  tags.push({pts: 0, bytes: new Uint8Array([1]) });
  player.hls.checkBuffer_();
  standardXHRResponse(requests.shift()); // segment 2
  equal(bytes.length, 1, 'bytes from the ts segments should not be added');

  // key for second segment
  requests[0].response = new Uint32Array([0,0,0,0]).buffer;
  requests.shift().respond(200, null, '');
  // "finish" decryption
  player.hls.segmentBuffer_[0].bytes = new Uint8Array(16);
  player.hls.checkBuffer_();

  equal(bytes.length, 2, 'bytes from the second ts segment should be added');
  deepEqual(bytes[1], new Uint8Array([1]), 'the bytes from the second segment are added and not the first');
});

test('the key is supplied to the decrypter in the correct format', function() {
  var keys = [];

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.trigger('play');

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-MEDIA-SEQUENCE:5\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence52-B.ts\n');


  videojs.Hls.Decrypter = function(encrypted, key) {
    keys.push(key);
  };

  standardXHRResponse(requests.shift()); // segment
  requests[0].response = new Uint32Array([0,1,2,3]).buffer;
  requests[0].respond(200, null, '');
  requests.shift(); // key

  equal(keys.length, 1, 'only one Decrypter was constructed');
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
  player.trigger('play');

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-MEDIA-SEQUENCE:5\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence52-B.ts\n');


  videojs.Hls.Decrypter = function(encrypted, key, iv) {
    ivs.push(iv);
  };

  requests[0].response = new Uint32Array([0,0,0,0]).buffer;
  requests[0].respond(200, null, '');
  requests.shift();
  standardXHRResponse(requests.pop());

  equal(ivs.length, 1, 'only one Decrypter was constructed');
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
  player.trigger('play');

  // master playlist
  standardXHRResponse(requests.shift());
  // media playlist
  requests.shift().respond(200, null, media);
  // mock out media switching from this point on
  player.hls.playlists.media = function() {
    return player.hls.playlists.master.playlists[0];
  };
  // first segment of the original media playlist
  standardXHRResponse(requests.shift());
  // don't respond to the initial key request
  requests.shift();

  // "switch" media
  player.hls.playlists.trigger('mediachange');

  player.hls.checkBuffer_();

  ok(requests.length, 'made a request');
  equal(requests[0].url,
        'http://media.example.com/fileSequence52-B.ts',
        'requested the segment');
  equal(requests[1].url,
        'https://priv.example.com/key.php?r=52',
        'requested the key');
});

test('resolves relative key URLs against the playlist', function() {
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
                           'http://media.example.com/fileSequence52-A.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.shift()); // segment

  equal(requests[0].url, 'https://example.com/key.php?r=52', 'resolves the key URL');
});

test('treats invalid keys as a key request failure', function() {
  var tags = [{ pts: 0, bytes: new Uint8Array(1) }], bytes = [];
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
  player.trigger('play');
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:5\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence52-A.ts\n' +
                           '#EXT-X-KEY:METHOD=NONE\n' +
                           '#EXTINF:15.0,\n' +
                           'http://media.example.com/fileSequence52-B.ts\n');
  // segment request
  standardXHRResponse(requests.shift());
  // keys should be 16 bytes long
  requests[0].response = new Uint8Array(1).buffer;
  requests.shift().respond(200, null, '');

  equal(requests[0].url, 'https://priv.example.com/key.php?r=52', 'retries the key');

  // the retried response is invalid, too
  requests[0].response = new Uint8Array(1);
  requests.shift().respond(200, null, '');

  // the first segment should be dropped and playback moves on
  player.hls.checkBuffer_();
  equal(bytes.length, 1, 'did not append bytes');
  equal(bytes[0], 'flv', 'appended the flv header');

  tags.length = 0;
  tags.push({ pts: 2833, bytes: new Uint8Array([1]) },
            { pts: 4833, bytes: new Uint8Array([2]) });
  // second segment request
  standardXHRResponse(requests.shift());

  equal(bytes.length, 2, 'appended bytes');
  deepEqual(bytes[1], new Uint8Array([1, 2]), 'skipped to the second segment');
});

test('live stream should not call endOfStream', function(){
  player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.trigger('play');
  requests[0].respond(200, null,
                      '#EXTM3U\n' +
                      '#EXT-X-MEDIA-SEQUENCE:0\n' +
                      '#EXTINF:1\n' +
                      '0.ts\n'
                     );
  requests[1].response = window.bcSegment;
  requests[1].respond(200, null, "");
  equal("open", player.hls.mediaSource.readyState,
        "media source should be in open state, not ended state for live stream after the last segment in m3u8 downloaded");
});

test('does not download segments if preload option set to none', function() {
  var loadedSegments = 0,
      tech = player.el().querySelector('.vjs-tech'),
      properties = {};

  player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  tech.vjs_getProperty = function(property) { return properties[property]; };
  tech.vjs_setProperty = function(property, value) { properties[property] = value; };
  player.preload('none');

  player.hls.loadSegment = function () {
    loadedSegments++;
  };

  player.currentSrc = function() {
    return player.src;
  };

  openMediaSource(player);
  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media
  player.hls.checkBuffer_();

  strictEqual(loadedSegments, 0, 'did not download any segments');
});

})(window, window.videojs);

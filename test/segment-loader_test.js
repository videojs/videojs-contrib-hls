/* Tests for the SegmentLoader */
(function(window, videojs) {
  'use strict';

  var
    SegmentLoader = videojs.Hls.SegmentLoader,
    createTimeRanges = videojs.createTimeRanges;

  var clock, xhr, requests, mse, useFakeEnvironment, restoreEnvironment;
  useFakeEnvironment = function() {
    clock = sinon.useFakeTimers();
    xhr = sinon.useFakeXMLHttpRequest();
    videojs.xhr.XMLHttpRequest = xhr;
    requests = [];
    xhr.onCreate = function(xhr) {
      requests.push(xhr);
    };
  };
  restoreEnvironment = function() {
    clock.restore();
    videojs.xhr.XMLHttpRequest = window.XMLHttpRequest;
    xhr.restore();
  };

  var playlistWithDuration = function(time) {
    var
      result = {
        mediaSequence: 0,
        discontinuityStarts: [],
        segments: [],
        endList: true
      },
      count = Math.floor(time / 10),
      remainder = time % 10,
      i;

    for (i = 0; i < count ; i++) {
      result.segments.push({
        uri: i + '.ts',
        resolvedUri: i + '.ts',
        duration: 10
      });
    }
    if (remainder) {
      result.segments.push({
        uri: i + '.ts',
        duration: remainder
      });
    }
    return result;
  };

  var loader, currentTime, mediaSource;

  module('Segment Loader', {
    beforeEach: function() {
      useFakeEnvironment();
      mse = videojs.useFakeMediaSource();

      currentTime = 0;
      mediaSource =  new videojs.MediaSource();
      loader = new SegmentLoader({
        currentTime: function() {
          return currentTime;
        },
        mediaSource: mediaSource
      });
    },
    afterEach: function() {
      restoreEnvironment();
      mse.restore();
    }
  });

  test('fails without required initialization options', function() {
    throws(function() {
      new SegmentLoader();
    }, 'requires options');
    throws(function() {
      new SegmentLoader({});
    }, 'requires a currentTime callback');
    throws(function() {
      new SegmentLoader({
        currentTime: function() {}
      });
    }, 'requires a media source');
  });

  test('load fails before specifying a playlist', function() {
    throws(function() {
      loader.load();
    }, 'checks for a playlist');
  });

  test('calling load begins buffering', function() {
    equal(loader.state, 'INIT', 'starts in the init state');
    loader.playlist(playlistWithDuration(10));
    equal(loader.state, 'INIT', 'starts in the init state');
    ok(loader.paused(), 'starts paused');

    loader.load();
    equal(loader.state, 'WAITING', 'moves to the ready state');
    ok(!loader.paused(), 'loading is not paused');
    equal(requests.length, 1, 'requested a segment');
  });

  test('calculates bandwidth after downloading a segment', function() {
    loader.playlist(playlistWithDuration(10));
    loader.load();

    // some time passes and a response is received
    clock.tick(100);
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');

    equal(loader.bandwidth, (10 / 100) * 8 * 1000, 'calculated bandwidth');
    equal(loader.roundTrip, 100, 'saves request round trip time');
    equal(loader.bytesReceived, 10, 'saves bytes received');
  });

  test('segment request timeouts reset bandwidth', function() {
    loader.playlist(playlistWithDuration(10));
    loader.load();

    // a lot of time passes so the request times out
    requests[0].timedout = true;
    clock.tick(100 * 1000);

    equal(loader.bandwidth, 1, 'reset bandwidth');
    ok(isNaN(loader.roundTrip), 'reest round trip time');
    equal(loader.state, 'READY', 'back to ready state');
  });

  test('appending a segment triggers progress', function() {
    var progresses = 0;
    loader.on('progress', function() {
      progresses++;
    });
    loader.playlist(playlistWithDuration(10));
    loader.load();
    mediaSource.trigger('sourceopen');

    // some time passes and a response is received
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');
    mediaSource.sourceBuffers[0].trigger('updateend');

    equal(progresses, 1, 'fired progress');
  });

  test('only requests one segment at a time', function() {
    loader.playlist(playlistWithDuration(10));
    loader.load();

    // a bunch of time passes without recieving a response
    clock.tick(20 * 1000);
    equal(requests.length, 1, 'only one request was made');
  });

  test('only appends one segment at a time', function() {
    loader.playlist(playlistWithDuration(10));
    loader.load();
    mediaSource.trigger('sourceopen');

    // some time passes and a segment is received
    clock.tick(100);
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');

    // a lot of time goes by without "updateend"
    clock.tick(20 * 1000);

    equal(mediaSource.sourceBuffers[0].updates_.length, 1, 'made one update');
    ok(mediaSource.sourceBuffers[0].updates_[0].append, 'appended');
    equal(requests.length, 0, 'only made one request');
  });

  test('adjusts the playlist offset if no buffering progress is made', function() {
    var sourceBuffer, playlist;
    playlist = playlistWithDuration(40);
    playlist.endList = false;
    loader.playlist(playlist);
    loader.load();
    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];

    // buffer some content and switch playlists on progress
    clock.tick(1);
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');
    loader.on('progress', function f() {
      loader.off('progress', f);
      // switch playlists
      playlist = playlistWithDuration(40);
      playlist.uri = 'alternate.m3u8';
      playlist.endList = false;
      loader.playlist(playlist);
    });
    sourceBuffer.buffered = createTimeRanges([[0, 10]]);
    sourceBuffer.trigger('updateend');

    // the next segment doesn't increase the buffer at all
    equal(requests[0].url, '1.ts', 'requested the equivalent segment');
    clock.tick(1);
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');
    sourceBuffer.trigger('updateend');

    // so the loader should try the next segment
    equal(requests[0].url, '2.ts', 'moved ahead a segment');
  });

  test('cancels outstanding requests on abort', function() {
    loader.playlist(playlistWithDuration(20));
    loader.load();

    loader.abort();
    ok(requests[0].aborted, 'aborted the first request');
    equal(requests.length, 2, 'started a new request');
    equal(loader.state, 'WAITING', 'back to the waiting state');
  });

  test('abort does not cancel segment processing in progress', function() {
    loader.playlist(playlistWithDuration(20));
    loader.load();

    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');

    loader.abort();
    equal(loader.state, 'APPENDING', 'still appending');
  });

  test('sets the timestampOffset on discontinuity', function() {
    var playlist = playlistWithDuration(40);
    playlist.discontinuityStarts = [1];
    playlist.segments[1].discontinuity = true;
    loader.playlist(playlist);
    loader.load();
    mediaSource.trigger('sourceopen');

    // segment 0
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');
    mediaSource.sourceBuffers[0].buffered = createTimeRanges([[0, 10]]);
    mediaSource.sourceBuffers[0].trigger('updateend');

    // segment 1, discontinuity
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');
    equal(mediaSource.sourceBuffers[0].timestampOffset, 10, 'set timestampOffset');
  });

  test('tracks segment end times as they are buffered', function() {
    var playlist = playlistWithDuration(20);
    loader.playlist(playlist);
    loader.load();
    mediaSource.trigger('sourceopen');

    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');

    mediaSource.sourceBuffers[0].buffered = createTimeRanges([
      [0, 9.5]
    ]);
    mediaSource.sourceBuffers[0].trigger('updateend');
    equal(playlist.segments[0].end, 9.5, 'updated duration');
  });

  test('segment 404s should trigger an error', function() {
    var errors = [];

    loader.playlist(playlistWithDuration(10));
    loader.load();
    loader.on('error', function(error) {
      errors.push(error);
    });
    requests.shift().respond(404, null, '');


    equal(errors.length, 1, 'triggered an error');
    equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
    ok(loader.error().xhr, 'included the request object');
    ok(loader.paused(), 'paused the loader');
    equal(loader.state, 'READY', 'returned to the ready state');
  });

  test('segment 5xx status codes trigger an error', function() {
    var errors = [];

    loader.playlist(playlistWithDuration(10));
    loader.load();
    loader.on('error', function(error) {
      errors.push(error);
    });
    requests.shift().respond(500, null, '');

    equal(errors.length, 1, 'triggered an error');
    equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
    ok(loader.error().xhr, 'included the request object');
    ok(loader.paused(), 'paused the loader');
    equal(loader.state, 'READY', 'returned to the ready state');
  });

  test('fires ended at the end of a playlist', function() {
    var endOfStreams = 0;
    loader.playlist(playlistWithDuration(10));
    loader.load();
    mediaSource.trigger('sourceopen');
    loader.mediaSource_ = {
      readyState: 'open',
      sourceBuffers: mediaSource.sourceBuffers,
      endOfStream: function() {
        endOfStreams++;
      }
    };

    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');
    mediaSource.sourceBuffers[0].buffered = createTimeRanges([[0, 10]]);
    mediaSource.sourceBuffers[0].trigger('updateend');
    equal(endOfStreams, 1, 'triggered ended');
  });

  test('respects the global withCredentials option', function() {
    var hlsOptions = videojs.options.hls;
    videojs.options.hls = {
      withCredentials: true
    };
    loader = new SegmentLoader({
      currentTime: function() {
        return currentTime;
      },
      mediaSource: mediaSource
    });
    loader.playlist(playlistWithDuration(10));
    loader.load();

    ok(requests[0].withCredentials, 'used withCredentials');
    videojs.options.hls = hlsOptions;
  });

  test('respects the withCredentials option', function() {
    loader = new SegmentLoader({
      currentTime: function() {
        return currentTime;
      },
      mediaSource: mediaSource,
      withCredentials: true
    });
    loader.playlist(playlistWithDuration(10));
    loader.load();

    ok(requests[0].withCredentials, 'used withCredentials');
  });

  test('the withCredentials option overrides the global', function() {
    var hlsOptions = videojs.options.hls;
    videojs.options.hls = {
      withCredentials: true
    };
    loader = new SegmentLoader({
      currentTime: function() {
        return currentTime;
      },
      mediaSource: mediaSource,
      withCredentials: false
    });
    loader.playlist(playlistWithDuration(10));
    loader.load();

    ok(!requests[0].withCredentials, 'overrode withCredentials');
  });

  test('remains ready if there are no segments', function() {
    loader.playlist(playlistWithDuration(0));
    loader.load();
    equal(loader.state, 'READY', 'in the ready state');
  });

  // --------------
  // TO BE MIGRATED
  // --------------

  // ----------
  // Decryption
  // ----------

  QUnit.skip('keys are requested when an encrypted segment is loaded', function() {
    player.src({
      src: 'https://example.com/encrypted.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(player);
    player.tech_.trigger('play');
    standardXHRResponse(requests.shift()); // playlist

    strictEqual(requests.length, 2, 'a key XHR is created');
    strictEqual(requests[0].url,
                player.tech_.hls.playlists.media().segments[0].key.uri,
                'key XHR is created with correct uri');
    strictEqual(requests[1].url,
                player.tech_.hls.playlists.media().segments[0].uri,
                'segment XHR is created with correct uri');
  });

  QUnit.skip('keys are resolved relative to the master playlist', function() {
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
    equal(requests.length, 2, 'requested the key');
    equal(requests[0].url,
          absoluteUrl('video/playlist/keys/key.php'),
          'resolves multiple relative paths');
  });

  QUnit.skip('keys are resolved relative to their containing playlist', function() {
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
    equal(requests.length, 2, 'requested a key');
    equal(requests[0].url,
          absoluteUrl('video/keys/key.php'),
          'resolves multiple relative paths');
  });

  QUnit.skip('a new key XHR is created when a the segment is requested', function() {
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
    standardXHRResponse(requests.shift()); // key 1
    standardXHRResponse(requests.shift()); // segment 1
    // "finish" decrypting segment 1
    player.tech_.hls.pendingSegment_.bytes = new Uint8Array(16);
    player.tech_.hls.checkBuffer_();
    player.tech_.buffered = function() {
      return videojs.createTimeRange(0, 2.833);
    };
    player.tech_.hls.sourceBuffer.trigger('updateend');

    strictEqual(requests.length, 2, 'a key XHR is created');
    strictEqual(requests[0].url,
                'https://example.com/' +
                player.tech_.hls.playlists.media().segments[1].key.uri,
                'a key XHR is created with the correct uri');
  });

  QUnit.skip('seeking should abort an outstanding key request and create a new one', function() {
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
    standardXHRResponse(requests.pop()); // segment 1

    player.currentTime(11);
    clock.tick(1);
    ok(requests[0].aborted, 'the key XHR should be aborted');
    requests.shift(); // aborted key 1

    equal(requests.length, 2, 'requested the new key');
    equal(requests[0].url,
          'https://example.com/' +
          player.tech_.hls.playlists.media().segments[1].key.uri,
          'urls should match');
  });

  QUnit.skip('retries key requests once upon failure', function() {
    player.src({
      src: 'https://example.com/encrypted.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(player);
    player.tech_.trigger('play');

    requests.shift().respond(200, null,
                             '#EXTM3U\n' +
                             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                             '#EXTINF:2.833,\n' +
                             'http://media.example.com/fileSequence52-A.ts\n' +
                             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
                             '#EXTINF:15.0,\n' +
                             'http://media.example.com/fileSequence53-A.ts\n');
    standardXHRResponse(requests.pop()); // segment
    requests[0].respond(404);
    equal(requests.length, 2, 'create a new XHR for the same key');
    equal(requests[1].url, requests[0].url, 'should be the same key');

    requests[1].respond(404);
    equal(requests.length, 2, 'gives up after one retry');
  });


  QUnit.skip('the key is supplied to the decrypter in the correct format', function() {
    var keys = [];

    player.src({
      src: 'https://example.com/encrypted-media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(player);
    player.tech_.trigger('play');

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

    standardXHRResponse(requests.pop()); // segment
    requests[0].response = new Uint32Array([0,1,2,3]).buffer;
    requests[0].respond(200, null, '');
    requests.shift(); // key

    equal(keys.length, 1, 'only one Decrypter was constructed');
    deepEqual(keys[0],
              new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
              'passed the specified segment key');

  });
  QUnit.skip('supplies the media sequence of current segment as the IV by default, if no IV is specified', function() {
    var ivs = [];

    player.src({
      src: 'https://example.com/encrypted-media.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(player);
    player.tech_.trigger('play');

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

  QUnit.skip('switching playlists with an outstanding key request does not stall playback', function() {
    var buffered = [];
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
    player.tech_.trigger('play');

    player.tech_.hls.bandwidth = 1;
    player.tech_.buffered = function() {
      return videojs.createTimeRange(buffered);
    };
    // master playlist
    standardXHRResponse(requests.shift());
    // media playlist
    requests.shift().respond(200, null, media);
    // mock out media switching from this point on
    player.tech_.hls.playlists.media = function() {
      return player.tech_.hls.playlists.master.playlists[1];
    };
    // first segment of the original media playlist
    standardXHRResponse(requests.pop());

    // "switch" media
    player.tech_.hls.playlists.trigger('mediachange');
    ok(!requests[0].aborted, 'did not abort the key request');

    // "finish" decrypting segment 1
    standardXHRResponse(requests.shift()); // key
    player.tech_.hls.pendingSegment_.bytes = new Uint8Array(16);
    player.tech_.hls.checkBuffer_();
    buffered = [[0, 2.833]];
    player.tech_.hls.sourceBuffer.trigger('updateend');
    player.tech_.hls.checkBuffer_();

    equal(requests.length, 1, 'made a request');
    equal(requests[0].url,
          'http://media.example.com/fileSequence52-B.ts',
          'requested the segment');
  });

  QUnit.skip('resolves relative key URLs against the playlist', function() {
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
    equal(requests[0].url, 'https://example.com/key.php?r=52', 'resolves the key URL');
  });

 // --------------------

  QUnit.skip('cleans up the buffer when loading live segments', function() {
    var
      removes = [],
      seekable = videojs.createTimeRanges([[60, 120]]);

    player.src({
      src: 'liveStart30sBefore.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(player);
    player.tech_.hls.seekable = function(){
      return seekable;
    };

    openMediaSource(player);
    player.tech_.hls.mediaSource.addSourceBuffer = function() {
      return new (videojs.extend(videojs.EventTarget, {
        constructor: function() {},
        abort: function() {},
        buffered: videojs.createTimeRange(),
        appendBuffer: function() {},
        remove: function(start, end) {
          removes.push([start, end]);
        }
      }))();
    };
    player.tech_.hls.bandwidth = 20e10;
    player.tech_.triggerReady();
    standardXHRResponse(requests[0]);

    player.tech_.hls.playlists.trigger('loadedmetadata');
    player.tech_.trigger('canplay');
    player.tech_.paused = function() { return false; };
    player.tech_.readyState = function(){return 1;};
    player.tech_.trigger('play');

    clock.tick(1);
    standardXHRResponse(requests[1]);

    strictEqual(requests[0].url, 'liveStart30sBefore.m3u8', 'master playlist requested');
    equal(removes.length, 1, 'remove called');
    deepEqual(removes[0], [0, seekable.start(0)], 'remove called with the right range');
  });

  QUnit.skip('cleans up the buffer when loading VOD segments', function() {
    var removes = [];
    player.src({
      src: 'manifest/master.m3u8',
      type: 'application/vnd.apple.mpegurl'
    });
    openMediaSource(player);
    player.tech_.hls.mediaSource.addSourceBuffer = function() {
      return new (videojs.extend(videojs.EventTarget, {
        constructor: function() {},
        abort: function() {},
        buffered: videojs.createTimeRange(),
        appendBuffer: function() {},
        remove: function(start, end) {
          removes.push([start, end]);
        }
      }))();
    };
    player.tech_.hls.bandwidth = 20e10;
    standardXHRResponse(requests[0]);
    player.currentTime(120);
    standardXHRResponse(requests[1]);
    standardXHRResponse(requests[2]);

    strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
    strictEqual(requests[1].url,
                absoluteUrl('manifest/media3.m3u8'),
                'media playlist requested');
    equal(removes.length, 1, 'remove called');
    deepEqual(removes[0], [0, 120 - 60], 'remove called with the right range');
  });

  module('Segment Loading Calculation', {
    beforeEach: function() {
      useFakeEnvironment();

      currentTime = 0;
      loader = new SegmentLoader({
        currentTime: function() {
          return currentTime;
        },
        mediaSource: new videojs.MediaSource()
      });
    },
    afterEach: restoreEnvironment
  });

  test('requests the first segment with an empty buffer', function() {
    var segmentInfo = loader.checkBuffer_(createTimeRanges(),
                                          playlistWithDuration(20),
                                          0);

    ok(segmentInfo, 'generated a request');
    equal(segmentInfo.uri, '0.ts', 'requested the first segment');
  });

  test('does not download the next segment if the buffer is full', function() {
    var buffered, segmentInfo;
    buffered = createTimeRanges([
      [0, 15 + videojs.Hls.GOAL_BUFFER_LENGTH]
    ]);
    segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(30), 15);

    ok(!segmentInfo, 'no segment request generated');
  });

  test('downloads the next segment if the buffer is getting low', function() {
    var buffered, segmentInfo;
    buffered = createTimeRanges([[0, 19.999]]);
    segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(30), 15);

    ok(segmentInfo, 'made a request');
    equal(segmentInfo.uri, '1.ts', 'requested the second segment');
  });

  test('buffers based on the correct TimeRange if multiple ranges exist', function() {
    var buffered, segmentInfo;
    buffered = createTimeRanges([[0, 10], [20, 30]]);
    segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(40), 8);

    ok(segmentInfo, 'made a request');
    equal(segmentInfo.uri, '1.ts', 'requested the second segment');

    segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(40), 20);
    ok(segmentInfo, 'made a request');
    equal(segmentInfo.uri, '3.ts', 'requested the fourth segment');
  });

  test('stops downloading segments at the end of the playlist', function() {
    var buffered, segmentInfo;
    buffered = createTimeRanges([[0, 60]]);
    segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(60), 0);

    ok(!segmentInfo, 'no request was made');
  });

  test('calculates timestampOffset for discontinuities', function() {
    var segmentInfo, playlist;
    playlist = playlistWithDuration(60);
    playlist.segments[3].end = 37.9;
    playlist.discontinuityStarts = [4];
    playlist.segments[4].discontinuity = true;

    segmentInfo = loader.checkBuffer_(createTimeRanges([[0, 37.9]]), playlist, 36);
    equal(segmentInfo.timestampOffset, 37.9, 'placed the discontinuous segment');
  });

  test('adjusts calculations based on an offset', function() {
    var buffered, playlist, segmentInfo;
    buffered = createTimeRanges([[0, 30]]);
    playlist = playlistWithDuration(50);

    segmentInfo = loader.checkBuffer_(buffered,
                                      playlist,
                                      40 - videojs.Hls.GOAL_BUFFER_LENGTH,
                                      10);
    ok(segmentInfo, 'fetched a segment');
    equal(segmentInfo.uri, '2.ts', 'accounted for the offset');
  });

})(window, window.videojs);

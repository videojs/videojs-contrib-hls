/* Tests for the SegmentLoader */
(function(window, videojs) {
  'use strict';

  var
    SegmentLoader = videojs.Hls.SegmentLoader,
    createTimeRanges = videojs.createTimeRanges;

  var clock, xhr, requests, mse, env;

  var playlistWithDuration = function(time, conf) {
    var
      result = {
        mediaSequence: conf && conf.mediaSequence ? conf.mediaSequence : 0,
        discontinuityStarts: [],
        segments: [],
        endList: true
      },
      count = Math.floor(time / 10),
      remainder = time % 10,
      i,
      isEncrypted = conf && conf.isEncrypted;

    for (i = 0; i < count ; i++) {
      result.segments.push({
        uri: i + '.ts',
        resolvedUri: i + '.ts',
        duration: 10
      });
      if (isEncrypted) {
        result.segments[i]['key'] = {
          uri: i + '-key.php',
          resolvedUri: i + '-key.php'
        };
      }
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
      env = videojs.useFakeEnvironment();
      clock = env.clock;
      requests = env.requests;
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
      env.restore();
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

  test('load waits until a playlist is specified to proceed', function() {
    loader.load();
    equal(loader.state, 'INIT', 'waiting in init');
    equal(loader.paused(), false, 'not paused');

    loader.playlist(playlistWithDuration(10));
    equal(requests.length, 1, 'made a request');
    equal(loader.state, 'WAITING', 'transitioned states');
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

  test('calling load is idempotent', function() {
    loader.playlist(playlistWithDuration(20));
    loader.load();
    equal(loader.state, 'WAITING', 'moves to the ready state');
    equal(requests.length, 1, 'made one request');

    loader.load();
    equal(loader.state, 'WAITING', 'still in the ready state');
    equal(requests.length, 1, 'still one request');

    // some time passes and a response is received
    clock.tick(100);
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');
    loader.load();
    equal(requests.length, 0, 'load has no effect');
  });

  test('calling load should unpause', function() {
    var sourceBuffer;
    loader.playlist(playlistWithDuration(20));
    loader.pause();
    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];

    loader.load();
    equal(loader.paused(), false, 'loading unpauses');

    loader.pause();
    clock.tick(1);
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');

    equal(loader.paused(), true, 'stayed paused');
    loader.load();
    equal(loader.paused(), false, 'unpaused during processing');

    loader.pause();
    sourceBuffer.trigger('updateend');
    equal(loader.state, 'READY', 'finished processing');
    ok(loader.paused(), 'stayed paused');

    loader.load();
    equal(loader.paused(), false, 'unpaused');
  });

  test('regularly checks the buffer while unpaused', function() {
    var sourceBuffer;
    loader.playlist(playlistWithDuration(90));
    loader.load();
    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];

    // fill the buffer
    clock.tick(1);
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');
    sourceBuffer.buffered = createTimeRanges([[
      0, videojs.Hls.GOAL_BUFFER_LENGTH
    ]]);
    sourceBuffer.trigger('updateend');
    equal(requests.length, 0, 'no outstanding requests');

    // play some video to drain the buffer
    currentTime = videojs.Hls.GOAL_BUFFER_LENGTH;
    clock.tick(10 * 1000);
    equal(requests.length, 1, 'requested another segment');
  });

  test('does not check the buffer while paused', function() {
    var sourceBuffer;
    loader.playlist(playlistWithDuration(90));
    loader.load();
    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];

    loader.pause();
    clock.tick(1);
    requests[0].response = new Uint8Array(10).buffer;
    requests.shift().respond(200, null, '');
    sourceBuffer.trigger('updateend');

    clock.tick(10 * 1000);
    equal(requests.length, 0, 'did not make a request');
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
    ok(isNaN(loader.roundTrip), 'reset round trip time');
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
    loader.xhr_.segmentXhr.onreadystatechange = function() {
      throw 'onreadystatechange should not be called';
    };

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

  test('live playlists do not trigger ended', function() {
    var endOfStreams = 0, playlist;
    playlist = playlistWithDuration(10);
    playlist.endList = false;
    loader.playlist(playlist);
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
    equal(endOfStreams, 0, 'did not trigger ended');
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
    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    loader.load();

    equal(requests[0].url, '0-key.php', 'requested the first segment\'s key');
    ok(requests[0].withCredentials, 'key request used withCredentials');
    equal(requests[1].url, '0.ts', 'requested the first segment');
    ok(requests[1].withCredentials, 'segment request used withCredentials');
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
    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    loader.load();

    equal(requests[0].url, '0-key.php', 'requested the first segment\'s key');
    ok(requests[0].withCredentials, 'key request used withCredentials');
    equal(requests[1].url, '0.ts', 'requested the first segment');
    ok(requests[1].withCredentials, 'segment request used withCredentials');
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
    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    loader.load();

    equal(requests[0].url, '0-key.php', 'requested the first segment\'s key');
    ok(!requests[0].withCredentials, 'overrode key request withCredentials');
    equal(requests[1].url, '0.ts', 'requested the first segment');
    ok(!requests[1].withCredentials, 'overrode segment request withCredentials');
    videojs.options.hls = hlsOptions;
  });

  test('remains ready if there are no segments', function() {
    loader.playlist(playlistWithDuration(0));
    loader.load();
    equal(loader.state, 'READY', 'in the ready state');
  });

  test('dispose cleans up outstanding work', function() {
    loader.playlist(playlistWithDuration(20));
    loader.load();
    mediaSource.trigger('sourceopen');

    loader.dispose();
    ok(requests[0].aborted, 'aborted segment request');
    equal(requests.length, 1, 'did not open another request');
  });

  // ----------
  // Decryption
  // ----------

  test('calling load with an encrypted segment requests key and segment', function() {
    equal(loader.state, 'INIT', 'starts in the init state');
    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    equal(loader.state, 'INIT', 'starts in the init state');
    ok(loader.paused(), 'starts paused');

    loader.load();
    equal(loader.state, 'WAITING', 'moves to the ready state');
    ok(!loader.paused(), 'loading is not paused');
    equal(requests.length, 2, 'requested a segment and key');
    equal(requests[0].url, '0-key.php', 'requested the first segment\'s key');
    equal(requests[1].url, '0.ts', 'requested the first segment');
  });

  test('cancels outstanding key request on abort', function() {
    loader.playlist(playlistWithDuration(20, {isEncrypted: true}));
    loader.load();
    loader.xhr_.keyXhr.onreadystatechange = function() {
      throw 'onreadystatechange should not be called';
    };

    equal(requests.length, 2, 'requested a segment and key');
    loader.abort();
    equal(requests[0].url, '0-key.php', 'requested the first segment\'s key');
    ok(requests[0].aborted, 'aborted the first key request');
    equal(requests.length, 4, 'started a new request');
    equal(loader.state, 'WAITING', 'back to the waiting state');
  });

  test('dispose cleans up key requests for encrypted segments', function() {
    loader.playlist(playlistWithDuration(20, {isEncrypted: true}));
    loader.load();
    mediaSource.trigger('sourceopen');

    loader.dispose();
    equal(requests.length, 2, 'requested a segment and key');
    equal(requests[0].url, '0-key.php', 'requested the first segment\'s key');
    ok(requests[0].aborted, 'aborted the first segment\s key request');
    equal(requests.length, 2, 'did not open another request');
  });

  test('key 404s should trigger an error', function() {
    var errors = [];

    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    loader.load();
    loader.on('error', function(error) {
      errors.push(error);
    });
    requests.shift().respond(404, null, '');

    equal(errors.length, 1, 'triggered an error');
    equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
    equal(loader.error().message, 'HLS key request error at URL: 0-key.php',
          'receieved a key error message');
    ok(loader.error().xhr, 'included the request object');
    ok(loader.paused(), 'paused the loader');
    equal(loader.state, 'READY', 'returned to the ready state');
  });

  test('key 5xx status codes trigger an error', function() {
    var errors = [];

    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    loader.load();
    loader.on('error', function(error) {
      errors.push(error);
    });
    requests.shift().respond(500, null, '');

    equal(errors.length, 1, 'triggered an error');
    equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
    equal(loader.error().message, 'HLS key request error at URL: 0-key.php',
          'receieved a key error message');
    ok(loader.error().xhr, 'included the request object');
    ok(loader.paused(), 'paused the loader');
    equal(loader.state, 'READY', 'returned to the ready state');
  });

  test('the key is supplied to the decrypter in the correct format', function() {
    var keys = [], keyRequest, segmentRequest;

    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    loader.load();

    videojs.Hls.Decrypter = function(encrypted, key) {
      keys.push(key);
    };

    keyRequest = requests.shift();
    keyRequest.response = new Uint32Array([0,1,2,3]).buffer;
    keyRequest.respond(200, null, '');

    segmentRequest = requests.shift();
    segmentRequest.response = new Uint8Array(10).buffer;
    segmentRequest.respond(200, null, '');

    equal(keys.length, 1, 'only one Decrypter was constructed');
    deepEqual(keys[0],
              new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
              'passed the specified segment key');
  });

  test('supplies media sequence of current segment as the IV by default, if no IV is specified',
       function() {
    var ivs = [], keyRequest, segmentRequest;

    loader.playlist(playlistWithDuration(10, {isEncrypted: true, mediaSequence: 5}));
    loader.load();

    videojs.Hls.Decrypter = function(encrypted, key, iv) {
      ivs.push(iv);
    };

    keyRequest = requests.shift();
    keyRequest.response = new Uint32Array([0,0,0,0]).buffer;
    keyRequest.respond(200, null, '');

    segmentRequest = requests.shift();
    segmentRequest.response = new Uint8Array(10).buffer;
    segmentRequest.respond(200, null, '');

    equal(ivs.length, 1, 'only one Decrypter was constructed');
    deepEqual(ivs[0],
              new Uint32Array([0, 0, 0, 5]),
              'the IV for the segment is the media sequence');
  });

  test('segment with key has decrypted bytes appended during processing', function() {
    var keyRequest, segmentRequest, didCallHandleSegment, origDecrypter;

    origDecrypter = videojs.Hls.Decrypter;
    videojs.Hls.Decrypter = function(encrypted, key, initVector, done) {
      done(null, new Uint8Array(10).buffer);
    };
    loader.handleSegment_ = function() {
      didCallHandleSegment = true;
    };

    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    loader.load();

    segmentRequest = requests.pop();
    segmentRequest.response = new Uint8Array(10).buffer;
    segmentRequest.respond(200, null, '');
    ok(loader.pendingSegment_.encryptedBytes, 'encrypted bytes in segment');
    ok(!loader.pendingSegment_.bytes, 'no decrypted bytes in segment');

    keyRequest = requests.shift();
    keyRequest.response = new Uint32Array([0,0,0,0]).buffer;
    keyRequest.respond(200, null, '');

    ok(loader.pendingSegment_.bytes, 'decrypted bytes in segment');
    ok(didCallHandleSegment, 'called to handle segment');

    videojs.Hls.Decrypter = origDecrypter;
  });

  test('calling load with an encrypted segment waits for both key and segment before processing',
       function() {
    var keyRequest, segmentRequest;
    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    loader.load();

    equal(loader.state, 'WAITING', 'moves to waiting state');
    equal(requests.length, 2, 'requested a segment and key');
    equal(requests[0].url, '0-key.php', 'requested the first segment\'s key');
    equal(requests[1].url, '0.ts', 'requested the first segment');
    segmentRequest = requests.shift();
    segmentRequest.response = new Uint8Array(10).buffer;
    segmentRequest.respond(200, null, '');
    equal(loader.state, 'WAITING', 'still in waiting state');
    keyRequest = requests.shift();
    keyRequest.response = new Uint32Array([0,0,0,0]).buffer;
    keyRequest.respond(200, null, '');
    equal(loader.state, 'DECRYPTING', 'moves to decrypting state');
  });

  test('key request timeouts reset bandwidth', function() {
    loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
    loader.load();

    equal(requests[0].url, '0-key.php', 'requested the first segment\'s key');
    equal(requests[1].url, '0.ts', 'requested the first segment');
    // a lot of time passes so the request times out
    requests[0].timedout = true;
    clock.tick(100 * 1000);

    equal(loader.bandwidth, 1, 'reset bandwidth');
    ok(isNaN(loader.roundTrip), 'reset round trip time');
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
      env = videojs.useFakeEnvironment();

      currentTime = 0;
      loader = new SegmentLoader({
        currentTime: function() {
          return currentTime;
        },
        mediaSource: new videojs.MediaSource()
      });
    },
    afterEach: function() {
      env.restore();
    }
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

import QUnit from 'qunit';
import {GOAL_BUFFER_LENGTH, default as SegmentLoader} from '../src/segment-loader';
import videojs from 'video.js';
import xhrFactory from '../src/xhr';
import { useFakeEnvironment, useFakeMediaSource } from './test-helpers.js';

const playlistWithDuration = function(time, conf) {
  let result = {
    mediaSequence: conf && conf.mediaSequence ? conf.mediaSequence : 0,
    discontinuityStarts: [],
    segments: [],
    endList: true
  };
  let count = Math.floor(time / 10);
  let remainder = time % 10;
  let i;
  let isEncrypted = conf && conf.isEncrypted;

  for (i = 0; i < count; i++) {
    result.segments.push({
      uri: i + '.ts',
      resolvedUri: i + '.ts',
      duration: 10
    });
    if (isEncrypted) {
      result.segments[i].key = {
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

let currentTime;
let mediaSource;
let loader;

QUnit.module('Segment Loader', {
  beforeEach() {
    this.env = useFakeEnvironment();
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.seekable = {
      length: 0
    };
    this.mimeType = 'video/mp2t';
    this.fakeHls = {
      xhr: xhrFactory()
    };

    currentTime = 0;
    mediaSource = new videojs.MediaSource();
    mediaSource.trigger('sourceopen');
    loader = new SegmentLoader({
      hls: this.fakeHls,
      currentTime() {
        return currentTime;
      },
      seekable: () => this.seekable,
      seeking: () => false,
      hasPlayed: () => true,
      mediaSource
    });
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
  }
});

QUnit.test('fails without required initialization options', function() {
  /* eslint-disable no-new */
  QUnit.throws(function() {
    new SegmentLoader();
  }, 'requires options');
  QUnit.throws(function() {
    new SegmentLoader({});
  }, 'requires a currentTime callback');
  QUnit.throws(function() {
    new SegmentLoader({
      currentTime() {}
    });
  }, 'requires a media source');
  /* eslint-enable */
});

QUnit.test('load waits until a playlist and mime type are specified to proceed',
function() {
  loader.load();
  QUnit.equal(loader.state, 'INIT', 'waiting in init');
  QUnit.equal(loader.paused(), false, 'not paused');

  loader.playlist(playlistWithDuration(10));
  QUnit.equal(this.requests.length, 0, 'have not made a request yet');
  loader.mimeType(this.mimeType);

  QUnit.equal(this.requests.length, 1, 'made a request');
  QUnit.equal(loader.state, 'WAITING', 'transitioned states');
});

QUnit.test('calling mime type and load begins buffering', function() {
  QUnit.equal(loader.state, 'INIT', 'starts in the init state');
  loader.playlist(playlistWithDuration(10));
  QUnit.equal(loader.state, 'INIT', 'starts in the init state');
  QUnit.ok(loader.paused(), 'starts paused');

  loader.mimeType(this.mimeType);
  QUnit.equal(loader.state, 'INIT', 'still in the init state');
  loader.load();

  QUnit.equal(loader.state, 'WAITING', 'moves to the ready state');
  QUnit.ok(!loader.paused(), 'loading is not paused');
  QUnit.equal(this.requests.length, 1, 'requested a segment');
});

QUnit.test('calling load is idempotent', function() {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  QUnit.equal(loader.state, 'WAITING', 'moves to the ready state');
  QUnit.equal(this.requests.length, 1, 'made one request');

  loader.load();
  QUnit.equal(loader.state, 'WAITING', 'still in the ready state');
  QUnit.equal(this.requests.length, 1, 'still one request');

  // some time passes and a response is received
  this.clock.tick(100);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  loader.load();
  QUnit.equal(this.requests.length, 0, 'load has no effect');
});

QUnit.test('calling load should unpause', function() {
  let sourceBuffer;

  loader.playlist(playlistWithDuration(20));
  loader.pause();

  loader.mimeType(this.mimeType);
  sourceBuffer = mediaSource.sourceBuffers[0];

  loader.load();
  QUnit.equal(loader.paused(), false, 'loading unpauses');

  loader.pause();
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  QUnit.equal(loader.paused(), true, 'stayed paused');
  loader.load();
  QUnit.equal(loader.paused(), false, 'unpaused during processing');

  loader.pause();
  sourceBuffer.trigger('updateend');
  QUnit.equal(loader.state, 'READY', 'finished processing');
  QUnit.ok(loader.paused(), 'stayed paused');

  loader.load();
  QUnit.equal(loader.paused(), false, 'unpaused');
});

QUnit.test('regularly checks the buffer while unpaused', function() {
  let sourceBuffer;

  loader.playlist(playlistWithDuration(90));
  loader.mimeType(this.mimeType);
  loader.load();
  sourceBuffer = mediaSource.sourceBuffers[0];

  // fill the buffer
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.buffered = videojs.createTimeRanges([[
    0, GOAL_BUFFER_LENGTH
  ]]);
  sourceBuffer.trigger('updateend');
  QUnit.equal(this.requests.length, 0, 'no outstanding requests');

  // play some video to drain the buffer
  currentTime = GOAL_BUFFER_LENGTH;
  this.clock.tick(10 * 1000);
  QUnit.equal(this.requests.length, 1, 'requested another segment');
});

QUnit.test('does not check the buffer while paused', function() {
  let sourceBuffer;

  loader.playlist(playlistWithDuration(90));
  loader.mimeType(this.mimeType);
  loader.load();
  sourceBuffer = mediaSource.sourceBuffers[0];

  loader.pause();
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.trigger('updateend');

  this.clock.tick(10 * 1000);
  QUnit.equal(this.requests.length, 0, 'did not make a request');
});

QUnit.test('calculates bandwidth after downloading a segment', function() {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();

  // some time passes and a response is received
  this.clock.tick(100);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  QUnit.equal(loader.bandwidth, (10 / 100) * 8 * 1000, 'calculated bandwidth');
  QUnit.equal(loader.roundTrip, 100, 'saves request round trip time');
  QUnit.equal(loader.bytesReceived, 10, 'saves bytes received');
});

QUnit.test('segment request timeouts reset bandwidth', function() {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();

  // a lot of time passes so the request times out
  this.requests[0].timedout = true;
  this.clock.tick(100 * 1000);

  QUnit.equal(loader.bandwidth, 1, 'reset bandwidth');
  QUnit.ok(isNaN(loader.roundTrip), 'reset round trip time');
});

QUnit.test('appending a segment triggers progress', function() {
  let progresses = 0;

  loader.on('progress', function() {
    progresses++;
  });
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();

  // some time passes and a response is received
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].trigger('updateend');

  QUnit.equal(progresses, 1, 'fired progress');
});

QUnit.test('only requests one segment at a time', function() {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();

  // a bunch of time passes without recieving a response
  this.clock.tick(20 * 1000);
  QUnit.equal(this.requests.length, 1, 'only one request was made');
});

QUnit.test('only appends one segment at a time', function() {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();

  // some time passes and a segment is received
  this.clock.tick(100);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  // a lot of time goes by without "updateend"
  this.clock.tick(20 * 1000);

  QUnit.equal(mediaSource.sourceBuffers[0].updates_.filter(
    update => update.append).length, 1, 'only one append');
  QUnit.equal(this.requests.length, 0, 'only made one request');
});

QUnit.test('adjusts the playlist offset if no buffering progress is made', function() {
  let sourceBuffer;
  let playlist;

  playlist = playlistWithDuration(40);
  playlist.endList = false;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  sourceBuffer = mediaSource.sourceBuffers[0];

  // buffer some content and switch playlists on progress
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  loader.on('progress', function f() {
    loader.off('progress', f);
    // switch playlists
    playlist = playlistWithDuration(40);
    playlist.uri = 'alternate.m3u8';
    playlist.endList = false;
    loader.playlist(playlist);
  });
  sourceBuffer.buffered = videojs.createTimeRanges([[0, 5]]);
  sourceBuffer.trigger('updateend');

  // the next segment doesn't increase the buffer at all
  QUnit.equal(this.requests[0].url, '0.ts', 'requested the same segment');
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.trigger('updateend');

  // so the loader should try the next segment
  QUnit.equal(this.requests[0].url, '1.ts', 'moved ahead a segment');
});

QUnit.test('never attempt to load a segment that ' +
           'is greater than 90% buffered', function() {
  let sourceBuffer;
  let playlist;

  playlist = playlistWithDuration(40);
  playlist.endList = false;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  sourceBuffer = mediaSource.sourceBuffers[0];

  // buffer some content and switch playlists on progress
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  loader.on('progress', function f() {
    loader.off('progress', f);
    // switch playlists
    playlist = playlistWithDuration(40);
    playlist.uri = 'alternate.m3u8';
    playlist.endList = false;
    loader.playlist(playlist);
  });
  sourceBuffer.buffered = videojs.createTimeRanges([[0, 9.2]]);
  sourceBuffer.trigger('updateend');

  // the next segment doesn't increase the buffer at all
  QUnit.equal(this.requests[0].url, '1.ts', 'requested the next segment');
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.trigger('updateend');

  // so the loader should try the next segment
  QUnit.equal(this.requests[0].url, '1.ts', 'moved ahead a segment');
});

QUnit.test('adjusts the playlist offset if no buffering progress is made', function() {
  let sourceBuffer;
  let playlist;

  playlist = playlistWithDuration(40);
  playlist.endList = false;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  sourceBuffer = mediaSource.sourceBuffers[0];

  // buffer some content and switch playlists on progress
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  loader.on('progress', function f() {
    loader.off('progress', f);
    // switch playlists
    playlist = playlistWithDuration(40);
    playlist.uri = 'alternate.m3u8';
    playlist.endList = false;
    loader.playlist(playlist);
  });
  sourceBuffer.buffered = videojs.createTimeRanges([[0, 5]]);
  sourceBuffer.trigger('updateend');

  // the next segment doesn't increase the buffer at all
  QUnit.equal(this.requests[0].url, '0.ts', 'requested the same segment');
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.trigger('updateend');

  // so the loader should try the next segment
  QUnit.equal(this.requests[0].url, '1.ts', 'moved ahead a segment');
});

QUnit.test('cancels outstanding requests on abort', function() {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.xhr_.segmentXhr.onreadystatechange = function() {
    throw new Error('onreadystatechange should not be called');
  };

  loader.abort();
  QUnit.ok(this.requests[0].aborted, 'aborted the first request');
  QUnit.equal(this.requests.length, 2, 'started a new request');
  QUnit.equal(loader.state, 'WAITING', 'back to the waiting state');
});

QUnit.test('abort does not cancel segment processing in progress', function() {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  loader.abort();
  QUnit.equal(loader.state, 'APPENDING', 'still appending');
});

QUnit.test('sets the timestampOffset on timeline change', function() {
  let playlist = playlistWithDuration(40);

  playlist.discontinuityStarts = [1];
  playlist.segments[1].timeline = 1;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();

  // segment 0
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([[0, 10]]);
  mediaSource.sourceBuffers[0].trigger('updateend');

  // segment 1, discontinuity
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  QUnit.equal(mediaSource.sourceBuffers[0].timestampOffset, 10, 'set timestampOffset');
});

QUnit.test('tracks segment end times as they are buffered', function() {
  let playlist = playlistWithDuration(20);

  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([
    [0, 9.5]
  ]);
  mediaSource.sourceBuffers[0].trigger('updateend');
  QUnit.equal(playlist.segments[0].end, 9.5, 'updated duration');
});

QUnit.test('segment 404s should trigger an error', function() {
  let errors = [];

  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(404, null, '');

  QUnit.equal(errors.length, 1, 'triggered an error');
  QUnit.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  QUnit.ok(loader.error().xhr, 'included the request object');
  QUnit.ok(loader.paused(), 'paused the loader');
  QUnit.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.test('segment 5xx status codes trigger an error', function() {
  let errors = [];

  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(500, null, '');

  QUnit.equal(errors.length, 1, 'triggered an error');
  QUnit.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  QUnit.ok(loader.error().xhr, 'included the request object');
  QUnit.ok(loader.paused(), 'paused the loader');
  QUnit.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.test('fires ended at the end of a playlist', function() {
  let endOfStreams = 0;

  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.mediaSource_ = {
    readyState: 'open',
    sourceBuffers: mediaSource.sourceBuffers,
    endOfStream() {
      endOfStreams++;
    }
  };

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([[0, 10]]);
  mediaSource.sourceBuffers[0].trigger('updateend');
  QUnit.equal(endOfStreams, 1, 'triggered ended');
});

QUnit.test('live playlists do not trigger ended', function() {
  let endOfStreams = 0;
  let playlist;

  playlist = playlistWithDuration(10);
  playlist.endList = false;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  loader.mediaSource_ = {
    readyState: 'open',
    sourceBuffers: mediaSource.sourceBuffers,
    endOfStream() {
      endOfStreams++;
    }
  };

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([[0, 10]]);
  mediaSource.sourceBuffers[0].trigger('updateend');
  QUnit.equal(endOfStreams, 0, 'did not trigger ended');
});

QUnit.test('respects the global withCredentials option', function() {
  let hlsOptions = videojs.options.hls;

  videojs.options.hls = {
    withCredentials: true
  };
  loader = new SegmentLoader({
    hls: this.fakeHls,
    currentTime() {
      return currentTime;
    },
    seekable: () => this.seekable,
    mediaSource
  });
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  QUnit.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  QUnit.ok(this.requests[0].withCredentials, 'key request used withCredentials');
  QUnit.equal(this.requests[1].url, '0.ts', 'requested the first segment');
  QUnit.ok(this.requests[1].withCredentials, 'segment request used withCredentials');
  videojs.options.hls = hlsOptions;
});

QUnit.test('respects the withCredentials option', function() {
  loader = new SegmentLoader({
    hls: this.fakeHls,
    currentTime() {
      return currentTime;
    },
    seekable: () => this.seekable,
    mediaSource,
    withCredentials: true
  });
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  QUnit.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  QUnit.ok(this.requests[0].withCredentials, 'key request used withCredentials');
  QUnit.equal(this.requests[1].url, '0.ts', 'requested the first segment');
  QUnit.ok(this.requests[1].withCredentials, 'segment request used withCredentials');
});

QUnit.test('the withCredentials option overrides the global', function() {
  let hlsOptions = videojs.options.hls;

  videojs.options.hls = {
    withCredentials: true
  };
  loader = new SegmentLoader({
    hls: this.fakeHls,
    currentTime() {
      return currentTime;
    },
    mediaSource,
    seekable: () => this.seekable,
    withCredentials: false
  });
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  QUnit.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  QUnit.ok(!this.requests[0].withCredentials, 'overrode key request withCredentials');
  QUnit.equal(this.requests[1].url, '0.ts', 'requested the first segment');
  QUnit.ok(!this.requests[1].withCredentials, 'overrode segment request withCredentials');
  videojs.options.hls = hlsOptions;
});

QUnit.test('remains ready if there are no segments', function() {
  loader.playlist(playlistWithDuration(0));
  loader.mimeType(this.mimeType);
  loader.load();
  QUnit.equal(loader.state, 'READY', 'in the ready state');
});

QUnit.test('dispose cleans up outstanding work', function() {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();

  loader.dispose();
  QUnit.ok(this.requests[0].aborted, 'aborted segment request');
  QUnit.equal(this.requests.length, 1, 'did not open another request');
  mediaSource.sourceBuffers.forEach((sourceBuffer, i) => {
    let lastOperation = sourceBuffer.updates_.slice(-1)[0];

    QUnit.ok(lastOperation.abort, 'aborted source buffer ' + i);
  });
});

// ----------
// Decryption
// ----------

QUnit.test('calling load with an encrypted segment requests key and segment', function() {
  QUnit.equal(loader.state, 'INIT', 'starts in the init state');
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  QUnit.equal(loader.state, 'INIT', 'starts in the init state');
  QUnit.ok(loader.paused(), 'starts paused');

  loader.mimeType(this.mimeType);
  loader.load();
  QUnit.equal(loader.state, 'WAITING', 'moves to the ready state');
  QUnit.ok(!loader.paused(), 'loading is not paused');
  QUnit.equal(this.requests.length, 2, 'requested a segment and key');
  QUnit.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  QUnit.equal(this.requests[1].url, '0.ts', 'requested the first segment');
});

QUnit.test('cancels outstanding key request on abort', function() {
  loader.playlist(playlistWithDuration(20, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.xhr_.keyXhr.onreadystatechange = function() {
    throw new Error('onreadystatechange should not be called');
  };

  QUnit.equal(this.requests.length, 2, 'requested a segment and key');
  loader.abort();
  QUnit.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  QUnit.ok(this.requests[0].aborted, 'aborted the first key request');
  QUnit.equal(this.requests.length, 4, 'started a new request');
  QUnit.equal(loader.state, 'WAITING', 'back to the waiting state');
});

QUnit.test('dispose cleans up key requests for encrypted segments', function() {
  loader.playlist(playlistWithDuration(20, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  loader.dispose();
  QUnit.equal(this.requests.length, 2, 'requested a segment and key');
  QUnit.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  QUnit.ok(this.requests[0].aborted, 'aborted the first segment\s key request');
  QUnit.equal(this.requests.length, 2, 'did not open another request');
});

QUnit.test('key 404s should trigger an error', function() {
  let errors = [];

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(404, null, '');

  QUnit.equal(errors.length, 1, 'triggered an error');
  QUnit.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  QUnit.equal(loader.error().message, 'HLS key request error at URL: 0-key.php',
        'receieved a key error message');
  QUnit.ok(loader.error().xhr, 'included the request object');
  QUnit.ok(loader.paused(), 'paused the loader');
  QUnit.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.test('key 5xx status codes trigger an error', function() {
  let errors = [];

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(500, null, '');

  QUnit.equal(errors.length, 1, 'triggered an error');
  QUnit.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  QUnit.equal(loader.error().message, 'HLS key request error at URL: 0-key.php',
        'receieved a key error message');
  QUnit.ok(loader.error().xhr, 'included the request object');
  QUnit.ok(loader.paused(), 'paused the loader');
  QUnit.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.test('the key is saved to the segment in the correct format', function() {
  let keyRequest;
  let segmentRequest;
  let segment;
  let segmentInfo;

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  // stop processing so we can examine segment info
  loader.processResponse_ = function() {};

  keyRequest = this.requests.shift();
  keyRequest.response = new Uint32Array([0, 1, 2, 3]).buffer;
  keyRequest.respond(200, null, '');

  segmentRequest = this.requests.shift();
  segmentRequest.response = new Uint8Array(10).buffer;
  segmentRequest.respond(200, null, '');

  segmentInfo = loader.pendingSegment_;
  segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

  QUnit.deepEqual(segment.key.bytes,
                  new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
                  'passed the specified segment key');
});

QUnit.test('supplies media sequence of current segment as the IV by default, if no IV ' +
           'is specified',
function() {
  let keyRequest;
  let segmentRequest;
  let segment;
  let segmentInfo;

  loader.playlist(playlistWithDuration(10, {isEncrypted: true, mediaSequence: 5}));
  loader.mimeType(this.mimeType);
  loader.load();

  // stop processing so we can examine segment info
  loader.processResponse_ = function() {};

  keyRequest = this.requests.shift();
  keyRequest.response = new Uint32Array([0, 0, 0, 0]).buffer;
  keyRequest.respond(200, null, '');

  segmentRequest = this.requests.shift();
  segmentRequest.response = new Uint8Array(10).buffer;
  segmentRequest.respond(200, null, '');

  segmentInfo = loader.pendingSegment_;
  segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

  QUnit.deepEqual(segment.key.iv, new Uint32Array([0, 0, 0, 5]),
                  'the IV for the segment is the media sequence');
});

QUnit.test('segment with key has decrypted bytes appended during processing', function() {
  let keyRequest;
  let segmentRequest;

  // stop processing so we can examine segment info
  loader.handleSegment_ = function() {};

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  segmentRequest = this.requests.pop();
  segmentRequest.response = new Uint8Array(8).buffer;
  segmentRequest.respond(200, null, '');
  QUnit.ok(loader.pendingSegment_.encryptedBytes, 'encrypted bytes in segment');
  QUnit.ok(!loader.pendingSegment_.bytes, 'no decrypted bytes in segment');

  keyRequest = this.requests.shift();
  keyRequest.response = new Uint32Array([0, 0, 0, 0]).buffer;
  keyRequest.respond(200, null, '');

  // Allow the decrypter to decrypt
  this.clock.tick(1);
  // Allow the decrypter's async stream to run the callback
  this.clock.tick(1);
  QUnit.ok(loader.pendingSegment_.bytes, 'decrypted bytes in segment');
});

QUnit.test('calling load with an encrypted segment waits for both key and segment ' +
           'before processing', function() {
  let keyRequest;
  let segmentRequest;

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  QUnit.equal(loader.state, 'WAITING', 'moves to waiting state');
  QUnit.equal(this.requests.length, 2, 'requested a segment and key');
  QUnit.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  QUnit.equal(this.requests[1].url, '0.ts', 'requested the first segment');
  // respond to the segment first
  segmentRequest = this.requests.pop();
  segmentRequest.response = new Uint8Array(10).buffer;
  segmentRequest.respond(200, null, '');
  QUnit.equal(loader.state, 'WAITING', 'still in waiting state');
  // then respond to the key
  keyRequest = this.requests.shift();
  keyRequest.response = new Uint32Array([0, 0, 0, 0]).buffer;
  keyRequest.respond(200, null, '');
  QUnit.equal(loader.state, 'DECRYPTING', 'moves to decrypting state');
});

QUnit.test('key request timeouts reset bandwidth', function() {
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  QUnit.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  QUnit.equal(this.requests[1].url, '0.ts', 'requested the first segment');
  // a lot of time passes so the request times out
  this.requests[0].timedout = true;
  this.clock.tick(100 * 1000);

  QUnit.equal(loader.bandwidth, 1, 'reset bandwidth');
  QUnit.ok(isNaN(loader.roundTrip), 'reset round trip time');
});

QUnit.module('Segment Loading Calculation', {
  beforeEach() {
    this.env = useFakeEnvironment();
    this.mse = useFakeMediaSource();
    this.hasPlayed = true;

    currentTime = 0;
    loader = new SegmentLoader({
      currentTime() {
        return currentTime;
      },
      mediaSource: new videojs.MediaSource(),
      hasPlayed: () => this.hasPlayed
    });
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
  }
});

QUnit.test('requests the first segment with an empty buffer', function() {
  loader.mimeType(this.mimeType);

  let segmentInfo = loader.checkBuffer_(videojs.createTimeRanges(),
                                        playlistWithDuration(20),
                                        0);

  QUnit.ok(segmentInfo, 'generated a request');
  QUnit.equal(segmentInfo.uri, '0.ts', 'requested the first segment');
});

QUnit.test('no request if video not played and 1 segment is buffered', function() {
  this.hasPlayed = false;
  loader.mimeType(this.mimeType);

  let segmentInfo = loader.checkBuffer_(videojs.createTimeRanges([[0, 1]]),
                                        playlistWithDuration(20),
                                        0);

  QUnit.ok(!segmentInfo, 'no request generated');

});

QUnit.test('does not download the next segment if the buffer is full', function() {
  let buffered;
  let segmentInfo;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([
    [0, 15 + GOAL_BUFFER_LENGTH]
  ]);
  segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(30), 15);

  QUnit.ok(!segmentInfo, 'no segment request generated');
});

QUnit.test('downloads the next segment if the buffer is getting low', function() {
  let buffered;
  let segmentInfo;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([[0, 19.999]]);
  segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(30), 15);

  QUnit.ok(segmentInfo, 'made a request');
  QUnit.equal(segmentInfo.uri, '2.ts', 'requested the third segment');
});

QUnit.test('buffers based on the correct TimeRange if multiple ranges exist', function() {
  let buffered;
  let segmentInfo;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([[0, 10], [20, 30]]);
  segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(40), 8);

  QUnit.ok(segmentInfo, 'made a request');
  QUnit.equal(segmentInfo.uri, '1.ts', 'requested the second segment');

  segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(40), 20);
  QUnit.ok(segmentInfo, 'made a request');
  QUnit.equal(segmentInfo.uri, '3.ts', 'requested the fourth segment');
});

QUnit.test('stops downloading segments at the end of the playlist', function() {
  let buffered;
  let segmentInfo;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([[0, 60]]);
  segmentInfo = loader.checkBuffer_(buffered, playlistWithDuration(60), 0);

  QUnit.ok(!segmentInfo, 'no request was made');
});

QUnit.test('stops downloading segments if buffered past reported end of the playlist',
function() {
  let buffered;
  let segmentInfo;
  let playlist;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([[0, 59.9]]);
  playlist = playlistWithDuration(60);
  playlist.segments[playlist.segments.length - 1].end = 59.9;
  segmentInfo = loader.checkBuffer_(buffered, playlist, 50);

  QUnit.ok(!segmentInfo, 'no request was made');
});

QUnit.test('calculates timestampOffset for discontinuities', function() {
  let segmentInfo;
  let playlist;

  loader.mimeType(this.mimeType);

  playlist = playlistWithDuration(60);
  playlist.segments[3].end = 37.9;
  playlist.discontinuityStarts = [4];
  playlist.segments[4].discontinuity = true;
  playlist.segments[4].timeline = 1;

  segmentInfo = loader.checkBuffer_(videojs.createTimeRanges([[0, 37.9]]), playlist, 36);
  QUnit.equal(segmentInfo.timestampOffset, 37.9, 'placed the discontinuous segment');
});

QUnit.test('adjusts calculations based on expired time', function() {
  let buffered;
  let playlist;
  let segmentInfo;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([[0, 30]]);
  playlist = playlistWithDuration(50);

  loader.expired(10);

  segmentInfo = loader.checkBuffer_(buffered,
                                    playlist,
                                    40 - GOAL_BUFFER_LENGTH);

  QUnit.ok(segmentInfo, 'fetched a segment');
  QUnit.equal(segmentInfo.uri, '2.ts', 'accounted for expired time');
});

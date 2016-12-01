import QUnit from 'qunit';
import SegmentLoader from '../src/segment-loader';
import videojs from 'video.js';
import xhrFactory from '../src/xhr';
import mp4probe from 'mux.js/lib/mp4/probe';
import Config from '../src/config';
import {
  playlistWithDuration,
  useFakeEnvironment,
  useFakeMediaSource
} from './test-helpers.js';
import sinon from 'sinon';
import SyncController from '../src/sync-controller';

let currentTime;
let mediaSource;
let loader;
let syncController;

QUnit.module('Segment Loader', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
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

    this.timescale = sinon.stub(mp4probe, 'timescale');
    this.startTime = sinon.stub(mp4probe, 'startTime');

    currentTime = 0;
    mediaSource = new videojs.MediaSource();
    mediaSource.trigger('sourceopen');
    syncController = new SyncController();
    loader = new SegmentLoader({
      hls: this.fakeHls,
      currentTime() {
        return currentTime;
      },
      seekable: () => this.seekable,
      seeking: () => false,
      hasPlayed: () => true,
      mediaSource,
      syncController
    });
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
    this.timescale.restore();
    this.startTime.restore();
  }
});

QUnit.test('fails without required initialization options', function(assert) {
  /* eslint-disable no-new */
  assert.throws(function() {
    new SegmentLoader();
  }, 'requires options');
  assert.throws(function() {
    new SegmentLoader({});
  }, 'requires a currentTime callback');
  assert.throws(function() {
    new SegmentLoader({
      currentTime() {}
    });
  }, 'requires a media source');
  /* eslint-enable */
});

QUnit.test('load waits until a playlist and mime type are specified to proceed',
function(assert) {
  loader.load();
  assert.equal(loader.state, 'INIT', 'waiting in init');
  assert.equal(loader.paused(), false, 'not paused');

  loader.playlist(playlistWithDuration(10));
  assert.equal(this.requests.length, 0, 'have not made a request yet');
  loader.mimeType(this.mimeType);

  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(loader.state, 'WAITING', 'transitioned states');
});

QUnit.test('calling mime type and load begins buffering', function(assert) {
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  loader.playlist(playlistWithDuration(10));
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  assert.ok(loader.paused(), 'starts paused');

  loader.mimeType(this.mimeType);
  assert.equal(loader.state, 'INIT', 'still in the init state');
  loader.load();

  assert.equal(loader.state, 'WAITING', 'moves to the ready state');
  assert.ok(!loader.paused(), 'loading is not paused');
  assert.equal(this.requests.length, 1, 'requested a segment');
});

QUnit.test('calling load is idempotent', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  assert.equal(loader.state, 'WAITING', 'moves to the ready state');
  assert.equal(this.requests.length, 1, 'made one request');

  loader.load();
  assert.equal(loader.state, 'WAITING', 'still in the ready state');
  assert.equal(this.requests.length, 1, 'still one request');

  // some time passes and a response is received
  this.clock.tick(100);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  loader.load();
  assert.equal(this.requests.length, 0, 'load has no effect');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaTransferDuration, 100, '100 ms (clock above)');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('calling load should unpause', function(assert) {
  let sourceBuffer;

  loader.playlist(playlistWithDuration(20));
  loader.pause();

  loader.mimeType(this.mimeType);

  loader.load();
  assert.equal(loader.paused(), false, 'loading unpauses');

  loader.pause();
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.equal(loader.paused(), true, 'stayed paused');
  loader.load();
  assert.equal(loader.paused(), false, 'unpaused during processing');

  loader.pause();
  sourceBuffer = mediaSource.sourceBuffers[0];
  sourceBuffer.trigger('updateend');
  assert.equal(loader.state, 'READY', 'finished processing');
  assert.ok(loader.paused(), 'stayed paused');

  loader.load();
  assert.equal(loader.paused(), false, 'unpaused');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaTransferDuration, 1, '1 ms (clock above)');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('regularly checks the buffer while unpaused', function(assert) {
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
    0, Config.GOAL_BUFFER_LENGTH
  ]]);
  sourceBuffer.trigger('updateend');
  assert.equal(this.requests.length, 0, 'no outstanding requests');

  // play some video to drain the buffer
  currentTime = Config.GOAL_BUFFER_LENGTH;
  this.clock.tick(10 * 1000);
  assert.equal(this.requests.length, 1, 'requested another segment');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaTransferDuration, 1, '1 ms (clock above)');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('does not check the buffer while paused', function(assert) {
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
  assert.equal(this.requests.length, 0, 'did not make a request');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaTransferDuration, 1, '1 ms (clock above)');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('calculates bandwidth after downloading a segment', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();

  // some time passes and a response is received
  this.clock.tick(100);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.equal(loader.bandwidth, (10 / 100) * 8 * 1000, 'calculated bandwidth');
  assert.equal(loader.roundTrip, 100, 'saves request round trip time');

  // TODO: Bandwidth Stat will be stale??
  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaTransferDuration, 100, '100 ms (clock above)');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('segment request timeouts reset bandwidth', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();

  // a lot of time passes so the request times out
  this.requests[0].timedout = true;
  this.clock.tick(100 * 1000);

  assert.equal(loader.bandwidth, 1, 'reset bandwidth');
  assert.ok(isNaN(loader.roundTrip), 'reset round trip time');
});

QUnit.test('updates timestamps when segments do not start at zero', function(assert) {
  let playlist = playlistWithDuration(10);

  playlist.segments.forEach((segment) => {
    segment.map = {
      resolvedUri: 'init.mp4',
      bytes: new Uint8Array(10)
    };
  });
  loader.playlist(playlist);
  loader.mimeType('video/mp4');
  loader.load();

  this.startTime.returns(11);

  this.clock.tick(100);
  // init
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  // segment
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.equal(loader.sourceUpdater_.timestampOffset(), -11, 'set timestampOffset');
});

QUnit.test('appending a segment triggers progress', function(assert) {
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

  assert.equal(progresses, 1, 'fired progress');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('only requests one segment at a time', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();

  // a bunch of time passes without recieving a response
  this.clock.tick(20 * 1000);
  assert.equal(this.requests.length, 1, 'only one request was made');
});

QUnit.test('only appends one segment at a time', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();

  // some time passes and a segment is received
  this.clock.tick(100);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  // a lot of time goes by without "updateend"
  this.clock.tick(20 * 1000);

  assert.equal(mediaSource.sourceBuffers[0].updates_.filter(
    update => update.append).length, 1, 'only one append');
  assert.equal(this.requests.length, 0, 'only made one request');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaTransferDuration, 100, '100 ms (clock above)');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('adjusts the playlist offset if no buffering progress is made', function(assert) {
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
  assert.equal(this.requests[0].url, '0.ts', 'requested the same segment');
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.trigger('updateend');

  // so the loader should try the next segment
  assert.equal(this.requests[0].url, '1.ts', 'moved ahead a segment');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 20, '20 bytes');
  assert.equal(loader.mediaTransferDuration, 2, '2 ms (clocks above)');
  assert.equal(loader.mediaRequests, 2, '2 requests');
});

QUnit.skip('adjusts the playlist offset even when segment.end is set if no' +
           ' buffering progress is made', function(assert) {
  let sourceBuffer;
  let playlist;

  let inspectTs = loader.syncController_.probeTsSegment_;

  loader.syncController_.probeTsSegment_ = function() {
    return { start: 0, end: 5 };
  };

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
  sourceBuffer.buffered = videojs.createTimeRanges([[0, 5]]);
  loader.one('progress', function f() {
    assert.equal(playlist.segments[0].end, 5, 'segment.end was set based on the buffer');
    playlist.segments[0].end = 10;
    loader.syncController_.probeTsSegment_ = inspectTs;
  });

  sourceBuffer.trigger('updateend');

  // the next segment doesn't increase the buffer at all
  assert.equal(this.requests[0].url, '0.ts', 'requested the same segment');
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.trigger('updateend');

  // so the loader should try the next segment
  assert.equal(this.requests[0].url, '1.ts', 'moved ahead a segment');
});

QUnit.skip('adjusts the playlist offset if no buffering progress is made after ' +
           'several consecutive attempts', function(assert) {
  let sourceBuffer;
  let playlist;
  let errors = 0;

  loader.on('error', () => {
    errors++;
  });

  playlist = playlistWithDuration(120);
  playlist.endList = false;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  sourceBuffer = mediaSource.sourceBuffers[0];

  // buffer some content
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.buffered = videojs.createTimeRanges([[0, 10]]);
  sourceBuffer.trigger('updateend');

  for (let i = 1; i <= 5; i++) {
    // the next segment doesn't increase the buffer at all
    assert.equal(this.requests[0].url, (i + '.ts'), 'requested the next segment');
    this.clock.tick(1);
    this.requests[0].response = new Uint8Array(10).buffer;
    this.requests.shift().respond(200, null, '');
    sourceBuffer.trigger('updateend');
  }
  this.clock.tick(1);
  assert.equal(this.requests.length, 0, 'no more requests are made');
});

QUnit.test('downloads init segments if specified', function(assert) {
  let playlist = playlistWithDuration(20);
  let map = {
    resolvedUri: 'main.mp4',
    byterange: {
      length: 20,
      offset: 0
    }
  };

  playlist.segments[0].map = map;
  playlist.segments[1].map = map;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);

  loader.load();
  let sourceBuffer = mediaSource.sourceBuffers[0];

  assert.equal(this.requests.length, 2, 'made requests');

  // init segment response
  this.clock.tick(1);
  assert.equal(this.requests[0].url, 'main.mp4', 'requested the init segment');
  this.requests[0].response = new Uint8Array(20).buffer;
  this.requests.shift().respond(200, null, '');
  // 0.ts response
  this.clock.tick(1);
  assert.equal(this.requests[0].url, '0.ts',
              'requested the segment');
  this.requests[0].response = new Uint8Array(20).buffer;
  this.requests.shift().respond(200, null, '');

  // append the init segment
  sourceBuffer.buffered = videojs.createTimeRanges([]);
  sourceBuffer.trigger('updateend');
  // append the segment
  sourceBuffer.buffered = videojs.createTimeRanges([[0, 10]]);
  sourceBuffer.trigger('updateend');

  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(this.requests[0].url, '1.ts',
              'did not re-request the init segment');
});

QUnit.test('detects init segment changes and downloads it', function(assert) {
  let playlist = playlistWithDuration(20);

  playlist.segments[0].map = {
    resolvedUri: 'init0.mp4',
    byterange: {
      length: 20,
      offset: 0
    }
  };
  playlist.segments[1].map = {
    resolvedUri: 'init0.mp4',
    byterange: {
      length: 20,
      offset: 20
    }
  };
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);

  loader.load();
  let sourceBuffer = mediaSource.sourceBuffers[0];

  assert.equal(this.requests.length, 2, 'made requests');

  // init segment response
  this.clock.tick(1);
  assert.equal(this.requests[0].url, 'init0.mp4', 'requested the init segment');
  assert.equal(this.requests[0].headers.Range, 'bytes=0-19',
              'requested the init segment byte range');
  this.requests[0].response = new Uint8Array(20).buffer;
  this.requests.shift().respond(200, null, '');
  // 0.ts response
  this.clock.tick(1);
  assert.equal(this.requests[0].url, '0.ts',
              'requested the segment');
  this.requests[0].response = new Uint8Array(20).buffer;
  this.requests.shift().respond(200, null, '');

  // append the init segment
  sourceBuffer.buffered = videojs.createTimeRanges([]);
  sourceBuffer.trigger('updateend');
  // append the segment
  sourceBuffer.buffered = videojs.createTimeRanges([[0, 10]]);
  sourceBuffer.trigger('updateend');

  assert.equal(this.requests.length, 2, 'made requests');
  assert.equal(this.requests[0].url, 'init0.mp4', 'requested the init segment');
  assert.equal(this.requests[0].headers.Range, 'bytes=20-39',
              'requested the init segment byte range');
  assert.equal(this.requests[1].url, '1.ts',
              'did not re-request the init segment');
});

QUnit.test('cancels outstanding requests on abort', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.xhr_.segmentXhr.onreadystatechange = function() {
    throw new Error('onreadystatechange should not be called');
  };

  loader.abort();
  assert.ok(this.requests[0].aborted, 'aborted the first request');
  assert.equal(this.requests.length, 2, 'started a new request');
  assert.equal(loader.state, 'WAITING', 'back to the waiting state');
});

QUnit.test('abort does not cancel segment processing in progress', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  loader.abort();
  assert.equal(loader.state, 'APPENDING', 'still appending');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('sets the timestampOffset on timeline change', function(assert) {
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
  assert.equal(mediaSource.sourceBuffers[0].timestampOffset, 10, 'set timestampOffset');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 20, '20 bytes');
  assert.equal(loader.mediaRequests, 2, '2 requests');
});

QUnit.test('tracks segment end times as they are buffered', function(assert) {
  let playlist = playlistWithDuration(20);

  loader.syncController_.probeTsSegment_ = function(segmentInfo) {
    return { start: 0, end: 9.5 };
  };

  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  mediaSource.sourceBuffers[0].trigger('updateend');
  assert.equal(playlist.segments[0].end, 9.5, 'updated duration');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('segment 404s should trigger an error', function(assert) {
  let errors = [];

  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(404, null, '');

  assert.equal(errors.length, 1, 'triggered an error');
  assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  assert.ok(loader.error().xhr, 'included the request object');
  assert.ok(loader.paused(), 'paused the loader');
  assert.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.test('segment 5xx status codes trigger an error', function(assert) {
  let errors = [];

  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(500, null, '');

  assert.equal(errors.length, 1, 'triggered an error');
  assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  assert.ok(loader.error().xhr, 'included the request object');
  assert.ok(loader.paused(), 'paused the loader');
  assert.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.test('fires ended at the end of a playlist', function(assert) {
  let endOfStreams = 0;

  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.mediaSource_ = {
    readyState: 'open',
    sourceBuffers: mediaSource.sourceBuffers,
    endOfStream() {
      endOfStreams++;
      this.readyState = 'ended';
    }
  };

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([[0, 10]]);
  mediaSource.sourceBuffers[0].trigger('updateend');
  assert.equal(endOfStreams, 1, 'triggered ended');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('live playlists do not trigger ended', function(assert) {
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
  assert.equal(endOfStreams, 0, 'did not trigger ended');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('remains ready if there are no segments', function(assert) {
  loader.playlist(playlistWithDuration(0));
  loader.mimeType(this.mimeType);
  loader.load();
  assert.equal(loader.state, 'READY', 'in the ready state');
});

QUnit.test('dispose cleans up outstanding work', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();

  loader.dispose();
  assert.ok(this.requests[0].aborted, 'aborted segment request');
  assert.equal(this.requests.length, 1, 'did not open another request');
  mediaSource.sourceBuffers.forEach((sourceBuffer, i) => {
    let lastOperation = sourceBuffer.updates_.slice(-1)[0];

    assert.ok(lastOperation.abort, 'aborted source buffer ' + i);
  });
});

// ----------
// Decryption
// ----------

QUnit.test('calling load with an encrypted segment requests key and segment', function(assert) {
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  assert.ok(loader.paused(), 'starts paused');

  loader.mimeType(this.mimeType);
  loader.load();
  assert.equal(loader.state, 'WAITING', 'moves to the ready state');
  assert.ok(!loader.paused(), 'loading is not paused');
  assert.equal(this.requests.length, 2, 'requested a segment and key');
  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.equal(this.requests[1].url, '0.ts', 'requested the first segment');
});

QUnit.test('cancels outstanding key request on abort', function(assert) {
  loader.playlist(playlistWithDuration(20, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.xhr_.keyXhr.onreadystatechange = function() {
    throw new Error('onreadystatechange should not be called');
  };

  assert.equal(this.requests.length, 2, 'requested a segment and key');
  loader.abort();
  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.ok(this.requests[0].aborted, 'aborted the first key request');
  assert.equal(this.requests.length, 4, 'started a new request');
  assert.equal(loader.state, 'WAITING', 'back to the waiting state');
});

QUnit.test('dispose cleans up key requests for encrypted segments', function(assert) {
  loader.playlist(playlistWithDuration(20, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  loader.dispose();
  assert.equal(this.requests.length, 2, 'requested a segment and key');
  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.ok(this.requests[0].aborted, 'aborted the first segment\s key request');
  assert.equal(this.requests.length, 2, 'did not open another request');
});

QUnit.test('key 404s should trigger an error', function(assert) {
  let errors = [];

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(404, null, '');

  assert.equal(errors.length, 1, 'triggered an error');
  assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  assert.equal(loader.error().message, 'HLS key request error at URL: 0-key.php',
        'receieved a key error message');
  assert.ok(loader.error().xhr, 'included the request object');
  assert.ok(loader.paused(), 'paused the loader');
  assert.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.test('key 5xx status codes trigger an error', function(assert) {
  let errors = [];

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(500, null, '');

  assert.equal(errors.length, 1, 'triggered an error');
  assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  assert.equal(loader.error().message, 'HLS key request error at URL: 0-key.php',
        'receieved a key error message');
  assert.ok(loader.error().xhr, 'included the request object');
  assert.ok(loader.paused(), 'paused the loader');
  assert.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.test('the key is saved to the segment in the correct format', function(assert) {
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

  assert.deepEqual(segment.key.bytes,
                  new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
                  'passed the specified segment key');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request was completed');
});

QUnit.test('supplies media sequence of current segment as the IV by default, if no IV ' +
           'is specified',
function(assert) {
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

  assert.deepEqual(segment.key.iv, new Uint32Array([0, 0, 0, 5]),
                  'the IV for the segment is the media sequence');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('segment with key has decrypted bytes appended during processing', function(assert) {
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
  assert.ok(loader.pendingSegment_.encryptedBytes, 'encrypted bytes in segment');
  assert.ok(!loader.pendingSegment_.bytes, 'no decrypted bytes in segment');

  keyRequest = this.requests.shift();
  keyRequest.response = new Uint32Array([0, 0, 0, 0]).buffer;
  keyRequest.respond(200, null, '');

  // Allow the decrypter to decrypt
  this.clock.tick(1);
  // Allow the decrypter's async stream to run the callback
  this.clock.tick(1);
  assert.ok(loader.pendingSegment_.bytes, 'decrypted bytes in segment');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 8, '8 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('calling load with an encrypted segment waits for both key and segment ' +
           'before processing', function(assert) {
  let keyRequest;
  let segmentRequest;

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  assert.equal(loader.state, 'WAITING', 'moves to waiting state');
  assert.equal(this.requests.length, 2, 'requested a segment and key');
  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.equal(this.requests[1].url, '0.ts', 'requested the first segment');
  // respond to the segment first
  segmentRequest = this.requests.pop();
  segmentRequest.response = new Uint8Array(10).buffer;
  segmentRequest.respond(200, null, '');
  assert.equal(loader.state, 'WAITING', 'still in waiting state');
  // then respond to the key
  keyRequest = this.requests.shift();
  keyRequest.response = new Uint32Array([0, 0, 0, 0]).buffer;
  keyRequest.respond(200, null, '');
  assert.equal(loader.state, 'DECRYPTING', 'moves to decrypting state');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('key request timeouts reset bandwidth', function(assert) {
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();

  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.equal(this.requests[1].url, '0.ts', 'requested the first segment');
  // a lot of time passes so the request times out
  this.requests[0].timedout = true;
  this.clock.tick(100 * 1000);

  assert.equal(loader.bandwidth, 1, 'reset bandwidth');
  assert.ok(isNaN(loader.roundTrip), 'reset round trip time');
});

QUnit.test('checks the goal buffer configuration every loading opportunity', function(assert) {
  let playlist = playlistWithDuration(20);
  let defaultGoal = Config.GOAL_BUFFER_LENGTH;
  let segmentInfo;

  Config.GOAL_BUFFER_LENGTH = 1;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();

  segmentInfo = loader.checkBuffer_(videojs.createTimeRanges([[0, 1]]),
                                    playlist,
                                    null,
                                    loader.hasPlayed_(),
                                    0,
                                    null);
  assert.ok(!segmentInfo, 'no request generated');
  Config.GOAL_BUFFER_LENGTH = defaultGoal;
});

QUnit.test('does not skip over segment if live playlist update occurs while processing',
function(assert) {
  let playlist = playlistWithDuration(40);

  playlist.endList = false;

  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();

  assert.equal(loader.pendingSegment_.uri, '0.ts', 'retrieving first segment');
  assert.equal(loader.state, 'WAITING', 'waiting for response');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  // playlist updated during append
  let playlistUpdated = playlistWithDuration(40);

  playlistUpdated.segments.shift();
  playlistUpdated.mediaSequence++;
  loader.playlist(playlistUpdated);
  // finish append
  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([[0, 10]]);
  mediaSource.sourceBuffers[0].trigger('updateend');

  assert.equal(loader.pendingSegment_.uri, '1.ts', 'retrieving second segment');
  assert.equal(loader.state, 'WAITING', 'waiting for response');
});

QUnit.module('Segment Loading Calculation', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.mse = useFakeMediaSource();
    this.hasPlayed = true;
    this.clock = this.env.clock;

    currentTime = 0;
    syncController = new SyncController();
    loader = new SegmentLoader({
      currentTime() {
        return currentTime;
      },
      mediaSource: new videojs.MediaSource(),
      hasPlayed: () => this.hasPlayed,
      syncController
    });
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
  }
});

QUnit.test('requests the first segment with an empty buffer', function(assert) {
  loader.mimeType(this.mimeType);

  let segmentInfo = loader.checkBuffer_(videojs.createTimeRanges(),
                                        playlistWithDuration(20),
                                        null,
                                        loader.hasPlayed_(),
                                        0,
                                        null);

  assert.ok(segmentInfo, 'generated a request');
  assert.equal(segmentInfo.uri, '0.ts', 'requested the first segment');
});

QUnit.test('no request if video not played and 1 segment is buffered', function(assert) {
  this.hasPlayed = false;
  loader.mimeType(this.mimeType);

  let segmentInfo = loader.checkBuffer_(videojs.createTimeRanges([[0, 1]]),
                                        playlistWithDuration(20),
                                        0,
                                        loader.hasPlayed_(),
                                        0,
                                        null);

  assert.ok(!segmentInfo, 'no request generated');

});

QUnit.test('does not download the next segment if the buffer is full', function(assert) {
  let buffered;
  let segmentInfo;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([
    [0, 15 + Config.GOAL_BUFFER_LENGTH]
  ]);
  segmentInfo = loader.checkBuffer_(buffered,
                                    playlistWithDuration(30),
                                    null,
                                    true,
                                    15,
                                    { segmentIndex: 0, time: 0 });

  assert.ok(!segmentInfo, 'no segment request generated');
});

QUnit.test('downloads the next segment if the buffer is getting low', function(assert) {
  let buffered;
  let segmentInfo;
  let playlist = playlistWithDuration(30);

  loader.mimeType(this.mimeType);
  loader.playlist(playlist);

  buffered = videojs.createTimeRanges([[0, 19.999]]);
  segmentInfo = loader.checkBuffer_(buffered,
                                    playlist,
                                    1,
                                    true,
                                    15,
                                    { segmentIndex: 0, time: 0 });

  assert.ok(segmentInfo, 'made a request');
  assert.equal(segmentInfo.uri, '2.ts', 'requested the third segment');
});

QUnit.skip('buffers based on the correct TimeRange if multiple ranges exist', function(assert) {
  let buffered;
  let segmentInfo;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([[0, 10], [20, 30]]);
  segmentInfo = loader.checkBuffer_(buffered,
                                    playlistWithDuration(40),
                                    0,
                                    true,
                                    8,
                                    { segmentIndex: 0, time: 0 });

  assert.ok(segmentInfo, 'made a request');
  assert.equal(segmentInfo.uri, '1.ts', 'requested the second segment');

  segmentInfo = loader.checkBuffer_(buffered,
                                    playlistWithDuration(40),
                                    null,
                                    true,
                                    20,
                                    { segmentIndex: 0, time: 0 });
  assert.ok(segmentInfo, 'made a request');
  assert.equal(segmentInfo.uri, '3.ts', 'requested the fourth segment');
});

QUnit.test('stops downloading segments at the end of the playlist', function(assert) {
  let buffered;
  let segmentInfo;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([[0, 60]]);
  segmentInfo = loader.checkBuffer_(buffered,
                                    playlistWithDuration(60),
                                    null,
                                    true,
                                    0,
                                    null);

  assert.ok(!segmentInfo, 'no request was made');
});

QUnit.test('stops downloading segments if buffered past reported end of the playlist',
function(assert) {
  let buffered;
  let segmentInfo;
  let playlist;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([[0, 59.9]]);
  playlist = playlistWithDuration(60);
  playlist.segments[playlist.segments.length - 1].end = 59.9;
  segmentInfo = loader.checkBuffer_(buffered,
                                    playlist,
                                    playlist.segments.length - 1,
                                    true,
                                    50,
                                    { segmentIndex: 0, time: 0 });

  assert.ok(!segmentInfo, 'no request was made');
});

QUnit.skip('adjusts calculations based on expired time', function(assert) {
  let buffered;
  let playlist;
  let segmentInfo;
  let segmentIndex;

  loader.mimeType(this.mimeType);

  buffered = videojs.createTimeRanges([[0, 30]]);
  playlist = playlistWithDuration(50);

  loader.expired(10);

  segmentIndex = loader.checkBuffer_(buffered,
                                    playlist,
                                    40 - Config.GOAL_BUFFER_LENGTH,
                                    true,
                                    loader.expired_,
                                    0);
  segmentInfo = playlist.segments[segmentIndex];

  assert.ok(segmentInfo, 'fetched a segment');
  assert.equal(segmentInfo.uri, '2.ts', 'accounted for expired time');
});

QUnit.test('doesn\'t allow more than one monitor buffer timer to be set', function(assert) {
  let timeoutCount = this.clock.methods.length;

  loader.mimeType(this.mimeType);
  loader.monitorBuffer_();

  assert.equal(this.clock.methods.length, timeoutCount, 'timeout count remains the same');

  loader.monitorBuffer_();

  assert.equal(this.clock.methods.length, timeoutCount, 'timeout count remains the same');

  loader.monitorBuffer_();
  loader.monitorBuffer_();

  assert.equal(this.clock.methods.length, timeoutCount, 'timeout count remains the same');
});

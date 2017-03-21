import QUnit from 'qunit';
import SegmentLoader from '../src/segment-loader';
import videojs from 'video.js';
import xhrFactory from '../src/xhr';
import mp4probe from 'mux.js/lib/mp4/probe';
import Config from '../src/config';
import {
  playlistWithDuration,
  useFakeEnvironment,
  useFakeMediaSource,
  MockTextTrack
} from './test-helpers.js';
import sinon from 'sinon';
import SyncController from '../src/sync-controller';
import Decrypter from '../src/decrypter-worker';
import worker from 'webworkify';

// noop addSegmentMetadataCue_ since most test segments dont have real timing information
// save the original function to a variable to patch it back in for the metadata cue
// specific tests
const ogAddSegmentMetadataCue_ = SegmentLoader.prototype.addSegmentMetadataCue_;

SegmentLoader.prototype.addSegmentMetadataCue_ = function() {};

let currentTime;
let mediaSource;
let loader;
let syncController;
let decrypter;
let segmentMetadataTrack;

QUnit.module('Segment Loader', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.currentTime = 0;
    this.seekable = {
      length: 0
    };
    this.mimeType = 'video/mp2t';
    this.fakeHls = {
      xhr: xhrFactory()
    };

    this.timescale = sinon.stub(mp4probe, 'timescale');
    this.startTime = sinon.stub(mp4probe, 'startTime');

    mediaSource = new videojs.MediaSource();
    mediaSource.trigger('sourceopen');
    this.syncController = new SyncController();
    decrypter = worker(Decrypter);
    segmentMetadataTrack = new MockTextTrack();
    loader = new SegmentLoader({
      hls: this.fakeHls,
      currentTime: () => this.currentTime,
      seekable: () => this.seekable,
      seeking: () => false,
      hasPlayed: () => true,
      duration: () => mediaSource.duration,
      mediaSource,
      syncController: this.syncController,
      decrypter,
      loaderType: 'main',
      segmentMetadataTrack
    });
    decrypter.onmessage = (event) => {
      loader.handleDecrypted_(event.data);
    };
  },
  afterEach() {
    this.env.restore();
    this.mse.restore();
    this.timescale.restore();
    this.startTime.restore();
    decrypter.terminate();
  }
});

QUnit.skip('fails without required initialization options', function(assert) {
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

QUnit.skip('load waits until a playlist and mime type are specified to proceed',
function(assert) {
  loader.load();

  assert.equal(loader.state, 'INIT', 'waiting in init');
  assert.equal(loader.paused(), false, 'not paused');

  loader.playlist(playlistWithDuration(10));
  assert.equal(this.requests.length, 0, 'have not made a request yet');
  loader.mimeType(this.mimeType);
  this.clock.tick(1);

  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(loader.state, 'WAITING', 'transitioned states');
});

QUnit.skip('calling mime type and load begins buffering', function(assert) {
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  loader.playlist(playlistWithDuration(10));
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  assert.ok(loader.paused(), 'starts paused');

  loader.mimeType(this.mimeType);
  assert.equal(loader.state, 'INIT', 'still in the init state');
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'moves to the ready state');
  assert.ok(!loader.paused(), 'loading is not paused');
  assert.equal(this.requests.length, 1, 'requested a segment');
});

QUnit.skip('calling load is idempotent', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

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

QUnit.skip('calling load should unpause', function(assert) {
  let sourceBuffer;

  loader.playlist(playlistWithDuration(20));
  loader.pause();

  loader.mimeType(this.mimeType);

  loader.load();
  this.clock.tick(1);
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

QUnit.skip('regularly checks the buffer while unpaused', function(assert) {
  let sourceBuffer;

  loader.playlist(playlistWithDuration(90));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

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
  this.currentTime = Config.GOAL_BUFFER_LENGTH;
  this.clock.tick(10 * 1000);
  assert.equal(this.requests.length, 1, 'requested another segment');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaTransferDuration, 1, '1 ms (clock above)');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.skip('does not check the buffer while paused', function(assert) {
  let sourceBuffer;

  loader.playlist(playlistWithDuration(90));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);
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

QUnit.skip('calculates bandwidth after downloading a segment', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

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
});

QUnit.skip('segment request timeouts reset bandwidth', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  // a lot of time passes so the request times out
  this.requests[0].timedout = true;
  this.clock.tick(100 * 1000);

  assert.equal(loader.bandwidth, 1, 'reset bandwidth');
  assert.ok(isNaN(loader.roundTrip), 'reset round trip time');
});

QUnit.skip('progress on segment requests are redispatched', function(assert) {
  let progressEvents = 0;

  loader.on('progress', function() {
    progressEvents++;
  });
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  this.requests[0].dispatchEvent({ type: 'progress', target: this.requests[0] });
  assert.equal(progressEvents, 1, 'triggered progress');
});

QUnit.test('updates timestamps when segments do not start at zero', function(assert) {
  let playlist = playlistWithDuration(10);

  playlist.segments.forEach((segment) => {
    segment.map = {
      resolvedUri: 'init.mp4',
      byterange: { length: Infinity, offset: 0 }
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

QUnit.skip('appending a segment when loader is in walk-forward mode triggers bandwidthupdate', function(assert) {
  let progresses = 0;

  loader.on('bandwidthupdate', function() {
    progresses++;
  });
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  // some time passes and a response is received
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].trigger('updateend');

  assert.equal(progresses, 0, 'no bandwidthupdate fired');

  this.clock.tick(2);
  // if mediaIndex is set, then the SegmentLoader is in walk-forward mode
  loader.mediaIndex = 1;

  // some time passes and a response is received
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].trigger('updateend');

  assert.equal(progresses, 1, 'fired bandwidthupdate');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 20, '20 bytes');
  assert.equal(loader.mediaRequests, 2, '2 request');
});

QUnit.test('only requests one segment at a time', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  // a bunch of time passes without recieving a response
  this.clock.tick(20 * 1000);
  assert.equal(this.requests.length, 1, 'only one request was made');
});

QUnit.skip('only appends one segment at a time', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

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

QUnit.skip('downloads init segments if specified', function(assert) {
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
  this.clock.tick(1);
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
  this.clock.tick(1);

  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(this.requests[0].url, '1.ts',
              'did not re-request the init segment');
});

QUnit.skip('detects init segment changes and downloads it', function(assert) {
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
  this.clock.tick(1);

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
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'made requests');
  assert.equal(this.requests[0].url, 'init0.mp4', 'requested the init segment');
  assert.equal(this.requests[0].headers.Range, 'bytes=20-39',
              'requested the init segment byte range');
  assert.equal(this.requests[1].url, '1.ts',
              'did not re-request the init segment');
});

QUnit.test('triggers syncinfoupdate before attempting a resync', function(assert) {
  let syncInfoUpdates = 0;

  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  let sourceBuffer = mediaSource.sourceBuffers[0];

  this.seekable = videojs.createTimeRanges([[0, 10]]);
  this.syncController.probeSegmentInfo = (segmentInfo) => {
    let segment = segmentInfo.segment;

    segment.end = 10;
  };
  loader.on('syncinfoupdate', () => {
    syncInfoUpdates++;
    // Simulate the seekable window updating
    this.seekable = videojs.createTimeRanges([[200, 210]]);
    // Simulate the seek to live that should happen in playback-watcher
    this.currentTime = 210;
  });

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.trigger('updateend');
  this.clock.tick(1);

  assert.equal(loader.mediaIndex, null, 'mediaIndex reset by seek to seekable');
  assert.equal(syncInfoUpdates, 1, 'syncinfoupdate was triggered');
});

QUnit.test('abort does not cancel segment processing in progress', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  loader.abort();
  this.clock.tick(1);

  assert.equal(loader.state, 'APPENDING', 'still appending');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.skip('request error increments mediaRequestsErrored stat', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  this.requests.shift().respond(404, null, '');

  // verify stats
  assert.equal(loader.mediaRequests, 1, '1 request');
  assert.equal(loader.mediaRequestsErrored, 1, '1 errored request');
});

QUnit.skip('request timeout increments mediaRequestsTimedout stat', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);
  this.requests[0].timedout = true;
  this.clock.tick(100 * 1000);

  // verify stats
  assert.equal(loader.mediaRequests, 1, '1 request');
  assert.equal(loader.mediaRequestsTimedout, 1, '1 timed-out request');
});

QUnit.skip('request abort increments mediaRequestsAborted stat', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  loader.abort();
  this.clock.tick(1);

  // verify stats
  assert.equal(loader.mediaRequests, 1, '1 request');
  assert.equal(loader.mediaRequestsAborted, 1, '1 aborted request');
});

QUnit.skip('SegmentLoader.mediaIndex is adjusted when live playlist is updated', function(assert) {
  loader.playlist(playlistWithDuration(50, {
    mediaSequence: 0,
    endList: false
  }));
  loader.mimeType(this.mimeType);
  loader.load();
  // Start at mediaIndex 2 which means that the next segment we request
  // should mediaIndex 3
  loader.mediaIndex = 2;
  this.clock.tick(1);

  assert.equal(loader.mediaIndex, 2, 'SegmentLoader.mediaIndex starts at 2');
  assert.equal(this.requests[0].url, '3.ts', 'requesting the segment at mediaIndex 3');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  this.clock.tick(1);
  mediaSource.sourceBuffers[0].trigger('updateend');

  assert.equal(loader.mediaIndex, 3, 'mediaIndex ends at 3');

  this.clock.tick(1);

  assert.equal(loader.mediaIndex, 3, 'SegmentLoader.mediaIndex starts at 3');
  assert.equal(this.requests[0].url, '4.ts', 'requesting the segment at mediaIndex 4');

  // Update the playlist shifting the mediaSequence by 2 which will result
  // in a decrement of the mediaIndex by 2 to 1
  loader.playlist(playlistWithDuration(50, {
    mediaSequence: 2,
    endList: false
  }));

  assert.equal(loader.mediaIndex, 1, 'SegmentLoader.mediaIndex is updated to 1');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  this.clock.tick(1);
  mediaSource.sourceBuffers[0].trigger('updateend');

  assert.equal(loader.mediaIndex, 2, 'SegmentLoader.mediaIndex ends at 2');
});

QUnit.skip('segmentInfo.mediaIndex is adjusted when live playlist is updated', function(assert) {
  // Setting currentTime to 31 so that we start requesting at segment #3
  this.currentTime = 31;
  loader.playlist(playlistWithDuration(50, {
    mediaSequence: 0,
    endList: false
  }));
  loader.mimeType(this.mimeType);
  loader.load();
  // Start at mediaIndex null which means that the next segment we request
  // should be based on currentTime (mediaIndex 3)
  loader.mediaIndex = null;
  loader.syncPoint_ = {
    segmentIndex: 0,
    time: 0
  };
  this.clock.tick(1);

  let segmentInfo = loader.pendingSegment_;

  assert.equal(segmentInfo.mediaIndex, 3, 'segmentInfo.mediaIndex starts at 3');
  assert.equal(this.requests[0].url, '3.ts', 'requesting the segment at mediaIndex 3');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  this.clock.tick(1);
  mediaSource.sourceBuffers[0].trigger('updateend');

  assert.equal(loader.mediaIndex, 3, 'SegmentLoader.mediaIndex ends at 3');

  loader.mediaIndex = null;
  loader.fetchAtBuffer_ = false;
  this.clock.tick(1);
  segmentInfo = loader.pendingSegment_;

  assert.equal(segmentInfo.mediaIndex, 3, 'segmentInfo.mediaIndex starts at 3');
  assert.equal(this.requests[0].url, '3.ts', 'requesting the segment at mediaIndex 3');

  // Update the playlist shifting the mediaSequence by 2 which will result
  // in a decrement of the mediaIndex by 2 to 1
  loader.playlist(playlistWithDuration(50, {
    mediaSequence: 2,
    endList: false
  }));

  assert.equal(segmentInfo.mediaIndex, 1, 'segmentInfo.mediaIndex is updated to 1');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  this.clock.tick(1);
  mediaSource.sourceBuffers[0].trigger('updateend');

  assert.equal(loader.mediaIndex, 1, 'SegmentLoader.mediaIndex ends at 1');
});

QUnit.test('sets the timestampOffset on timeline change', function(assert) {
  let playlist = playlistWithDuration(40);

  playlist.discontinuityStarts = [1];
  playlist.segments[1].timeline = 1;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  // segment 0
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([[0, 10]]);
  mediaSource.sourceBuffers[0].trigger('updateend');
  this.clock.tick(1);

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
  this.clock.tick(1);

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  mediaSource.sourceBuffers[0].trigger('updateend');
  this.clock.tick(1);

  assert.equal(playlist.segments[0].end, 9.5, 'updated duration');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('adds cues with segment information to the segment-metadata track as they are buffered',
  function(assert) {
    const track = loader.segmentMetadataTrack_;
    let playlist = playlistWithDuration(40);
    let probeResponse;
    let expectedCue;

    loader.addSegmentMetadataCue_ = ogAddSegmentMetadataCue_;
    loader.syncController_.probeTsSegment_ = function(segmentInfo) {
      return probeResponse;
    };

    loader.playlist(playlist);
    loader.mimeType(this.mimeType);
    loader.load();
    this.clock.tick(1);

    assert.ok(!track.cues.length, 'segment-metadata track empty when no segments appended');

    // Start appending some segments
    probeResponse = { start: 0, end: 9.5 };
    this.requests[0].response = new Uint8Array(10).buffer;
    this.requests.shift().respond(200, null, '');
    mediaSource.sourceBuffers[0].trigger('updateend');
    this.clock.tick(1);
    expectedCue = {
      uri: '0.ts',
      timeline: 0,
      playlist: 'playlist.m3u8',
      start: 0,
      end: 9.5
    };

    assert.equal(track.cues.length, 1, 'one cue added for segment');
    assert.deepEqual(track.cues[0].value, expectedCue,
      'added correct segment info to cue');

    probeResponse = { start: 9.56, end: 19.2 };
    this.requests[0].response = new Uint8Array(10).buffer;
    this.requests.shift().respond(200, null, '');
    mediaSource.sourceBuffers[0].trigger('updateend');
    this.clock.tick(1);
    expectedCue = {
      uri: '1.ts',
      timeline: 0,
      playlist: 'playlist.m3u8',
      start: 9.56,
      end: 19.2
    };

    assert.equal(track.cues.length, 2, 'one cue added for segment');
    assert.deepEqual(track.cues[1].value, expectedCue,
      'added correct segment info to cue');

    probeResponse = { start: 19.24, end: 28.99 };
    this.requests[0].response = new Uint8Array(10).buffer;
    this.requests.shift().respond(200, null, '');
    mediaSource.sourceBuffers[0].trigger('updateend');
    this.clock.tick(1);
    expectedCue = {
      uri: '2.ts',
      timeline: 0,
      playlist: 'playlist.m3u8',
      start: 19.24,
      end: 28.99
    };

    assert.equal(track.cues.length, 3, 'one cue added for segment');
    assert.deepEqual(track.cues[2].value, expectedCue,
      'added correct segment info to cue');

    // append overlapping segment, emmulating segment-loader fetching behavior on
    // rendtion switch
    probeResponse = { start: 19.21, end: 28.98 };
    this.requests[0].response = new Uint8Array(10).buffer;
    this.requests.shift().respond(200, null, '');
    mediaSource.sourceBuffers[0].trigger('updateend');
    expectedCue = {
      uri: '3.ts',
      timeline: 0,
      playlist: 'playlist.m3u8',
      start: 19.21,
      end: 28.98
    };

    assert.equal(track.cues.length, 3, 'overlapped cue removed, new one added');
    assert.deepEqual(track.cues[2].value, expectedCue,
      'added correct segment info to cue');

    // verify stats
    assert.equal(loader.mediaBytesTransferred, 40, '40 bytes');
    assert.equal(loader.mediaRequests, 4, '4 requests');
  });

QUnit.skip('segment 404s should trigger an error', function(assert) {
  let errors = [];

  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

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

QUnit.skip('segment 5xx status codes trigger an error', function(assert) {
  let errors = [];

  loader.playlist(playlistWithDuration(10));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

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
  this.clock.tick(1);

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
  this.clock.tick(1);

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
  this.clock.tick(1);

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
  this.clock.tick(1);

  assert.equal(endOfStreams, 0, 'did not trigger ended');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.skip('remains ready if there are no segments', function(assert) {
  loader.playlist(playlistWithDuration(0));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'READY', 'in the ready state');
});

QUnit.skip('dispose cleans up outstanding work', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

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

QUnit.skip('calling load with an encrypted segment requests key and segment', function(assert) {
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  assert.ok(loader.paused(), 'starts paused');

  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'moves to the ready state');
  assert.ok(!loader.paused(), 'loading is not paused');
  assert.equal(this.requests.length, 2, 'requested a segment and key');
  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.equal(this.requests[1].url, '0.ts', 'requested the first segment');
});

QUnit.skip('dispose cleans up key requests for encrypted segments', function(assert) {
  loader.playlist(playlistWithDuration(20, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  loader.dispose();
  assert.equal(this.requests.length, 2, 'requested a segment and key');
  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.ok(this.requests[0].aborted, 'aborted the first segment\s key request');
  assert.equal(this.requests.length, 2, 'did not open another request');
});

QUnit.skip('key 404s should trigger an error', function(assert) {
  let errors = [];

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(404, null, '');
  this.clock.tick(1);

  assert.equal(errors.length, 1, 'triggered an error');
  assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  assert.equal(loader.error().message, 'HLS request errored at URL: 0-key.php',
        'receieved a key error message');
  assert.ok(loader.error().xhr, 'included the request object');
  assert.ok(loader.paused(), 'paused the loader');
  assert.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.skip('key 5xx status codes trigger an error', function(assert) {
  let errors = [];

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  loader.on('error', function(error) {
    errors.push(error);
  });
  this.requests.shift().respond(500, null, '');

  assert.equal(errors.length, 1, 'triggered an error');
  assert.equal(loader.error().code, 2, 'triggered MEDIA_ERR_NETWORK');
  assert.equal(loader.error().message, 'HLS request errored at URL: 0-key.php',
        'receieved a key error message');
  assert.ok(loader.error().xhr, 'included the request object');
  assert.ok(loader.paused(), 'paused the loader');
  assert.equal(loader.state, 'READY', 'returned to the ready state');
});

QUnit.skip('key request timeouts reset bandwidth', function(assert) {
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.equal(this.requests[1].url, '0.ts', 'requested the first segment');
  // a lot of time passes so the request times out
  this.requests[0].timedout = true;
  this.clock.tick(100 * 1000);

  assert.equal(loader.bandwidth, 1, 'reset bandwidth');
  assert.ok(isNaN(loader.roundTrip), 'reset round trip time');
});

QUnit.skip('checks the goal buffer configuration every loading opportunity', function(assert) {
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

QUnit.skip('does not skip over segment if live playlist update occurs while processing',
function(assert) {
  let playlist = playlistWithDuration(40);

  playlist.endList = false;

  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.pendingSegment_.uri, '0.ts', 'retrieving first segment');
  assert.equal(loader.pendingSegment_.segment.uri, '0.ts', 'correct segment reference');
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
  this.clock.tick(1);

  assert.equal(loader.pendingSegment_.uri, '1.ts', 'retrieving second segment');
  assert.equal(loader.pendingSegment_.segment.uri, '1.ts', 'correct segment reference');
  assert.equal(loader.state, 'WAITING', 'waiting for response');
});

QUnit.skip('processing segment reachable even after playlist update removes it',
function(assert) {
  let playlist = playlistWithDuration(40);

  playlist.endList = false;

  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '0.ts', 'first segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '0.ts', 'correct segment reference');

  // wrap up the first request to set mediaIndex and start normal live streaming
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([[0, 10]]);
  mediaSource.sourceBuffers[0].trigger('updateend');
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.ts', 'correct segment reference');

  // playlist updated during waiting
  let playlistUpdated = playlistWithDuration(40);

  playlistUpdated.segments.shift();
  playlistUpdated.segments.shift();
  playlistUpdated.mediaSequence += 2;
  loader.playlist(playlistUpdated);

  assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment still pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.ts', 'correct segment reference');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  // we need to check for the right state, as normally handleResponse would throw an
  // error under failing cases, but sinon swallows it as part of fake XML HTTP request's
  // response
  assert.equal(loader.state, 'APPENDING', 'moved to appending state');
  assert.equal(loader.pendingSegment_.uri, '1.ts', 'still using second segment');
  assert.equal(loader.pendingSegment_.segment.uri, '1.ts', 'correct segment reference');
});

QUnit.test('saves segment info to new segment after playlist refresh',
function(assert) {
  let playlist = playlistWithDuration(40);

  playlist.endList = false;

  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '0.ts', 'first segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '0.ts', 'correct segment reference');

  // wrap up the first request to set mediaIndex and start normal live streaming
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([[0, 10]]);
  mediaSource.sourceBuffers[0].trigger('updateend');
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.ts', 'correct segment reference');

  // playlist updated during waiting
  let playlistUpdated = playlistWithDuration(40);

  playlistUpdated.segments.shift();
  playlistUpdated.mediaSequence++;
  loader.playlist(playlistUpdated);

  assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment still pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.ts', 'correct segment reference');

  // mock probeSegmentInfo as the response bytes aren't parsable (and won't provide
  // time info)
  loader.syncController_.probeSegmentInfo = (segmentInfo) => {
    segmentInfo.segment.start = 10;
    segmentInfo.segment.end = 20;
  };

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.equal(playlistUpdated.segments[0].start,
               10,
               'set start on segment of new playlist');
  assert.equal(playlistUpdated.segments[0].end,
               20,
               'set end on segment of new playlist');
  assert.ok(!playlist.segments[1].start, 'did not set start on segment of old playlist');
  assert.ok(!playlist.segments[1].end, 'did not set end on segment of old playlist');
});

QUnit.test('saves segment info to old segment after playlist refresh if segment fell off',
function(assert) {
  let playlist = playlistWithDuration(40);

  playlist.endList = false;

  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '0.ts', 'first segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '0.ts', 'correct segment reference');

  // wrap up the first request to set mediaIndex and start normal live streaming
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  mediaSource.sourceBuffers[0].buffered = videojs.createTimeRanges([[0, 10]]);
  mediaSource.sourceBuffers[0].trigger('updateend');
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.ts', 'correct segment reference');

  // playlist updated during waiting
  let playlistUpdated = playlistWithDuration(40);

  playlistUpdated.segments.shift();
  playlistUpdated.segments.shift();
  playlistUpdated.mediaSequence += 2;
  loader.playlist(playlistUpdated);

  assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment still pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.ts', 'correct segment reference');

  // mock probeSegmentInfo as the response bytes aren't parsable (and won't provide
  // time info)
  loader.syncController_.probeSegmentInfo = (segmentInfo) => {
    segmentInfo.segment.start = 10;
    segmentInfo.segment.end = 20;
  };

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.equal(playlist.segments[1].start,
               10,
               'set start on segment of old playlist');
  assert.equal(playlist.segments[1].end,
               20,
               'set end on segment of old playlist');
  assert.ok(!playlistUpdated.segments[0].start,
            'no start info for first segment of new playlist');
  assert.ok(!playlistUpdated.segments[0].end,
            'no end info for first segment of new playlist');
});

QUnit.skip('new playlist always triggers syncinfoupdate', function(assert) {
  let playlist = playlistWithDuration(100, { endList: false });
  let syncInfoUpdates = 0;

  loader.on('syncinfoupdate', () => syncInfoUpdates++);

  loader.playlist(playlist);
  loader.mimeType('video/mp4');
  loader.load();

  assert.equal(syncInfoUpdates, 1, 'first playlist triggers an update');
  loader.playlist(playlist);
  assert.equal(syncInfoUpdates, 2, 'same playlist triggers an update');
  playlist = playlistWithDuration(100, { endList: false });
  loader.playlist(playlist);
  assert.equal(syncInfoUpdates, 3, 'new playlist with same info triggers an update');
  playlist.segments[0].start = 10;
  playlist = playlistWithDuration(100, { endList: false, mediaSequence: 1 });
  loader.playlist(playlist);
  assert.equal(syncInfoUpdates,
               5,
               'new playlist after expiring segment triggers two updates');
});

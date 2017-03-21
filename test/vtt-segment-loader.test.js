import QUnit from 'qunit';
import VTTSegmentLoader from '../src/vtt-segment-loader';
import videojs from 'video.js';
import xhrFactory from '../src/xhr';
import mp4probe from 'mux.js/lib/mp4/probe';
import Config from '../src/config';
import {
  playlistWithDuration as oldPlaylistWithDuration,
  useFakeEnvironment,
  useFakeMediaSource,
  MockTextTrack
} from './test-helpers.js';
import sinon from 'sinon';
import SyncController from '../src/sync-controller';
import Decrypter from '../src/decrypter-worker';
import worker from 'webworkify';

const oldVTT = window.WebVTT;

const playlistWithDuration = function(time, conf) {
  return oldPlaylistWithDuration(time, videojs.mergeOptions({ extension: '.vtt' }, conf));
};

let currentTime;
let mediaSource;
let loader;
let syncController;
let decrypter;

QUnit.module('VTT Segment Loader', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.mse = useFakeMediaSource();
    this.currentTime = 0;
    this.seekable = {
      length: 0
    };
    this.track = new MockTextTrack();
    this.fakeHls = {
      xhr: xhrFactory()
    };
    this.extension = '.vtt';
    this.parserCreated = false;

    window.WebVTT = () => {};
    window.WebVTT.StringDecoder = () => {};
    window.WebVTT.Parser = () => {
      this.parserCreated = true;
      return {
        oncue() {},
        onparsingerror() {},
        onflush() {},
        parse() {},
        flush() {}
      };
    };

    this.timescale = sinon.stub(mp4probe, 'timescale');
    this.startTime = sinon.stub(mp4probe, 'startTime');

    mediaSource = new videojs.MediaSource();
    mediaSource.trigger('sourceopen');
    this.syncController = new SyncController();
    this.syncController.timelines[0] = { time: 0, mapping: 0 };
    decrypter = worker(Decrypter);
    loader = new VTTSegmentLoader({
      hls: this.fakeHls,
      currentTime: () => this.currentTime,
      seekable: () => this.seekable,
      seeking: () => false,
      duration: () => mediaSource.duration,
      hasPlayed: () => true,
      mediaSource,
      syncController: this.syncController,
      decrypter,
      loaderType: 'vtt'
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
    window.WebVTT = oldVTT;
  }
});

QUnit.skip('fails without required initialization options', function(assert) {
  /* eslint-disable no-new */
  assert.throws(function() {
    new VTTSegmentLoader();
  }, 'requires options');
  assert.throws(function() {
    new VTTSegmentLoader({});
  }, 'requires a currentTime callback');
  assert.throws(function() {
    new VTTSegmentLoader({
      currentTime() {}
    });
  }, 'requires a media source');
  /* eslint-enable */
});

QUnit.skip('load waits until a playlist and track are specified to proceed',
function(assert) {
  loader.load();

  assert.equal(loader.state, 'INIT', 'waiting in init');
  assert.equal(loader.paused(), false, 'not paused');

  loader.playlist(playlistWithDuration(10));
  assert.equal(this.requests.length, 0, 'have not made a request yet');
  loader.track(this.track);
  this.clock.tick(1);

  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(loader.state, 'WAITING', 'transitioned states');
});

QUnit.skip('calling track and load begins buffering', function(assert) {
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  loader.playlist(playlistWithDuration(10));
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  assert.ok(loader.paused(), 'starts paused');

  loader.track(this.track);
  assert.equal(loader.state, 'INIT', 'still in the init state');
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'moves to the ready state');
  assert.ok(!loader.paused(), 'loading is not paused');
  assert.equal(this.requests.length, 1, 'requested a segment');
});

QUnit.skip('calling load is idempotent', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
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
  loader.playlist(playlistWithDuration(20));
  loader.pause();

  loader.track(this.track);

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
  let buffered = videojs.createTimeRanges();

  loader.playlist(playlistWithDuration(90));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  loader.buffered = () => buffered;

  // fill the buffer
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  buffered = videojs.createTimeRanges([[
    0, Config.GOAL_BUFFER_LENGTH
  ]]);
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
  loader.playlist(playlistWithDuration(90));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  loader.pause();
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  this.clock.tick(10 * 1000);
  assert.equal(this.requests.length, 0, 'did not make a request');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaTransferDuration, 1, '1 ms (clock above)');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.skip('calculates bandwidth after downloading a segment', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.track(this.track);
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
  loader.track(this.track);
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
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  this.requests[0].dispatchEvent({ type: 'progress', target: this.requests[0] });
  assert.equal(progressEvents, 1, 'triggered progress');
});

QUnit.skip('updates timestamps when segments do not start at zero', function(assert) {
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

QUnit.skip('appending a segment when loader is in walk-forward mode triggers bandwidthupdate', function(assert) {
  let progresses = 0;

  loader.on('bandwidthupdate', function() {
    progresses++;
  });
  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  // some time passes and a response is received
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.equal(progresses, 0, 'no bandwidthupdate fired');

  this.clock.tick(2);
  // if mediaIndex is set, then the SegmentLoader is in walk-forward mode
  loader.mediaIndex = 1;

  // some time passes and a response is received
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.equal(progresses, 1, 'fired bandwidthupdate');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 20, '20 bytes');
  assert.equal(loader.mediaRequests, 2, '2 request');
});

QUnit.test('only requests one segment at a time', function(assert) {
  loader.playlist(playlistWithDuration(10));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  // a bunch of time passes without recieving a response
  this.clock.tick(20 * 1000);
  assert.equal(this.requests.length, 1, 'only one request was made');
});

QUnit.skip('only appends one segment at a time', function(assert) {
  let updates = 0;
  let handleupdateend = loader.handleUpdateEnd_.bind(loader);

  loader.handleUpdateEnd_ = () => {
    updates++;
    handleupdateend();
  };

  loader.playlist(playlistWithDuration(10));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  // some time passes and a segment is received
  this.clock.tick(100);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  // a lot of time goes by without "updateend"
  this.clock.tick(20 * 1000);

  assert.equal(updates, 1, 'only one append');
  assert.equal(this.requests.length, 0, 'only made one request');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaTransferDuration, 100, '100 ms (clock above)');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.skip('downloads init segments if specified', function(assert) {
  let playlist = playlistWithDuration(20);
  let map = {
    resolvedUri: 'main.vtt',
    byterange: {
      length: 20,
      offset: 0
    }
  };

  let buffered = videojs.createTimeRanges();

  loader.buffered = () => buffered;

  playlist.segments[0].map = map;
  playlist.segments[1].map = map;
  loader.playlist(playlist);
  loader.track(this.track);

  loader.load();
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'made requests');

  // init segment response
  this.clock.tick(1);
  assert.equal(this.requests[0].url, 'main.vtt', 'requested the init segment');
  this.requests[0].response = new Uint8Array(20).buffer;
  this.requests.shift().respond(200, null, '');
  // 0.ts response
  this.clock.tick(1);
  assert.equal(this.requests[0].url, '0.vtt',
              'requested the segment');
  this.requests[0].response = new Uint8Array(20).buffer;
  this.requests.shift().respond(200, null, '');

  // append the segment
  buffered = videojs.createTimeRanges([[0, 10]]);
  this.clock.tick(1);

  assert.equal(this.requests.length, 1, 'made a request');
  assert.equal(this.requests[0].url, '1.vtt',
              'did not re-request the init segment');
});

QUnit.skip('detects init segment changes and downloads it', function(assert) {
  let playlist = playlistWithDuration(20);
  let buffered = videojs.createTimeRanges();

  playlist.segments[0].map = {
    resolvedUri: 'init0.vtt',
    byterange: {
      length: 20,
      offset: 0
    }
  };
  playlist.segments[1].map = {
    resolvedUri: 'init0.vtt',
    byterange: {
      length: 20,
      offset: 20
    }
  };

  loader.buffered = () => buffered;

  loader.playlist(playlist);
  loader.track(this.track);

  loader.load();
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'made requests');

  // init segment response
  this.clock.tick(1);
  assert.equal(this.requests[0].url, 'init0.vtt', 'requested the init segment');
  assert.equal(this.requests[0].headers.Range, 'bytes=0-19',
              'requested the init segment byte range');
  this.requests[0].response = new Uint8Array(20).buffer;
  this.requests.shift().respond(200, null, '');
  // 0.vtt response
  this.clock.tick(1);
  assert.equal(this.requests[0].url, '0.vtt',
              'requested the segment');
  this.requests[0].response = new Uint8Array(20).buffer;
  this.requests.shift().respond(200, null, '');

  buffered = videojs.createTimeRanges([[0, 10]]);
  this.clock.tick(1);

  assert.equal(this.requests.length, 2, 'made requests');
  assert.equal(this.requests[0].url, 'init0.vtt', 'requested the init segment');
  assert.equal(this.requests[0].headers.Range, 'bytes=20-39',
              'requested the init segment byte range');
  assert.equal(this.requests[1].url, '1.vtt',
              'did not re-request the init segment');
});

QUnit.skip('triggers syncinfoupdate before attempting a resync', function(assert) {
  let syncInfoUpdates = 0;

  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
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

QUnit.skip('abort does not cancel segment processing in progress', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  loader.abort();

  assert.equal(loader.state, 'READY', 'finished processing and is READY again');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.skip('request error increments mediaRequestsErrored stat', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  this.requests.shift().respond(404, null, '');

  // verify stats
  assert.equal(loader.mediaRequests, 1, '1 request');
  assert.equal(loader.mediaRequestsErrored, 1, '1 errored request');
});

QUnit.skip('request timeout increments mediaRequestsTimedout stat', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
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
  loader.track(this.track);
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
  loader.track(this.track);
  loader.load();
  // Start at mediaIndex 2 which means that the next segment we request
  // should mediaIndex 3
  loader.mediaIndex = 2;
  this.clock.tick(1);

  assert.equal(loader.mediaIndex, 2, 'SegmentLoader.mediaIndex starts at 2');
  assert.equal(this.requests[0].url, '3.vtt', 'requesting the segment at mediaIndex 3');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  this.clock.tick(1);

  assert.equal(loader.mediaIndex, 3, 'mediaIndex ends at 3');

  this.clock.tick(1);

  assert.equal(loader.mediaIndex, 3, 'SegmentLoader.mediaIndex starts at 3');
  assert.equal(this.requests[0].url, '4.vtt', 'requesting the segment at mediaIndex 4');

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

  assert.equal(loader.mediaIndex, 2, 'SegmentLoader.mediaIndex ends at 2');
});

QUnit.skip('segmentInfo.mediaIndex is adjusted when live playlist is updated', function(assert) {
  const handleUpdateEnd_ = loader.handleUpdateEnd_.bind(loader);
  let expectedLoaderIndex = 3;

  loader.handleUpdateEnd_ = function() {
    handleUpdateEnd_();

    assert.equal(loader.mediaIndex, expectedLoaderIndex, 'SegmentLoader.mediaIndex ends at ' + expectedLoaderIndex);
    loader.mediaIndex = null;
    loader.fetchAtBuffer_ = false;
  };
  // Setting currentTime to 31 so that we start requesting at segment #3
  this.currentTime = 31;
  loader.playlist(playlistWithDuration(50, {
    mediaSequence: 0,
    endList: false
  }));
  loader.track(this.track);
  // Start at mediaIndex null which means that the next segment we request
  // should be based on currentTime (mediaIndex 3)
  loader.mediaIndex = null;
  loader.syncPoint_ = {
    segmentIndex: 0,
    time: 0
  };
  loader.load();
  this.clock.tick(1);

  let segmentInfo = loader.pendingSegment_;

  assert.equal(segmentInfo.mediaIndex, 3, 'segmentInfo.mediaIndex starts at 3');
  assert.equal(this.requests[0].url, '3.vtt', 'requesting the segment at mediaIndex 3');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  this.clock.tick(1);
  this.clock.tick(1);
  segmentInfo = loader.pendingSegment_;

  // segment 3 had no cue data (because we didn't mock any) so next request should be
  // segment 4 because of skipping empty segments
  assert.equal(segmentInfo.mediaIndex, 4, 'segmentInfo.mediaIndex starts at 4');
  assert.equal(this.requests[0].url, '4.vtt', 'requesting the segment at mediaIndex 4');

  // Update the playlist shifting the mediaSequence by 2 which will result
  // in a decrement of the mediaIndex by 4 to 2
  loader.playlist(playlistWithDuration(50, {
    mediaSequence: 2,
    endList: false
  }));

  assert.equal(segmentInfo.mediaIndex, 2, 'segmentInfo.mediaIndex is updated to 2');

  expectedLoaderIndex = 2;
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  this.clock.tick(1);
});

QUnit.skip('sets the timestampOffset on timeline change', function(assert) {
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

QUnit.skip('tracks segment end times as they are buffered', function(assert) {
  let playlist = playlistWithDuration(20);

  loader.parseVTTCues_ = function(segmentInfo) {
    segmentInfo.cues = [
      {
        startTime: 3,
        endTime: 5
      },
      {
        startTime: 4,
        endTime: 7
      }
    ];
    segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
  };

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  this.clock.tick(1);

  assert.equal(playlist.segments[0].start, -1.5, 'updated start time of segment');
  assert.equal(playlist.segments[0].end, 8.5, 'updated end time of segment');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 10, '10 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.skip('adds cues with segment information to the segment-metadata track as they are buffered',
  function(assert) {
    const track = loader.segmentMetadataTrack_;
    let playlist = playlistWithDuration(40);
    let probeResponse;
    let expectedCue;

    // loader.addSegmentMetadataCue_ = ogAddSegmentMetadataCue_;
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
  loader.track(this.track);
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
  loader.track(this.track);
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

QUnit.skip('fires ended at the end of a playlist', function(assert) {
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

QUnit.skip('live playlists do not trigger ended', function(assert) {
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
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'READY', 'in the ready state');
});

QUnit.skip('dispose cleans up outstanding work', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  loader.dispose();
  assert.ok(this.requests[0].aborted, 'aborted segment request');
  assert.equal(this.requests.length, 1, 'did not open another request');
});

// ----------
// Decryption
// ----------

QUnit.skip('calling load with an encrypted segment requests key and segment', function(assert) {
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  assert.equal(loader.state, 'INIT', 'starts in the init state');
  assert.ok(loader.paused(), 'starts paused');

  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'moves to the ready state');
  assert.ok(!loader.paused(), 'loading is not paused');
  assert.equal(this.requests.length, 2, 'requested a segment and key');
  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.equal(this.requests[1].url, '0.vtt', 'requested the first segment');
});

QUnit.skip('dispose cleans up key requests for encrypted segments', function(assert) {
  loader.playlist(playlistWithDuration(20, {isEncrypted: true}));
  loader.track(this.track);
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
  loader.track(this.track);
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
  loader.track(this.track);
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
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.equal(this.requests[1].url, '0.vtt', 'requested the first segment');
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
  loader.track(this.track);
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
  let buffered = videojs.createTimeRanges();

  loader.buffered = () => buffered;

  playlist.endList = false;

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.pendingSegment_.uri, '0.vtt', 'retrieving first segment');
  assert.equal(loader.pendingSegment_.segment.uri, '0.vtt', 'correct segment reference');
  assert.equal(loader.state, 'WAITING', 'waiting for response');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  // playlist updated during append
  let playlistUpdated = playlistWithDuration(40);

  playlistUpdated.segments.shift();
  playlistUpdated.mediaSequence++;
  loader.playlist(playlistUpdated);
  // finish append
  buffered = videojs.createTimeRanges([[0, 10]]);
  this.clock.tick(1);

  assert.equal(loader.pendingSegment_.uri, '1.vtt', 'retrieving second segment');
  assert.equal(loader.pendingSegment_.segment.uri, '1.vtt', 'correct segment reference');
  assert.equal(loader.state, 'WAITING', 'waiting for response');
});

QUnit.skip('processing segment reachable even after playlist update removes it',
function(assert) {
  const handleUpdateEnd_ = loader.handleUpdateEnd_.bind(loader);
  let expectedURI = '0.vtt';
  let playlist = playlistWithDuration(40);
  let buffered = videojs.createTimeRanges();

  loader.handleUpdateEnd_ = () => {
    assert.equal(loader.state, 'APPENDING', 'moved to appending state');
    assert.equal(loader.pendingSegment_.uri, expectedURI, 'correct pending segment');
    assert.equal(loader.pendingSegment_.segment.uri, expectedURI, 'correct segment reference');

    handleUpdateEnd_();
  };

  loader.buffered = () => buffered;

  playlist.endList = false;

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '0.vtt', 'first segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '0.vtt', 'correct segment reference');

  // wrap up the first request to set mediaIndex and start normal live streaming
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  buffered = videojs.createTimeRanges([[0, 10]]);
  expectedURI = '1.vtt';
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.vtt', 'correct segment reference');

  // playlist updated during waiting
  let playlistUpdated = playlistWithDuration(40);

  playlistUpdated.segments.shift();
  playlistUpdated.segments.shift();
  playlistUpdated.mediaSequence += 2;
  loader.playlist(playlistUpdated);

  assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment still pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.vtt', 'correct segment reference');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
});

QUnit.test('saves segment info to new segment after playlist refresh',
function(assert) {
  let playlist = playlistWithDuration(40);
  let buffered = videojs.createTimeRanges();

  loader.buffered = () => buffered;

  playlist.endList = false;

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '0.vtt', 'first segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '0.vtt', 'correct segment reference');

  // wrap up the first request to set mediaIndex and start normal live streaming
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  buffered = videojs.createTimeRanges([[0, 10]]);
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.vtt', 'correct segment reference');

  // playlist updated during waiting
  let playlistUpdated = playlistWithDuration(40);

  playlistUpdated.segments.shift();
  playlistUpdated.mediaSequence++;
  loader.playlist(playlistUpdated);

  assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment still pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.vtt', 'correct segment reference');

  // mock parseVttCues_ to respond empty cue array
  loader.parseVTTCues_ = (segmentInfo) => {
    segmentInfo.cues = [];
    segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
  };

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.ok(playlistUpdated.segments[0].empty, 'set empty on segment of new playlist');
  assert.ok(!playlist.segments[1].empty, 'did not set empty on segment of old playlist');
});

QUnit.test('saves segment info to old segment after playlist refresh if segment fell off',
function(assert) {
  let playlist = playlistWithDuration(40);
  let buffered = videojs.createTimeRanges();

  loader.buffered = () => buffered;

  playlist.endList = false;

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '0.vtt', 'first segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '0.vtt', 'correct segment reference');

  // wrap up the first request to set mediaIndex and start normal live streaming
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  buffered = videojs.createTimeRanges([[0, 10]]);
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'in waiting state');
  assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.vtt', 'correct segment reference');

  // playlist updated during waiting
  let playlistUpdated = playlistWithDuration(40);

  playlistUpdated.segments.shift();
  playlistUpdated.segments.shift();
  playlistUpdated.mediaSequence += 2;
  loader.playlist(playlistUpdated);

  assert.equal(loader.pendingSegment_.uri, '1.vtt', 'second segment still pending');
  assert.equal(loader.pendingSegment_.segment.uri, '1.vtt', 'correct segment reference');

  // mock parseVttCues_ to respond empty cue array
  loader.parseVTTCues_ = (segmentInfo) => {
    segmentInfo.cues = [];
    segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
  };

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.ok(playlist.segments[1].empty,
            'set empty on segment of old playlist');
  assert.ok(!playlistUpdated.segments[0].empty,
            'no empty info for first segment of new playlist');
});

QUnit.skip('new playlist always triggers syncinfoupdate', function(assert) {
  let playlist = playlistWithDuration(100, { endList: false });
  let syncInfoUpdates = 0;

  loader.on('syncinfoupdate', () => syncInfoUpdates++);

  loader.playlist(playlist);
  loader.track(this.track);
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

QUnit.test('waits for syncController to have sync info for the timeline of the vtt' +
  'segment being requested before loading', function(assert) {
  let playlist = playlistWithDuration(40);
  let loadedSegment = false;

  loader.loadSegment_ = () => {
    loader.state = 'WAITING';
    loadedSegment = true;
  };
  loader.checkBuffer_ = () => {
    return { mediaIndex: 2, timeline: 2, segment: { } };
  };

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();

  assert.equal(loader.state, 'READY', 'loader is ready at start');
  assert.ok(!loadedSegment, 'no segment requests made yet');

  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING_ON_TIMELINE', 'loader waiting for timeline info');
  assert.ok(!loadedSegment, 'no segment requests made yet');

  // simulate the main segment loader finding timeline info for the new timeline
  loader.syncController_.timelines[2] = { time: 20, mapping: -10 };
  loader.syncController_.trigger('timestampoffset');

  assert.equal(loader.state, 'READY', 'ready after sync controller reports timeline info');
  assert.ok(!loadedSegment, 'no segment requests made yet');

  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'loader waiting on segment request');
  assert.ok(loadedSegment, 'made call to load segment on new timeline');
});

QUnit.test('waits for vtt.js to be loaded before attempting to parse cues', function(assert) {
  const vttjs = window.WebVTT;
  let playlist = playlistWithDuration(40);
  let parsedCues = false;

  delete window.WebVTT;

  loader.handleUpdateEnd_ = () => {
    parsedCues = true;
    loader.state = 'READY';
  };

  let vttjsCallback = () => {};

  this.track.tech_ = {
    one(event, callback) {
      if (event === 'vttjsloaded') {
        vttjsCallback = callback;
      }
    },
    trigger(event) {
      if (event === 'vttjsloaded') {
        vttjsCallback();
      }
    },
    off() {}
  };

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();

  assert.equal(loader.state, 'READY', 'loader is ready at start');
  assert.ok(!parsedCues, 'no cues parsed yet');

  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'loader is waiting on segment request');
  assert.ok(!parsedCues, 'no cues parsed yet');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING_ON_VTTJS', 'loader is waiting for vttjs to be loaded');
  assert.ok(!parsedCues, 'no cues parsed yet');

  window.WebVTT = vttjs;

  loader.subtitlesTrack_.tech_.trigger('vttjsloaded');

  assert.equal(loader.state, 'READY', 'loader is ready to load next segment');
  assert.ok(parsedCues, 'parsed cues');
});

QUnit.test('uses timestampmap from vtt header to set cue and segment timing', function(assert) {
  const cues = [
    { startTime: 10, endTime: 12 },
    { startTime: 14, endTime: 16 },
    { startTime: 15, endTime: 19 }
  ];
  const expectedCueTimes = [
    { startTime: 14, endTime: 16 },
    { startTime: 18, endTime: 20 },
    { startTime: 19, endTime: 23 }
  ];
  const expectedSegment = {
    duration: 10
  };
  const expectedPlaylist = {
    mediaSequence: 100,
    syncInfo: { mediaSequence: 102, time: 9 }
  };
  const mappingObj = {
    time: 0,
    mapping: -10
  };
  const playlist = { mediaSequence: 100 };
  const segment = { duration: 10 };
  const segmentInfo = {
    timestampmap: { MPEGTS: 1260000, LOCAL: 0 },
    mediaIndex: 2,
    cues,
    segment
  };

  loader.updateTimeMapping_(segmentInfo, mappingObj, playlist);

  assert.deepEqual(cues, expectedCueTimes, 'adjusted cue timing based on timestampmap');
  assert.deepEqual(segment, expectedSegment, 'set segment start and end based on cue content');
  assert.deepEqual(playlist, expectedPlaylist, 'set syncInfo for playlist based on learned segment start');
});

QUnit.test('loader logs vtt.js ParsingErrors and does not trigger an error event', function(assert) {
  let playlist = playlistWithDuration(40);

  window.WebVTT.Parser = () => {
    this.parserCreated = true;
    return {
      oncue() {},
      onparsingerror() {},
      onflush() {},
      parse() {
        // MOCK parsing the cues below
        this.onparsingerror({ message: 'BAD CUE'});
        this.oncue({ startTime: 5, endTime: 6});
        this.onparsingerror({ message: 'BAD --> CUE' });
      },
      flush() {}
    };
  };

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();

  this.clock.tick(1);

  const vttString = `
    WEBVTT

    00:00:03.000 -> 00:00:05.000
    <i>BAD CUE</i>

    00:00:05.000 --> 00:00:06.000
    <b>GOOD CUE</b>

    00:00:07.000 --> 00:00:10.000
    <i>BAD --> CUE</i>
  `;

  // state WAITING for segment response
  this.requests[0].response = new Uint8Array(vttString.split('').map(char => char.charCodeAt(0)));
  this.requests.shift().respond(200, null, '');

  this.clock.tick(1);

  assert.equal(this.track.cues.length, 1, 'only appended the one good cue');
  assert.equal(this.env.log.warn.callCount, 2, 'logged two warnings, one for each invalid cue');
  this.env.log.warn.callCount = 0;
});

QUnit.test('loader does not re-request segments that contain no subtitles', function(assert) {
  let playlist = playlistWithDuration(60);

  playlist.endList = false;

  loader.parseVTTCues_ = (segmentInfo) => {
    // mock empty segment
    segmentInfo.cues = [];
  };

  loader.currentTime_ = () => {
    return 30;
  };

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();

  this.clock.tick(1);

  assert.equal(loader.pendingSegment_.mediaIndex, 2, 'requesting initial segment guess');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  this.clock.tick(1);

  assert.ok(playlist.segments[2].empty, 'marked empty segment as empty');
  assert.equal(loader.pendingSegment_.mediaIndex, 3, 'walked forward skipping requesting empty segment');
});

QUnit.test('loader triggers error event on fatal vtt.js errors', function(assert) {
  let playlist = playlistWithDuration(40);
  let errors = 0;

  loader.parseVTTCues_ = () => {
    throw new Error('fatal error');
  };
  loader.on('error', () => errors++);

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();

  assert.equal(errors, 0, 'no error at loader start');

  this.clock.tick(1);

  // state WAITING for segment response
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  this.clock.tick(1);

  assert.equal(errors, 1, 'triggered error when parser emmitts fatal error');
  assert.ok(loader.paused(), 'loader paused when encountering fatal error');
  assert.equal(loader.state, 'READY', 'loader reset after error');
});

QUnit.test('loader triggers error event when vtt.js fails to load', function(assert) {
  let playlist = playlistWithDuration(40);
  let errors = 0;

  delete window.WebVTT;
  let vttjsCallback = () => {};

  this.track.tech_ = {
    one(event, callback) {
      if (event === 'vttjserror') {
        vttjsCallback = callback;
      }
    },
    trigger(event) {
      if (event === 'vttjserror') {
        vttjsCallback();
      }
    },
    off() {}
  };

  loader.on('error', () => errors++);

  loader.playlist(playlist);
  loader.track(this.track);
  loader.load();

  assert.equal(loader.state, 'READY', 'loader is ready at start');
  assert.equal(errors, 0, 'no errors yet');

  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'loader is waiting on segment request');
  assert.equal(errors, 0, 'no errors yet');

  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING_ON_VTTJS', 'loader is waiting for vttjs to be loaded');
  assert.equal(errors, 0, 'no errors yet');

  loader.subtitlesTrack_.tech_.trigger('vttjserror');

  assert.equal(loader.state, 'READY', 'loader is reset to ready');
  assert.ok(loader.paused(), 'loader is paused after error');
  assert.equal(errors, 1, 'loader triggered error when vtt.js load triggers error');
});

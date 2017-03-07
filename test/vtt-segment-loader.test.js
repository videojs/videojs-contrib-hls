import QUnit from 'qunit';
import VTTSegmentLoader from '../src/vtt-segment-loader';
import videojs from 'video.js';
import xhrFactory from '../src/xhr';
import mp4probe from 'mux.js/lib/mp4/probe';
import Config from '../src/config';
import {
  playlistWithDuration as oldPlaylistWithDuration,
  useFakeEnvironment,
  useFakeMediaSource
} from './test-helpers.js';
import sinon from 'sinon';
import SyncController from '../src/sync-controller';
import Decrypter from '../src/decrypter-worker';
import worker from 'webworkify';

class MockTextTrack {
  constructor() {
    this.cues = [];
  }
  addCue(cue) {
    this.cues.push(cue);
  }
}

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

QUnit.test('fails without required initialization options', function(assert) {
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

QUnit.test('load waits until a playlist and track are specified to proceed',
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

QUnit.test('calling track and load begins buffering', function(assert) {
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

QUnit.test('calling load is idempotent', function(assert) {
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

QUnit.test('calling load should unpause', function(assert) {
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

QUnit.test('regularly checks the buffer while unpaused', function(assert) {
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

QUnit.test('does not check the buffer while paused', function(assert) {
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

QUnit.test('calculates bandwidth after downloading a segment', function(assert) {
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
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('segment request timeouts reset bandwidth', function(assert) {
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

QUnit.test('progress on segment requests are redispatched', function(assert) {
  let progressEvents = 0;

  loader.on('progress', function() {
    progressEvents++;
  });
  loader.playlist(playlistWithDuration(10));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  this.requests[0].dispatchEvent({ type: 'progress' });
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

QUnit.test('appending a segment when loader is in walk-forward mode triggers progress', function(assert) {
  let progresses = 0;

  loader.on('progress', function() {
    progresses++;
  });
  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  // some time passes and a response is received
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.equal(progresses, 0, 'no progress fired');

  this.clock.tick(2);
  // if mediaIndex is set, then the SegmentLoader is in walk-forward mode
  loader.mediaIndex = 1;

  // some time passes and a response is received
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');

  assert.equal(progresses, 1, 'fired progress');

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

QUnit.test('only appends one segment at a time', function(assert) {
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

QUnit.skip('adjusts the playlist offset if no buffering progress is made', function(assert) {
  let sourceBuffer;
  let playlist;

  playlist = playlistWithDuration(40);
  playlist.endList = false;
  loader.playlist(playlist);
  loader.mimeType(this.mimeType);
  loader.load();
  this.clock.tick(1);

  sourceBuffer = mediaSource.sourceBuffers[0];

  loader.mediaIndex = 0;
  // buffer some content and switch playlists on progress
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  loader.on('progress', function f() {
    loader.off('progress', f);
    // switch playlists
    playlist = playlistWithDuration(40);
    playlist.uri = 'alternate.m3u8';
    playlist.endList = false;
    loader.playlist(playlist);
    this.clock.tick(1);
  }.bind(this));
  sourceBuffer.buffered = videojs.createTimeRanges([[0, 5]]);
  sourceBuffer.trigger('updateend');
  this.clock.tick(1);

  // the next segment doesn't increase the buffer at all
  assert.equal(this.requests[0].url, '0.ts', 'requested the same segment');
  this.clock.tick(1);
  this.requests[0].response = new Uint8Array(10).buffer;
  this.requests.shift().respond(200, null, '');
  sourceBuffer.trigger('updateend');
  this.clock.tick(1);

  // so the loader should try the next segment
  assert.equal(this.requests[0].url, '1.ts', 'moved ahead a segment');

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 20, '20 bytes');
  assert.equal(loader.mediaTransferDuration, 1, '1 ms (clocks above)');
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

QUnit.test('detects init segment changes and downloads it', function(assert) {
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

QUnit.test('cancels outstanding requests on abort', function(assert) {
  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  loader.xhr_.segmentXhr.onreadystatechange = function() {
    throw new Error('onreadystatechange should not be called');
  };

  loader.abort();
  this.clock.tick(1);

  assert.ok(this.requests[0].aborted, 'aborted the first request');
  assert.equal(this.requests.length, 2, 'started a new request');
  assert.equal(loader.state, 'WAITING', 'back to the waiting state');
});

QUnit.test('abort does not cancel segment processing in progress', function(assert) {
  loader.handleUpdateEnd_ = () => {};

  loader.playlist(playlistWithDuration(20));
  loader.track(this.track);
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

QUnit.test('SegmentLoader.mediaIndex is adjusted when live playlist is updated', function(assert) {
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

QUnit.test('segmentInfo.mediaIndex is adjusted when live playlist is updated', function(assert) {
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

  assert.equal(segmentInfo.mediaIndex, 3, 'segmentInfo.mediaIndex starts at 3');
  assert.equal(this.requests[0].url, '3.vtt', 'requesting the segment at mediaIndex 3');

  // Update the playlist shifting the mediaSequence by 2 which will result
  // in a decrement of the mediaIndex by 2 to 1
  loader.playlist(playlistWithDuration(50, {
    mediaSequence: 2,
    endList: false
  }));

  assert.equal(segmentInfo.mediaIndex, 1, 'segmentInfo.mediaIndex is updated to 1');

  expectedLoaderIndex = 1;
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

QUnit.test('tracks segment end times as they are buffered', function(assert) {
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

QUnit.test('segment 404s should trigger an error', function(assert) {
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

QUnit.test('segment 5xx status codes trigger an error', function(assert) {
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

QUnit.test('remains ready if there are no segments', function(assert) {
  loader.playlist(playlistWithDuration(0));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'READY', 'in the ready state');
});

QUnit.test('dispose cleans up outstanding work', function(assert) {
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

QUnit.test('calling load with an encrypted segment requests key and segment', function(assert) {
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

QUnit.test('cancels outstanding key request on abort', function(assert) {
  loader.playlist(playlistWithDuration(20, {isEncrypted: true}));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  loader.xhr_.keyXhr.onreadystatechange = function() {
    throw new Error('onreadystatechange should not be called');
  };

  assert.equal(this.requests.length, 2, 'requested a segment and key');
  loader.abort();
  this.clock.tick(1);

  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.ok(this.requests[0].aborted, 'aborted the first key request');
  assert.equal(this.requests.length, 4, 'started a new request');
  assert.equal(loader.state, 'WAITING', 'back to the waiting state');
});

QUnit.test('dispose cleans up key requests for encrypted segments', function(assert) {
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

QUnit.test('key 404s should trigger an error', function(assert) {
  let errors = [];

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

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
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

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
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

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
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

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
  let done = assert.async();

  // stop processing so we can examine segment info
  loader.handleSegment_ = function() {
    assert.ok(loader.pendingSegment_.bytes, 'decrypted bytes in segment');
    done();
  };

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

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

  // verify stats
  assert.equal(loader.mediaBytesTransferred, 8, '8 bytes');
  assert.equal(loader.mediaRequests, 1, '1 request');
});

QUnit.test('calling load with an encrypted segment waits for both key and segment ' +
           'before processing', function(assert) {
  let keyRequest;
  let segmentRequest;

  loader.playlist(playlistWithDuration(10, {isEncrypted: true}));
  loader.track(this.track);
  loader.load();
  this.clock.tick(1);

  assert.equal(loader.state, 'WAITING', 'moves to waiting state');
  assert.equal(this.requests.length, 2, 'requested a segment and key');
  assert.equal(this.requests[0].url, '0-key.php', 'requested the first segment\'s key');
  assert.equal(this.requests[1].url, '0.vtt', 'requested the first segment');
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

QUnit.test('checks the goal buffer configuration every loading opportunity', function(assert) {
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

QUnit.test('does not skip over segment if live playlist update occurs while processing',
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

QUnit.test('processing segment reachable even after playlist update removes it',
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

  // mock probeSegmentInfo as the response bytes aren't parsable (and won't provide
  // time info)
  loader.parseVTTCues_ = (segmentInfo) => {
    segmentInfo.cues = [{ startTime: 10, endTime: 11 }, { startTime: 20, endTime: 21 }];
    segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
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

  // mock probeSegmentInfo as the response bytes aren't parsable (and won't provide
  // time info)
  loader.parseVTTCues_ = (segmentInfo) => {
    segmentInfo.cues = [{ startTime: 10, endTime: 11 }, { startTime: 20, endTime: 21 }];
    segmentInfo.timestampmap = { MPEGTS: 0, LOCAL: 0 };
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

QUnit.test('new playlist always triggers syncinfoupdate', function(assert) {
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
    return { mediaIndex: 2, timeline: 2 };
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
    on(event, callback) {
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
    duration: 10,
    start: 11.5,
    end: 21.5
  };
  const expectedPlaylist = {
    mediaSequence: 100,
    syncInfo: { mediaSequence: 102, time: 11.5 }
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
    on(event, callback) {
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

QUnit.module('VTT Segment Loading Calculation', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.mse = useFakeMediaSource();
    this.hasPlayed = true;
    this.clock = this.env.clock;

    this.currentTime = 0;
    syncController = new SyncController();
    loader = new VTTSegmentLoader({
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
  loader.track(this.track);

  let segmentInfo = loader.checkBuffer_(videojs.createTimeRanges(),
                                        playlistWithDuration(20),
                                        null,
                                        loader.hasPlayed_(),
                                        0,
                                        null);

  assert.ok(segmentInfo, 'generated a request');
  assert.equal(segmentInfo.uri, '0.vtt', 'requested the first segment');
});

QUnit.test('no request if video not played and 1 segment is buffered', function(assert) {
  this.hasPlayed = false;
  loader.track(this.track);

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

  loader.track(this.track);

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

  loader.track(this.track);
  loader.playlist(playlist);

  buffered = videojs.createTimeRanges([[0, 19.999]]);
  segmentInfo = loader.checkBuffer_(buffered,
                                    playlist,
                                    1,
                                    true,
                                    15,
                                    { segmentIndex: 0, time: 0 });

  assert.ok(segmentInfo, 'made a request');
  assert.equal(segmentInfo.uri, '2.vtt', 'requested the third segment');
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

  loader.track(this.track);

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

  loader.track(this.track);

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

  loader.track(this.track);
  loader.monitorBuffer_();

  assert.equal(this.clock.methods.length, timeoutCount, 'timeout count remains the same');

  loader.monitorBuffer_();

  assert.equal(this.clock.methods.length, timeoutCount, 'timeout count remains the same');

  loader.monitorBuffer_();
  loader.monitorBuffer_();

  assert.equal(this.clock.methods.length, timeoutCount, 'timeout count remains the same');
});

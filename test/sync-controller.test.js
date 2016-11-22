import QUnit from 'qunit';
import {
  default as SyncController,
  syncPointStrategies as strategies } from '../src/sync-controller.js';
import { playlistWithDuration } from './test-helpers.js';

QUnit.module('SyncController', {
  beforeEach() {
    this.syncController = new SyncController();
  }
});

QUnit.test('returns correct sync point for VOD strategy', function(assert) {
  let playlist = playlistWithDuration(40);
  let duration = 40;
  let timeline = 0;
  let vodStrategy = strategies[0];
  let syncPoint = vodStrategy.run(this.syncController, playlist, duration, timeline);

  assert.deepEqual(syncPoint, { time: 0, segmentIndex: 0 }, 'sync point found for vod');

  duration = Infinity;
  syncPoint = vodStrategy.run(this.syncController, playlist, duration, timeline);

  assert.equal(syncPoint, null, 'no syncpoint found for non vod ');
});

QUnit.test('returns correct sync point for ProgramDateTime strategy', function(assert) {
  let strategy = strategies[1];
  let datetime = new Date(2012, 11, 12, 12, 12, 12);
  let playlist = playlistWithDuration(40);
  let timeline = 0;
  let duration = Infinity;
  let syncPoint;

  syncPoint = strategy.run(this.syncController, playlist, duration, timeline);

  assert.equal(syncPoint, null, 'no syncpoint when datetimeToDisplayTime not set');

  playlist.dateTimeObject = datetime;

  this.syncController.setDateTimeMapping(playlist);

  let newPlaylist = playlistWithDuration(40);

  syncPoint = strategy.run(this.syncController, newPlaylist, duration, timeline);

  assert.equal(syncPoint, null, 'no syncpoint when datetimeObject not set on playlist');

  newPlaylist.dateTimeObject = new Date(2012, 11, 12, 12, 12, 22);

  syncPoint = strategy.run(this.syncController, newPlaylist, duration, timeline);

  assert.deepEqual(syncPoint, {
    time: 10,
    segmentIndex: 0
  }, 'syncpoint found for ProgramDateTime set');
});

QUnit.test('returns correct sync point for Segment strategy', function(assert) {
  let strategy = strategies[2];
  let playlist = {
    segments: [
      { timeline: 0 },
      { timeline: 0 },
      { timeline: 1 },
      { timeline: 1 },
      { timeline: 1, start: 30 },
      { timeline: 1 },
      { timeline: 2 },
      { timeline: 2 }
    ]
  };
  let currentTimeline;
  let syncPoint;

  currentTimeline = 0;
  syncPoint = strategy.run(this.syncController, playlist, 80, currentTimeline);
  assert.equal(syncPoint, null, 'no syncpoint for timeline 0');

  currentTimeline = 1;
  syncPoint = strategy.run(this.syncController, playlist, 80, currentTimeline);
  assert.deepEqual(syncPoint, { time: 30, segmentIndex: 4 },
    'sync point found');
});

QUnit.skip('returns correct sync point for Discontinuity strategy', function(assert) {
  let strategy = strategies[3];
  let playlist = {
    targetDuration: 10,
    discontinuitySequence: 2,
    discontinuityStarts: [2, 5],
    segments: [
      { timeline: 2, start: 20, end: 30, duration: 10 },
      { timeline: 2, start: 30, end: 40, duration: 10 },
      { timeline: 3, start: 40, end: 50, duration: 10, discontinuity: true },
      { timeline: 3, start: 50, end: 60, duration: 10 },
      { timeline: 3, start: 60, end: 70, duration: 10 },
      { timeline: 4, start: 70, end: 80, duration: 10, discontinuity: true },
      { timeline: 4, start: 80, end: 90, duration: 10 },
      { timeline: 4, start: 90, end: 100, duration: 10 }
    ]
  };
  let segmentInfo = {
    playlist,
    mediaIndex: 2
  };
  let currentTimeline = 3;
  let syncPoint;

  syncPoint = strategy.run(this.syncController, playlist, 100, currentTimeline);
  assert.equal(syncPoint, null, 'no sync point when no discontinuities saved');

  this.syncController.saveDiscontinuitySyncInfo_(segmentInfo);

  syncPoint = strategy.run(this.syncController, playlist, 100, currentTimeline);
  assert.deepEqual(syncPoint, { time: 40, segmentIndex: 2 },
    'found sync point for timeline 3');

  segmentInfo.mediaIndex = 6;
  currentTimeline = 4;

  this.syncController.saveDiscontinuitySyncInfo_(segmentInfo);

  syncPoint = strategy.run(this.syncController, playlist, 100, currentTimeline);
  assert.deepEqual(syncPoint, { time: 70, segmentIndex: 5 },
    'found sync point for timeline 4');
});

QUnit.test('returns correct sync point for Playlist strategy', function(assert) {
  let strategy = strategies[4];
  let playlist = { mediaSequence: 100 };
  let syncPoint;

  syncPoint = strategy.run(this.syncController, playlist, 40, 0);
  assert.equal(syncPoint, null, 'no sync point if no sync info');

  playlist.mediaSequence = 102;
  playlist.syncInfo = { time: 10, mediaSequence: 100};

  syncPoint = strategy.run(this.syncController, playlist, 40, 0);
  assert.deepEqual(syncPoint, { time: 10, segmentIndex: -2 }, 'found sync point in playlist');
});

QUnit.test('saves expired info onto new playlist for possible sync point', function(assert) {
  let oldPlaylist = playlistWithDuration(50);
  let newPlaylist = playlistWithDuration(50);

  oldPlaylist.mediaSequence = 100;
  newPlaylist.mediaSequence = 103;

  oldPlaylist.segments[0].start = 390;
  oldPlaylist.segments[1].start = 400;

  this.syncController.saveExpiredSegmentInfo(oldPlaylist, newPlaylist);

  assert.deepEqual(newPlaylist.syncInfo, { mediaSequence: 101, time: 400 },
    'saved correct info for expired segment onto new playlist');
});

QUnit.test('Correctly updates time mapping and discontinuity info when probing segments',
  function(assert) {
    let syncCon = this.syncController;
    let playlist = playlistWithDuration(60);

    playlist.discontinuityStarts = [3];
    playlist.discontinuitySequence = 0;
    playlist.segments[3].discontinuity = true;
    playlist.segments.forEach((segment, i) => {
      if (i >= playlist.discontinuityStarts[0]) {
        segment.timeline = 1;
      } else {
        segment.timeline = 0;
      }
    });

    syncCon.probeTsSegment_ = function(segmentInfo) {
      return {
        // offset segment timing to make things interesting
        start: segmentInfo.mediaIndex * 10 + 5 + (6 * segmentInfo.timeline),
        end: segmentInfo.mediaIndex * 10 + 10 + 5 + (6 * segmentInfo.timeline)
      };
    };

    let segmentInfo = {
      mediaIndex: 0,
      playlist,
      timeline: 0,
      timestampOffset: 0
    };
    let segment = playlist.segments[0];

    syncCon.probeSegmentInfo(segmentInfo);
    assert.ok(syncCon.timelines[0], 'created mapping object for timeline 0');
    assert.deepEqual(syncCon.timelines[0], { time: 0, mapping: -5 },
      'mapping object correct');
    assert.equal(segment.start, 0, 'correctly calculated segment start');
    assert.equal(segment.end, 10, 'correctly calculated segment end');
    assert.ok(syncCon.discontinuities[1], 'created discontinuity info for timeline 1');
    assert.deepEqual(syncCon.discontinuities[1], { time: 30, accuracy: 3 },
      'discontinuity sync info correct');

    segmentInfo.timestampOffset = null;
    segmentInfo.mediaIndex = 1;
    segment = playlist.segments[1];

    syncCon.probeSegmentInfo(segmentInfo);
    assert.equal(segment.start, 10, 'correctly calculated segment start');
    assert.equal(segment.end, 20, 'correctly calculated segment end');
    assert.deepEqual(syncCon.discontinuities[1], { time: 30, accuracy: 2 },
      'discontinuity sync info correctly updated with new accuracy');

    segmentInfo.timestampOffset = 30;
    segmentInfo.mediaIndex = 3;
    segmentInfo.timeline = 1;
    segment = playlist.segments[3];

    syncCon.probeSegmentInfo(segmentInfo);
    assert.ok(syncCon.timelines[1], 'created mapping object for timeline 1');
    assert.deepEqual(syncCon.timelines[1], { time: 30, mapping: -11 },
      'mapping object correct');
    assert.equal(segment.start, 30, 'correctly calculated segment start');
    assert.equal(segment.end, 40, 'correctly calculated segment end');
    assert.deepEqual(syncCon.discontinuities[1], { time: 30, accuracy: 0 },
      'discontinuity sync info correctly updated with new accuracy');
  });

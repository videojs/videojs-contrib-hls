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

QUnit.test('returns correct sync point for VOD strategy', function() {
  let playlist = playlistWithDuration(40);
  let duration = 40;
  let timeline = 0;
  let vodStrategy = strategies[0];
  let syncPoint = vodStrategy.run(this.syncController, playlist, duration, timeline);

  QUnit.deepEqual(syncPoint, { time: 0, segmentIndex: 0 }, 'sync point found for vod');

  duration = Infinity;
  syncPoint = vodStrategy.run(this.syncController, playlist, duration, timeline);

  QUnit.equal(syncPoint, null, 'no syncpoint found for non vod ');
});

QUnit.test('returns correct sync point for ProgramDateTime strategy', function() {
  let strategy = strategies[1];
  let datetime = new Date(2012, 11, 12, 12, 12, 12);
  let playlist = playlistWithDuration(40);
  let timeline = 0;
  let duration = Infinity;
  let syncPoint;

  syncPoint = strategy.run(this.syncController, playlist, duration, timeline);

  QUnit.equal(syncPoint, null, 'no syncpoint when datetimeToDisplayTime not set');

  playlist.dateTimeObject = datetime;

  this.syncController.setDateTimeMapping(playlist);

  let newPlaylist = playlistWithDuration(40);

  syncPoint = strategy.run(this.syncController, newPlaylist, duration, timeline);

  QUnit.equal(syncPoint, null, 'no syncpoint when datetimeObject not set on playlist');

  newPlaylist.dateTimeObject = new Date(2012, 11, 12, 12, 12, 22);

  syncPoint = strategy.run(this.syncController, newPlaylist, duration, timeline);

  QUnit.deepEqual(syncPoint, {
    time: 10,
    segmentIndex: 0
  }, 'syncpoint found for ProgramDateTime set');
});

QUnit.test('returns correct sync point for Segment strategy', function() {
  let strategy = strategies[2];
  let playlist = {
    segments: [
      { timeline: 0 },
      { timeline: 0 },
      { timeline: 1 },
      { timeline: 1 },
      { timeline: 1, start: 30 }, //index 4
      { timeline: 1 },
      { timeline: 2 },
      { timeline: 2 },
    ]
  };
  let currentTimeline ;
  let syncPoint;

  currentTimeline = 0;
  syncPoint = strategy.run(this.syncController, playlist, 80, currentTimeline);
  QUnit.equal(syncPoint, null, 'no syncpoint for timeline 0');

  currentTimeline = 1;
  syncPoint = strategy.run(this.syncController, playlist, 80, currentTimeline);
  QUnit.deepEqual(syncPoint, { time: 30, segmentIndex: 4 },
    'sync point found');
});

QUnit.test('returns correct sync point for Discontinuity strategy', function() {
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
      { timeline: 4, start: 90, end: 100, duration: 10 },
    ]
  };
  let segmentInfo = {
    playlist: playlist,
    mediaIndex: 2,
  };
  let currentTimeline = 3;
  let syncPoint;

  syncPoint = strategy.run(this.syncController, playlist, 100, currentTimeline);
  QUnit.equal(syncPoint, null, 'no sync point when no discontinuities saved');

  this.syncController.saveDiscontinuitySyncInfo_(segmentInfo);

  syncPoint = strategy.run(this.syncController, playlist, 100, currentTimeline);
  QUnit.deepEqual(syncPoint, { time: 40, segmentIndex: 2 },
    'found sync point for timeline 3');

  segmentInfo.mediaIndex = 6;
  currentTimeline = 4;

  this.syncController.saveDiscontinuitySyncInfo_(segmentInfo);

  syncPoint = strategy.run(this.syncController, playlist, 100, currentTimeline);
  QUnit.deepEqual(syncPoint, { time: 70, segmentIndex: 5 },
    'found sync point for timeline 4');
});

QUnit.test('returns correct sync point for Playlist strategy', function() {
  let strategy = strategies[4];
  let playlist = { mediaSequence: 100 };
  let syncPoint;

  syncPoint = strategy.run(this.syncController, playlist, 40, 0);
  QUnit.equal(syncPoint, null, 'no sync point if no sync info');

  playlist.mediaSequence = 102;
  playlist.syncInfo = { time: 10, mediaSequence: 100};

  syncPoint = strategy.run(this.syncController, playlist, 40, 0);
  QUnit.deepEqual(syncPoint, { time: 10, segmentIndex: -2 }, 'found sync point in playlist');
});

QUnit.test('saves expired info onto new playlist for possible sync point', function() {
  let oldPlaylist = playlistWithDuration(50);
  let newPlaylist = playlistWithDuration(50);

  oldPlaylist.mediaSequence = 100;
  newPlaylist.mediaSequence = 103;

  oldPlaylist.segments[0].start = 390;
  oldPlaylist.segments[1].start = 400;

  this.syncController.saveExpiredSegmentInfo(oldPlaylist, newPlaylist);

  QUnit.deepEqual(newPlaylist.syncInfo, { mediaSequence: 101, time: 400 },
    'saved correct info for expired segment onto new playlist');
});

import SourceUpdater from '../src/source-updater';
import QUnit from 'qunit';
import videojs from 'video.js';
import { useFakeMediaSource } from './test-helpers';

QUnit.module('Source Updater', {
  beforeEach() {
    this.mse = useFakeMediaSource();
    this.mediaSource = new videojs.MediaSource();
  },
  afterEach() {
    this.mse.restore();
  }
});

QUnit.test('waits for sourceopen to create a source buffer', function() {
  new SourceUpdater(this.mediaSource, 'video/mp2t'); // eslint-disable-line no-new

  QUnit.equal(this.mediaSource.sourceBuffers.length, 0,
              'waited to create the source buffer');

  this.mediaSource.trigger('sourceopen');

  QUnit.equal(this.mediaSource.sourceBuffers.length, 1, 'created one source buffer');
  QUnit.equal(this.mediaSource.sourceBuffers[0].mimeType_, 'video/mp2t',
              'assigned the correct MIME type');
});

QUnit.test('runs a callback when the source buffer is created', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  updater.appendBuffer(new Uint8Array([0, 1, 2]));

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];
  QUnit.equal(sourceBuffer.updates_.length, 1, 'called the source buffer once');
  QUnit.deepEqual(sourceBuffer.updates_[0].append, new Uint8Array([0, 1, 2]),
                  'appended the bytes');
});

QUnit.test('runs the completion callback when updateend fires', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let updateends = 0;
  let sourceBuffer;

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];
  updater.appendBuffer(new Uint8Array([0, 1, 2]), function() {
    updateends++;
  });
  updater.appendBuffer(new Uint8Array([2, 3, 4]), function() {
    throw new Error('Wrong completion callback invoked!');
  });

  QUnit.equal(updateends, 0, 'no completions yet');
  sourceBuffer.trigger('updateend');
  QUnit.equal(updateends, 1, 'ran the completion callback');
});

QUnit.test('runs the next callback after updateend fires', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  updater.appendBuffer(new Uint8Array([0, 1, 2]));
  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];

  updater.appendBuffer(new Uint8Array([2, 3, 4]));
  QUnit.equal(sourceBuffer.updates_.length, 1, 'delayed the update');

  sourceBuffer.trigger('updateend');
  QUnit.equal(sourceBuffer.updates_.length, 2, 'updated twice');
  QUnit.deepEqual(sourceBuffer.updates_[1].append, new Uint8Array([2, 3, 4]),
                  'appended the bytes');
});

QUnit.test('runs only one callback at a time', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  updater.appendBuffer(new Uint8Array([0]));
  updater.appendBuffer(new Uint8Array([1]));
  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];

  updater.appendBuffer(new Uint8Array([2]));
  QUnit.equal(sourceBuffer.updates_.length, 1, 'queued some updates');
  QUnit.deepEqual(sourceBuffer.updates_[0].append, new Uint8Array([0]),
                  'ran the first update');

  sourceBuffer.trigger('updateend');
  QUnit.equal(sourceBuffer.updates_.length, 2, 'queued some updates');
  QUnit.deepEqual(sourceBuffer.updates_[1].append, new Uint8Array([1]),
                  'ran the second update');

  updater.appendBuffer(new Uint8Array([3]));
  sourceBuffer.trigger('updateend');
  QUnit.equal(sourceBuffer.updates_.length, 3, 'queued the updates');
  QUnit.deepEqual(sourceBuffer.updates_[2].append, new Uint8Array([2]),
                  'ran the third update');

  sourceBuffer.trigger('updateend');
  QUnit.equal(sourceBuffer.updates_.length, 4, 'finished the updates');
  QUnit.deepEqual(sourceBuffer.updates_[3].append, new Uint8Array([3]),
                  'ran the fourth update');
});

QUnit.test('runs updates immediately if possible', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];
  updater.appendBuffer(new Uint8Array([0]));
  QUnit.equal(sourceBuffer.updates_.length, 1, 'ran an update');
  QUnit.deepEqual(sourceBuffer.updates_[0].append, new Uint8Array([0]),
                  'appended the bytes');
});

QUnit.test('supports abort', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  updater.abort();
  this.mediaSource.trigger('sourceopen');

  sourceBuffer = this.mediaSource.sourceBuffers[0];
  QUnit.ok(sourceBuffer.updates_[0].abort, 'aborted the source buffer');
});

QUnit.test('supports buffered', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');

  QUnit.equal(updater.buffered().length, 0, 'buffered is empty');

  this.mediaSource.trigger('sourceopen');
  QUnit.ok(updater.buffered(), 'buffered is defined');
});

QUnit.test('supports removeBuffer', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];
  updater.remove(1, 14);

  QUnit.equal(sourceBuffer.updates_.length, 1, 'ran an update');
  QUnit.deepEqual(sourceBuffer.updates_[0].remove, [1, 14], 'removed the time range');
});

QUnit.test('supports setting duration', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];
  updater.duration(21);

  QUnit.equal(sourceBuffer.updates_.length, 1, 'ran an update');
  QUnit.deepEqual(sourceBuffer.updates_[0].duration, 21, 'changed duration');
});

QUnit.test('supports timestampOffset', function() {
  let updater = new SourceUpdater(this.mediaSource, 'video/mp2t');
  let sourceBuffer;

  this.mediaSource.trigger('sourceopen');
  sourceBuffer = this.mediaSource.sourceBuffers[0];

  QUnit.equal(updater.timestampOffset(), 0, 'intialized to zero');
  updater.timestampOffset(21);
  QUnit.equal(updater.timestampOffset(), 21, 'reflects changes immediately');
  QUnit.equal(sourceBuffer.timestampOffset, 21, 'applied the update');

  updater.appendBuffer(new Uint8Array(2));
  updater.timestampOffset(14);
  QUnit.equal(updater.timestampOffset(), 14, 'reflects changes immediately');
  QUnit.equal(sourceBuffer.timestampOffset, 21, 'queues application after updates');

  sourceBuffer.trigger('updateend');
  QUnit.equal(sourceBuffer.timestampOffset, 14, 'applied the update');
});

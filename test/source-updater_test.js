/* Tests for the SourceUpdater */
(function(window, videojs) {
  'use strict';

  var SourceUpdater = videojs.Hls.SourceUpdater;

  var mse, mediaSource;

  module('Source Updater', {
    beforeEach: function() {
      mse = videojs.useFakeMediaSource();
      mediaSource = new videojs.MediaSource();
    },
    afterEach: function() {
      mse.restore();
    }
  });

  test('waits for sourceopen to create a source buffer', function() {
    var updater;
    updater = new SourceUpdater(mediaSource, 'video/mp2t');

    equal(mediaSource.sourceBuffers.length,
          0,
          'waited to create the source buffer');

    mediaSource.trigger('sourceopen');

    equal(mediaSource.sourceBuffers.length, 1, 'created one source buffer');
    equal(mediaSource.sourceBuffers[0].mimeType_,
          'video/mp2t',
          'assigned the correct MIME type');
  });

  test('runs a callback when the source buffer is created', function() {
    var
      updater = new SourceUpdater(mediaSource, 'video/mp2t'),
      sourceBuffer;
    updater.appendBuffer(new Uint8Array([0, 1, 2]));

    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];
    equal(sourceBuffer.updates_.length, 1, 'called the source buffer once');
    deepEqual(sourceBuffer.updates_[0].append,
              new Uint8Array([0, 1, 2]),
              'appended the bytes');
  });

  test('runs the completion callback when updateend fires', function() {
    var
      updater = new SourceUpdater(mediaSource, 'video/mp2t'),
      updateends = 0,
      sourceBuffer;

    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];
    updater.appendBuffer(new Uint8Array([0, 1, 2]), function() {
      updateends++;
    });
    updater.appendBuffer(new Uint8Array([2, 3, 4]), function() {
      throw 'Wrong completion callback invoked!';
    });

    equal(updateends, 0, 'no completions yet');
    sourceBuffer.trigger('updateend');
    equal(updateends, 1, 'ran the completion callback');
  });

  test('runs the next callback after updateend fires', function() {
    var
      updater = new SourceUpdater(mediaSource, 'video/mp2t'),
      sourceBuffer;

    updater.appendBuffer(new Uint8Array([0, 1, 2]));
    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];

    updater.appendBuffer(new Uint8Array([2, 3, 4]));
    equal(sourceBuffer.updates_.length, 1, 'delayed the update');

    sourceBuffer.trigger('updateend');
    equal(sourceBuffer.updates_.length, 2, 'updated twice');
    deepEqual(sourceBuffer.updates_[1].append,
              new Uint8Array([2, 3, 4]),
              'appended the bytes');
  });

  test('runs only one callback at a time', function() {
    var
      updater = new SourceUpdater(mediaSource, 'video/mp2t'),
      sourceBuffer;

    updater.appendBuffer(new Uint8Array([0]));
    updater.appendBuffer(new Uint8Array([1]));
    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];

    updater.appendBuffer(new Uint8Array([2]));
    equal(sourceBuffer.updates_.length, 1, 'queued some updates');
    deepEqual(sourceBuffer.updates_[0].append,
              new Uint8Array([0]),
              'ran the first update');

    sourceBuffer.trigger('updateend');
    equal(sourceBuffer.updates_.length, 2, 'queued some updates');
    deepEqual(sourceBuffer.updates_[1].append,
              new Uint8Array([1]),
              'ran the second update');

    updater.appendBuffer(new Uint8Array([3]));
    sourceBuffer.trigger('updateend');
    equal(sourceBuffer.updates_.length, 3, 'queued the updates');
    deepEqual(sourceBuffer.updates_[2].append,
              new Uint8Array([2]),
              'ran the third update');

    sourceBuffer.trigger('updateend');
    equal(sourceBuffer.updates_.length, 4, 'finished the updates');
    deepEqual(sourceBuffer.updates_[3].append,
              new Uint8Array([3]),
              'ran the fourth update');
  });

  test('runs updates immediately if possible', function() {
    var
      updater = new SourceUpdater(mediaSource, 'video/mp2t'),
      sourceBuffer;

    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];
    updater.appendBuffer(new Uint8Array([0]));
    equal(sourceBuffer.updates_.length, 1, 'ran an update');
    deepEqual(sourceBuffer.updates_[0].append,
              new Uint8Array([0]),
              'appended the bytes');
  });

  test('supports buffered', function() {
    var updater = new SourceUpdater(mediaSource, 'video/mp2t');

    equal(updater.buffered().length, 0, 'buffered is empty');

    mediaSource.trigger('sourceopen');
    ok(updater.buffered(), 'buffered is defined');
  });

  test('supports removeBuffer', function() {
    var
      updater = new SourceUpdater(mediaSource, 'video/mp2t'),
      sourceBuffer;

    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];
    updater.remove(1, 14);

    equal(sourceBuffer.updates_.length, 1, 'ran an update');
    deepEqual(sourceBuffer.updates_[0].remove,
              [1, 14],
              'removed the time range');
  });

  test('supports setting duration', function() {
    var
      updater = new SourceUpdater(mediaSource, 'video/mp2t'),
      sourceBuffer;

    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];
    updater.duration(21);

    equal(sourceBuffer.updates_.length, 1, 'ran an update');
    deepEqual(sourceBuffer.updates_[0].duration, 21, 'changed duration');
  });

  test('supports timestampOffset', function() {
    var
      updater = new SourceUpdater(mediaSource, 'video/mp2t'),
      sourceBuffer;

    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];

    equal(updater.timestampOffset(), 0, 'intialized to zero');
    updater.timestampOffset(21);
    equal(updater.timestampOffset(), 21, 'reflects changes immediately');
    equal(sourceBuffer.timestampOffset, 21, 'applied the update');

    updater.appendBuffer(new Uint8Array(2));
    updater.timestampOffset(14);
    equal(updater.timestampOffset(), 14, 'reflects changes immediately');
    equal(sourceBuffer.timestampOffset, 21, 'queues application after updates');

    sourceBuffer.trigger('updateend');
    equal(sourceBuffer.timestampOffset, 14, 'applied the update');
  });

})(window, window.videojs);

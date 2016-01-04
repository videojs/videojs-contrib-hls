/* Tests for the SourceUpdater */
(function(window, videojs) {
  'use strict';

  var SourceUpdater = videojs.Hls.SourceUpdater;

  var MockSourceBuffer = videojs.extend(videojs.EventTarget, {
    constructor: function() {
      this.updates_ = [];

      this.on('updateend', function() {
        this.updating = false;
      });
    },
    appendBuffer: function(bytes) {
      this.updates_.push({
        append: bytes
      });
      this.updating = true;
    },
    remove: function(start, end) {
      this.updates_.push({
        remove: [start, end]
      });
      this.updating = true;
    },

    updateDuration: function(duration) {
      this.updates_.push({
        duration: duration
      });
    },

    updating: false
  });

  var mediaSource;

  module('SourceBuffer Updater', {
    setup: function() {
      mediaSource = new videojs.MediaSource();
      mediaSource.addSourceBuffer = function(mime) {
        var sourceBuffer = new MockSourceBuffer();
        sourceBuffer.mimeType_ = mime;
        mediaSource.sourceBuffers.push(sourceBuffer);
        return sourceBuffer;
      };
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

  test('runs a callback when updateend fires', function() {
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

  test('supports updateDuration', function() {
    var
      updater = new SourceUpdater(mediaSource, 'video/mp2t'),
      sourceBuffer;

    mediaSource.trigger('sourceopen');
    sourceBuffer = mediaSource.sourceBuffers[0];
    updater.updateDuration(21);

    equal(sourceBuffer.updates_.length, 1, 'ran an update');
    deepEqual(sourceBuffer.updates_[0].duration, 21, 'changed duration');
  });

})(window, window.videojs);

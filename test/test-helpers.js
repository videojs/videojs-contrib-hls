(function(window, videojs) {
  'use strict';

  // a SourceBuffer that tracks updates but otherwise is a noop
  var MockSourceBuffer = videojs.extend(videojs.EventTarget, {
    constructor: function() {
      this.updates_ = [];

      this.on('updateend', function() {
        this.updating = false;
      });
      this.buffered = videojs.createTimeRanges();

      this.duration_ = NaN;
      Object.defineProperty(this, 'duration', {
        get: function() {
          return this.duration_;
        },
        set: function(duration) {
          this.updates_.push({
            duration: duration
          });
          this.duration_ = duration;
          this.updating = true;
        }
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

    updating: false
  });

  videojs.useFakeMediaSource = function() {
    var RealMediaSource = videojs.MediaSource;

    videojs.MediaSource = function() {
      var mediaSource = new RealMediaSource();
      mediaSource.addSourceBuffer = function(mime) {
        var sourceBuffer = new MockSourceBuffer();
        sourceBuffer.mimeType_ = mime;
        mediaSource.sourceBuffers.push(sourceBuffer);
        return sourceBuffer;
      };
      return mediaSource;
    };
    videojs.MediaSource.supportsNativeMediaSources = RealMediaSource.supportsNativeMediaSources;

    return {
      restore: function() {
        videojs.MediaSource = RealMediaSource;
      }
    };
  };

})(window, window.videojs);

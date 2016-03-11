import videojs from 'video.js';

// a SourceBuffer that tracks updates but otherwise is a noop
class MockSourceBuffer extends videojs.EventTarget {
  constructor() {
    super();
    this.updates_ = [];

    this.updating = false;
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
  }

  appendBuffer(bytes) {
    this.updates_.push({
      append: bytes
    });
    this.updating = true;
  }

  remove(start, end) {
    this.updates_.push({
      remove: [start, end]
    });
    this.updating = true;
  }
}

export const useFakeMediaSource = function() {
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

let clock, xhr, requests;
export const useFakeEnvironment = function() {
  clock = sinon.useFakeTimers();
  xhr = sinon.useFakeXMLHttpRequest();
  videojs.xhr.XMLHttpRequest = xhr;
  requests = [];
  xhr.onCreate = function(xhr) {
    requests.push(xhr);
  };
  return {
    clock: clock,
    requests: requests,
    restore: videojs.restoreEnvironment
  };
};
export const restoreEnvironment = function() {
  clock.restore();
  videojs.xhr.XMLHttpRequest = window.XMLHttpRequest;
  xhr.restore();
};

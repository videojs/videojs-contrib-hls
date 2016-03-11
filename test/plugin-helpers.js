import sinon from 'sinon';
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
      get() {
        return this.duration_;
      },
      set(duration) {
        this.updates_.push({
          duration
        });
        this.duration_ = duration;
        this.updating = true;
      }
    });
  }

  abort() {
    this.updates_.push({
      abort: true
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

class MockMediaSource extends videojs.EventTarget {
  constructor() {
    super();
    this.readyState = 'closed';
    this.on('sourceopen', function() {
      this.readyState = 'open';
    });

    this.sourceBuffers = [];
    this.duration = NaN;
  }

  addSeekableRange_() {}

  addSourceBuffer(mime) {
    let sourceBuffer = new MockSourceBuffer();

    sourceBuffer.mimeType_ = mime;
    this.sourceBuffers.push(sourceBuffer);
    return sourceBuffer;
  }

  endOfStream() {
    this.readyState = 'closed';
  }
}

export const useFakeMediaSource = function() {
  let RealMediaSource = videojs.MediaSource;
  let realCreateObjectURL = window.URL.createObjectURL;
  let id = 0;

  videojs.MediaSource = MockMediaSource;
  videojs.MediaSource.supportsNativeMediaSources =
    RealMediaSource.supportsNativeMediaSources;
  videojs.URL.createObjectURL = function() {
    id++;
    return 'blob:videojs-contrib-hls-mock-url' + id;
  };

  return {
    restore() {
      videojs.MediaSource = RealMediaSource;
      videojs.URL.createObjectURL = realCreateObjectURL;
    }
  };
};

let fakeEnvironment = {
  requests: [],
  restore() {
    this.clock.restore();
    videojs.xhr.XMLHttpRequest = window.XMLHttpRequest;
    this.xhr.restore();
  }
};

export const useFakeEnvironment = function() {
  fakeEnvironment.clock = sinon.useFakeTimers();

  fakeEnvironment.xhr = sinon.useFakeXMLHttpRequest();
  fakeEnvironment.requests.length = 0;
  fakeEnvironment.xhr.onCreate = function(xhr) {
    fakeEnvironment.requests.push(xhr);
  };
  videojs.xhr.XMLHttpRequest = fakeEnvironment.xhr;

  return fakeEnvironment;
};

import document from 'global/document';
import sinon from 'sinon';
import videojs from 'video.js';
/* eslint-disable no-unused-vars */
// needed so MediaSource can be registered with videojs
import MediaSource from 'videojs-contrib-media-sources';
/* eslint-enable */
import testDataManifests from './test-manifests.js';

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

// patch over some methods of the provided tech so it can be tested
// synchronously with sinon's fake timers
export const mockTech = function(tech) {
  if (tech.isMocked_) {
    // make this function idempotent because HTML and Flash based
    // playback have very different lifecycles. For HTML, the tech
    // is available on player creation. For Flash, the tech isn't
    // ready until the source has been loaded and one tick has
    // expired.
    return;
  }

  tech.isMocked_ = true;
  tech.src_ = null;
  tech.time_ = null;

  tech.paused_ = !tech.autoplay();
  tech.paused = function() {
    return tech.paused_;
  };

  if (!tech.currentTime_) {
    tech.currentTime_ = tech.currentTime;
  }
  tech.currentTime = function() {
    return tech.time_ === null ? tech.currentTime_() : tech.time_;
  };

  tech.setSrc = function(src) {
    tech.src_ = src;
  };
  tech.src = function(src) {
    if (src !== null) {
      return tech.setSrc(src);
    }
    return tech.src_ === null ? tech.src : tech.src_;
  };
  tech.currentSrc_ = tech.currentSrc;
  tech.currentSrc = function() {
    return tech.src_ === null ? tech.currentSrc_() : tech.src_;
  };

  tech.play_ = tech.play;
  tech.play = function() {
    tech.play_();
    tech.paused_ = false;
    tech.trigger('play');
  };
  tech.pause_ = tech.pause_;
  tech.pause = function() {
    tech.pause_();
    tech.paused_ = true;
    tech.trigger('pause');
  };

  tech.setCurrentTime = function(time) {
    tech.time_ = time;

    setTimeout(function() {
      tech.trigger('seeking');
      setTimeout(function() {
        tech.trigger('seeked');
      }, 1);
    }, 1);
  };
};

export const createPlayer = function(options) {
  let video;
  let player;

  video = document.createElement('video');
  video.className = 'video-js';
  document.querySelector('#qunit-fixture').appendChild(video);
  player = videojs(video, options || {
    flash: {
      swf: ''
    }
  });

  player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  mockTech(player.tech_);

  return player;
};

export const openMediaSource = function(player, clock) {
  // ensure the Flash tech is ready
  player.tech_.triggerReady();
  clock.tick(1);
  // mock the tech *after* it has finished loading so that we don't
  // mock a tech that will be unloaded on the next tick
  mockTech(player.tech_);

  // simulate the sourceopen event
  player.tech_.hls.mediaSource.readyState = 'open';
  player.tech_.hls.mediaSource.dispatchEvent({
    type: 'sourceopen',
    swfId: player.tech_.el().id
  });
};

export const standardXHRResponse = function(request) {
  if (!request.url) {
    return;
  }

  let contentType = 'application/json';
  // contents off the global object
  let manifestName = (/(?:.*\/)?(.*)\.m3u8/).exec(request.url);

  if (manifestName) {
    manifestName = manifestName[1];
  } else {
    manifestName = request.url;
  }

  if (/\.m3u8?/.test(request.url)) {
    contentType = 'application/vnd.apple.mpegurl';
  } else if (/\.ts/.test(request.url)) {
    contentType = 'video/MP2T';
  }

  request.response = new Uint8Array(16).buffer;
  request.respond(200, { 'Content-Type': contentType },
                  testDataManifests[manifestName]);
};

// return an absolute version of a page-relative URL
export const absoluteUrl = function(relativeUrl) {
  return window.location.protocol + '//' +
    window.location.host +
    (window.location.pathname
        .split('/')
        .slice(0, -1)
        .concat(relativeUrl)
        .join('/')
    );
};

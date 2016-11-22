import document from 'global/document';
import sinon from 'sinon';
import videojs from 'video.js';
/* eslint-disable no-unused-vars */
// needed so MediaSource can be registered with videojs
import MediaSource from 'videojs-contrib-media-sources';
/* eslint-enable */
import testDataManifests from './test-manifests.js';
import xhrFactory from '../src/xhr';
import window from 'global/window';

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
    this.seekable = videojs.createTimeRange();
  }

  addSeekableRange_(start, end) {
    this.seekable = videojs.createTimeRange(start, end);
  }

  addSourceBuffer(mime) {
    let sourceBuffer = new MockSourceBuffer();

    sourceBuffer.mimeType_ = mime;
    this.sourceBuffers.push(sourceBuffer);
    return sourceBuffer;
  }

  endOfStream(error) {
    this.readyState = 'closed';
    this.error_ = error;
  }
}

export const useFakeMediaSource = function() {
  let RealMediaSource = videojs.MediaSource;
  let realCreateObjectURL = videojs.URL.createObjectURL;
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

export const useFakeEnvironment = function(assert) {
  let realXMLHttpRequest = videojs.xhr.XMLHttpRequest;

  let fakeEnvironment = {
    requests: [],
    restore() {
      this.clock.restore();
      videojs.xhr.XMLHttpRequest = realXMLHttpRequest;
      this.xhr.restore();
      ['warn', 'error'].forEach((level) => {
        if (this.log && this.log[level] && this.log[level].restore) {
          if (assert) {
            let calls = this.log[level].args.map((args) => {
              return args.join(', ');
            }).join('\n  ');

            assert.equal(this.log[level].callCount,
                        0,
                        'no unexpected logs at level "' + level + '":\n  ' + calls);
          }
          this.log[level].restore();
        }
      });
    }
  };

  fakeEnvironment.log = {};
  ['warn', 'error'].forEach((level) => {
    // you can use .log[level].args to get args
    sinon.stub(videojs.log, level);
    fakeEnvironment.log[level] = videojs.log[level];
    Object.defineProperty(videojs.log[level], 'calls', {
      get() {
        // reset callCount to 0 so they don't have to
        let callCount = this.callCount;

        this.callCount = 0;
        return callCount;
      }
    });
  });
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
  tech.pause_ = tech.pause;
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
  player.tech_.hls.xhr = xhrFactory();

  // simulate the sourceopen event
  player.tech_.hls.mediaSource.readyState = 'open';
  player.tech_.hls.mediaSource.dispatchEvent({
    type: 'sourceopen',
    swfId: player.tech_.el().id
  });
};

export const standardXHRResponse = function(request, data) {
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

  if (!data) {
    data = testDataManifests[manifestName];
  }

  request.response = new Uint8Array(1024).buffer;
  request.respond(200, {'Content-Type': contentType}, data);
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

export const playlistWithDuration = function(time, conf) {
  let result = {
    targetDuration: 10,
    mediaSequence: conf && conf.mediaSequence ? conf.mediaSequence : 0,
    discontinuityStarts: [],
    segments: [],
    endList: true
  };
  let count = Math.floor(time / 10);
  let remainder = time % 10;
  let i;
  let isEncrypted = conf && conf.isEncrypted;

  for (i = 0; i < count; i++) {
    result.segments.push({
      uri: i + '.ts',
      resolvedUri: i + '.ts',
      duration: 10
    });
    if (isEncrypted) {
      result.segments[i].key = {
        uri: i + '-key.php',
        resolvedUri: i + '-key.php'
      };
    }
  }
  if (remainder) {
    result.segments.push({
      uri: i + '.ts',
      duration: remainder
    });
  }
  return result;
};

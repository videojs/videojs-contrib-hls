import document from 'global/document';
import videojs from 'video.js';
import testDataManifests from './manifests.js';

// patch over some methods of the provided tech so it can be tested
// synchronously with sinon's fake timers
let Helper = {
  mockTech(tech) {
    if (tech.isMocked_) {
      // make this function idempotent because HTML and Flash based
      // playback have very different lifecycles. For HTML, the tech
      // is available on player creation. For Flash, the tech isn't
      // ready until the source has been loaded and one tick has
      // expired.
      return;
    }

    tech.isMocked_ = true;

    tech.hls = tech.hls;
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
  },
  createPlayer(options) {
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
    Helper.mockTech(player.tech_);

    return player;
  },

  openMediaSource(player, clock) {
    Helper.mockTech(player.tech_);

    // ensure the Flash tech is ready
    player.tech_.triggerReady();
    clock.tick(1);

    // simulate the sourceopen event
    player.tech_.hls.mediaSource.readyState = 'open';
    player.tech_.hls.mediaSource.dispatchEvent({
      type: 'sourceopen',
      swfId: player.tech_.el().id
    });
  },

  standardXHRResponse(request) {
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
    request.respond(
      200,
      { 'Content-Type': contentType },
      testDataManifests[manifestName]
    );
  },

  // do a shallow copy of the properties of source onto the target object
  merge(target, source) {
    let name;

    for (name in source) {
      target[name] = source[name];
    }
  },

  // return an absolute version of a page-relative URL
  absoluteUrl(relativeUrl) {
    return window.location.protocol + '//' +
      window.location.host +
      (window.location.pathname
          .split('/')
          .slice(0, -1)
          .concat(relativeUrl)
          .join('/')
      );
  },
  // a no-op MediaSource implementation to allow synchronous testing
  MockMediaSource: videojs.extend(videojs.EventTarget, {
    constructor() {},
    duration: NaN,
    seekable: videojs.createTimeRange(),
    addSeekableRange_(start, end) {
      this.seekable = videojs.createTimeRange(start, end);
    },
    addSourceBuffer() {
      return new (videojs.extend(videojs.EventTarget, {
        constructor() {},
        abort() {},
        buffered: videojs.createTimeRange(),
        appendBuffer() {},
        remove() {}
      }))();
    },
    // endOfStream triggers an exception if flash isn't available
    endOfStream(error) {
      this.error_ = error;
    }
  }),
  URL: {
    createObjectURL() {
      return 'blob:mock-vjs-object-url';
    }
  },
  testDataManifests
};

Helper.MockMediaSource.open = function() {};
export default Helper;


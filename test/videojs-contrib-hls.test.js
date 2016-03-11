/* eslint-disable max-len */

import document from 'global/document';
import videojs from 'video.js';
import sinon from 'sinon';
import QUnit from 'qunit';
import testDataManifests from './test-manifests.js';
/* eslint-disable no-unused-vars */
// we need this so that it can register hls with videojs
import Hls from '../src/videojs-contrib-hls';
/* eslint-enable no-unused-vars */

const Flash = videojs.getComponent('Flash');
let nextId = 0;

// patch over some methods of the provided tech so it can be tested
// synchronously with sinon's fake timers
const mockTech = function(tech) {
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

const createPlayer = function(options) {
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

const openMediaSource = function(player, clock) {
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

const standardXHRResponse = function(request) {
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

// do a shallow copy of the properties of source onto the target object
const merge = function(target, source) {
  let name;

  for (name in source) {
    target[name] = source[name];
  }
};

// return an absolute version of a page-relative URL
const absoluteUrl = function(relativeUrl) {
  return window.location.protocol + '//' +
    window.location.host +
    (window.location.pathname
        .split('/')
        .slice(0, -1)
        .concat(relativeUrl)
        .join('/')
    );
};

// a no-op MediaSource implementation to allow synchronous testing
class MockMediaSource extends videojs.EventTarget {
  static open() {}

  constructor() {
    super();
    this.duration = NaN;
    this.seekable = videojs.createTimeRange();
    this.mediaSource_ = {
      // Mock a fake sourceBuffer array because of an IE11 work-around
      // in `filterBufferedRanges`
      sourceBuffers: ['fake']
    };
  }
  addSeekableRange_(start, end) {
    this.seekable = videojs.createTimeRange(start, end);
  }
  addSourceBuffer() {
    return new (videojs.extend(videojs.EventTarget, {
      constructor() {},
      abort() {},
      buffered: videojs.createTimeRange(),
      appendBuffer() {},
      remove() {}
    }))();
  }
  // endOfStream triggers an exception if flash isn't available
  endOfStream(error) {
    this.error_ = error;
  }
}
const URL = {
  createObjectURL() {
    return 'blob:mock-vjs-object-url';
  }
};

QUnit.module('HLS -', {
  beforeEach() {
    this.old = {};

    // Mock Media Sources
    this.old.MediaSource = videojs.MediaSource;
    videojs.MediaSource = MockMediaSource;
    this.old.URL = videojs.URL;
    videojs.URL = URL;

    // mock out Flash features for phantomjs
    this.old.Flash = videojs.mergeOptions({}, Flash);
    /* eslint-disable camelcase */
    Flash.embed = function(swf, flashVars) {
      let el = document.createElement('div');

      el.id = 'vjs_mock_flash_' + nextId++;
      el.className = 'vjs-tech vjs-mock-flash';
      el.duration = Infinity;
      el.vjs_load = function() {};
      el.vjs_getProperty = function(attr) {
        if (attr === 'buffered') {
          return [[0, 0]];
        }
        return el[attr];
      };
      el.vjs_setProperty = function(attr, value) {
        el[attr] = value;
      };
      el.vjs_src = function() {};
      el.vjs_play = function() {};
      el.vjs_discontinuity = function() {};

      if (flashVars.autoplay) {
        el.autoplay = true;
      }
      if (flashVars.preload) {
        el.preload = flashVars.preload;
      }

      el.currentTime = 0;

      return el;
    };
    /* eslint-enable camelcase */
    this.old.FlashSupported = Flash.isSupported;
    Flash.isSupported = function() {
      return true;
    };

    // Fake sourcebuffer
    this.old.SourceBuffer = window.videojs.SourceBuffer;
    window.videojs.SourceBuffer = function() {
      this.appendBuffer = function() {};
      this.abort = function() {};
    };

    // store functionality that some tests need to mock
    this.old.GlobalOptions = videojs.mergeOptions(videojs.options);

    // force the HLS tech to run
    this.old.NativeHlsSupport = videojs.Hls.supportsNativeHls;
    videojs.Hls.supportsNativeHls = false;

    this.old.Decrypt = videojs.Hls.Decrypter;
    videojs.Hls.Decrypter = function() {};

    // fake XHRs
    this.old.XHR = videojs.xhr.XMLHttpRequest;
    this.sinonXHR = sinon.useFakeXMLHttpRequest();
    this.requests = [];
    this.sinonXHR.onCreate = (xhr) => {
      // force the XHR2 timeout polyfill
      xhr.timeout = null;
      this.requests.push(xhr);
    };
    videojs.xhr.XMLHttpRequest = this.sinonXHR;

    // Mock the environment's timers because certain things - particularly
    // player readiness - are asynchronous in video.js 5.
    this.clock = sinon.useFakeTimers();

    // setup a player
    this.player = createPlayer();
  },

  afterEach() {
    videojs.MediaSource = this.old.MediaSource;
    videojs.URL = this.old.URL;

    merge(videojs.options, this.old.GlobalOptions);
    Flash.isSupported = this.old.FlashSupported;
    merge(Flash, this.old.Flash);

    videojs.Hls.supportsNativeHls = this.old.NativeHlsSupport;
    videojs.Hls.Decrypter = this.old.Decrypt;
    videojs.SourceBuffer = this.old.SourceBuffer;

    this.player.dispose();

    this.sinonXHR.restore();
    videojs.xhr.XMLHttpRequest = this.old.XHR;
    this.clock.restore();
  }
});

QUnit.test('starts playing if autoplay is specified', function() {
  let plays = 0;

  this.player.autoplay(true);
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  // REMOVEME workaround https://github.com/videojs/video.js/issues/2326
  this.player.tech_.triggerReady();
  this.clock.tick(1);

  // make sure play() is called *after* the media source opens
  this.player.tech_.hls.play = function() {
    plays++;
  };
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);
  QUnit.strictEqual(1, plays, 'play was called');
});

QUnit.test('XHR requests first byte range on play', function() {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.trigger('play');
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests[0]);
  QUnit.equal(this.requests[1].headers.Range, 'bytes=0-522827');
});

QUnit.test('Seeking requests correct byte range', function() {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.trigger('play');
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests[0]);
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  this.clock.tick(1);
  this.player.currentTime(40);
  this.clock.tick(1);
  QUnit.equal(this.requests[2].headers.Range, 'bytes=2299992-2835603');
});

QUnit.test('if buffered, will request second segment byte range', function() {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  this.player.tech_.trigger('play');
  openMediaSource(this.player, this.clock);
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };
  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  this.player.tech_.hls.checkBuffer_();
  this.clock.tick(100);
  QUnit.equal(this.requests[2].headers.Range, 'bytes=1823412-2299991');
});

QUnit.test('autoplay seeks to the live point after playlist load', function() {
  let currentTime = 0;

  this.player.autoplay(true);
  this.player.on('seeking', () => {
    currentTime = this.player.currentTime();
  });
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.readyState = function() {
    return 1;
  };
  this.player.tech_.trigger('play');
  standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  QUnit.notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test('autoplay seeks to the live point after media source open', function() {
  let currentTime = 0;

  this.player.autoplay(true);
  this.player.on('seeking', () => {
    currentTime = this.player.currentTime();
  });
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.readyState = function() {
    return 1;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  QUnit.notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test('duration is set when the source opens after the playlist is loaded', function() {
  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);

  QUnit.equal(this.player.tech_.hls.mediaSource.duration,
              40,
              'set the duration');
});

QUnit.test('calls `remove` based on seekable when loading a live segment', function() {
  let removes = [];
  let seekable = videojs.createTimeRanges([[60, 120]]);

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.seekable = function() {
    return seekable;
  };

  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.mediaSource.addSourceBuffer = function() {
    return new (videojs.extend(videojs.EventTarget, {
      constructor() {},
      abort() {},
      buffered: videojs.createTimeRange(),
      appendBuffer() {},
      remove(start, end) {
        removes.push([start, end]);
      }
    }))();
  };
  this.player.tech_.hls.bandwidth = 20e10;
  this.player.tech_.triggerReady();
  standardXHRResponse(this.requests[0]);

  this.player.tech_.hls.playlists.trigger('loadedmetadata');
  this.player.tech_.trigger('canplay');
  this.player.tech_.paused = function() {
    return false;
  };
  this.player.tech_.readyState = function() {
    return 1;
  };
  this.player.tech_.trigger('play');

  this.clock.tick(1);
  standardXHRResponse(this.requests[1]);

  QUnit.strictEqual(this.requests[0].url,
                    'liveStart30sBefore.m3u8',
                    'master playlist requested');
  QUnit.equal(removes.length, 1, 'remove called');
  QUnit.deepEqual(removes[0],
                  [0, seekable.start(0)],
                  'remove called with the right range');
});

QUnit.test('calls `remove` based on currentTime when loading a live segment ' +
           'if seekable start is after currentTime', function() {
  let removes = [];
  let seekable = videojs.createTimeRanges([[0, 80]]);

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.seekable = function() {
    return seekable;
  };

  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.mediaSource.addSourceBuffer = function() {
    return new (videojs.extend(videojs.EventTarget, {
      constructor() {},
      abort() {},
      buffered: videojs.createTimeRange(),
      appendBuffer() {},
      remove(start, end) {
        removes.push([start, end]);
      }
    }))();
  };
  this.player.tech_.hls.bandwidth = 20e10;
  this.player.tech_.triggerReady();
  standardXHRResponse(this.requests[0]);
  this.player.tech_.hls.playlists.trigger('loadedmetadata');
  this.player.tech_.trigger('canplay');

  this.player.tech_.paused = function() {
    return false;
  };

  this.player.tech_.readyState = function() {
    return 1;
  };

  this.player.tech_.trigger('play');
  this.clock.tick(1);
  // Change seekable so that it starts *after* the currentTime which was set
  // based on the previous seekable range (the end of 80)
  seekable = videojs.createTimeRanges([[100, 120]]);
  standardXHRResponse(this.requests[1]);

  QUnit.strictEqual(this.requests[0].url, 'liveStart30sBefore.m3u8', 'master playlist requested');
  QUnit.equal(removes.length, 1, 'remove called');
  QUnit.deepEqual(removes[0], [0, 80 - 60], 'remove called with the right range');
});

QUnit.test('calls `remove` based on currentTime when loading a vod segment', function() {
  let removes = [];

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.mediaSource.addSourceBuffer = function() {
    return new (videojs.extend(videojs.EventTarget, {
      constructor() {},
      abort() {},
      buffered: videojs.createTimeRange(),
      appendBuffer() {},
      remove(start, end) {
        removes.push([start, end]);
      }
    }))();
  };
  this.player.tech_.hls.bandwidth = 20e10;
  standardXHRResponse(this.requests[0]);
  this.player.currentTime(120);
  standardXHRResponse(this.requests[1]);
  standardXHRResponse(this.requests[2]);

  QUnit.strictEqual(this.requests[0].url,
                    'manifest/master.m3u8',
                    'master playlist requested');
  QUnit.strictEqual(absoluteUrl('manifest/media2.m3u8'),
                    this.requests[1].url,
                    'media playlist requested');
  QUnit.equal(removes.length, 1, 'remove called');
  QUnit.deepEqual(removes[0], [0, 120 - 60], 'remove called with the right range');
});

QUnit.test('codecs are passed to the source buffer', function() {
  let codecs = [];

  this.player.src({
    src: 'custom-codecs.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.mediaSource.addSourceBuffer = function(codec) {
    codecs.push(codec);
  };

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:CODECS="video, audio"\n' +
                                'media.m3u8\n');
  standardXHRResponse(this.requests.shift());
  QUnit.equal(codecs.length, 1, 'created a source buffer');
  QUnit.equal(codecs[0], 'video/mp2t; codecs="video, audio"', 'specified the codecs');
});

QUnit.test('including HLS as a tech does not error', function() {
  let player = createPlayer({
    techOrder: ['hls', 'html5']
  });

  QUnit.ok(player, 'created the player');
});

// Warns: 'player.hls is deprecated. Use player.tech.hls instead.'
QUnit.test('creates a PlaylistLoader on init', function() {
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  QUnit.equal(this.requests[0].aborted, true, 'aborted previous src');
  standardXHRResponse(this.requests[1]);
  QUnit.ok(this.player.tech_.hls.playlists.master,
           'set the master playlist');
  QUnit.ok(this.player.tech_.hls.playlists.media(),
           'set the media playlist');
  QUnit.ok(this.player.tech_.hls.playlists.media().segments,
           'the segment entries are parsed');
  QUnit.strictEqual(this.player.tech_.hls.playlists.master.playlists[0],
                    this.player.tech_.hls.playlists.media(),
                    'the playlist is selected');
});

QUnit.test('re-initializes the playlist loader when switching sources', function() {
  // source is set
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  // loader gets media playlist
  standardXHRResponse(this.requests.shift());
  // request a segment
  standardXHRResponse(this.requests.shift());
  // change the source
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  // maybe not needed if https://github.com/videojs/video.js/issues/2326 gets fixed
  this.clock.tick(1);
  QUnit.ok(!this.player.tech_.hls.playlists.media(), 'no media playlist');
  QUnit.equal(this.player.tech_.hls.playlists.state,
              'HAVE_NOTHING',
              'reset the playlist loader state');
  QUnit.equal(this.requests.length, 1, 'requested the new src');

  // buffer check
  this.player.tech_.hls.checkBuffer_();
  QUnit.equal(this.requests.length, 1, 'did not request a stale segment');

  // sourceopen
  openMediaSource(this.player, this.clock);

  QUnit.equal(this.requests.length, 1, 'made one request');
  QUnit.ok(this.requests[0].url.indexOf('master.m3u8') >= 0,
           'requested only the new playlist');
});

QUnit.test('sets the duration if one is available on the playlist', function() {
  let events = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.on('durationchange', function() {
    events++;
  });

  standardXHRResponse(this.requests[0]);
  QUnit.equal(this.player.tech_.hls.mediaSource.duration,
              40,
              'set the duration');
  QUnit.equal(events, 1, 'durationchange is fired');
});

QUnit.test('estimates individual segment durations if needed', function() {
  let changes = 0;

  this.player.src({
    src: 'http://example.com/manifest/missingExtinf.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.mediaSource.duration = NaN;
  this.player.tech_.on('durationchange', function() {
    changes++;
  });

  standardXHRResponse(this.requests[0]);
  QUnit.strictEqual(this.player.tech_.hls.mediaSource.duration,
                    this.player.tech_.hls.playlists.media().segments.length * 10,
                    'duration is updated');
  QUnit.strictEqual(changes, 1, 'one durationchange fired');
});

QUnit.test('translates seekable by the starting time for live playlists', function() {
  let seekable;

  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:15\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXTINF:10,\n' +
                                '2.ts\n' +
                                '#EXTINF:10,\n' +
                                '3.ts\n');

  seekable = this.player.seekable();
  QUnit.equal(seekable.length, 1, 'one seekable range');
  QUnit.equal(seekable.start(0), 0, 'the earliest possible position is at zero');
  QUnit.equal(seekable.end(0), 10, 'end is relative to the start');
});

QUnit.test('starts downloading a segment on loadedmetadata', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  QUnit.strictEqual(this.requests[1].url,
                    absoluteUrl('manifest/media-00001.ts'),
                    'the first segment is requested');
});

QUnit.test('always returns an empty buffered region when there are no SourceBuffers', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.buffered = function() {
    return videojs.createTimeRanges([[0, 10]]);
  };
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  this.player.currentTime(3);
  this.clock.tick(1);

  QUnit.equal(this.player.tech_.hls.findBufferedRange_().end(0),
              10,
              'inside the first buffered region');

  // Simulate the condition with no source buffers
  this.player.hls.mediaSource.mediaSource_.sourceBuffers = [];

  QUnit.equal(this.player.tech_.hls.findBufferedRange_().length,
              0,
              'empty TimeRanges returned');

   // Simulate the condition with no media source
   this.player.hls.mediaSource.mediaSource_ = undefined;

   QUnit.equal(this.player.tech_.hls.findBufferedRange_().length,
              0,
              'empty TimeRanges returned');
});

QUnit.test('finds the correct buffered region based on currentTime', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.buffered = function() {
    return videojs.createTimeRanges([[0, 5], [6, 12]]);
  };
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  this.player.currentTime(3);
  this.clock.tick(1);
  QUnit.equal(this.player.tech_.hls.findBufferedRange_().end(0),
              5,
              'inside the first buffered region');
  this.player.currentTime(6);
  this.clock.tick(1);
  QUnit.equal(this.player.tech_.hls.findBufferedRange_().end(0),
              12,
              'inside the second buffered region');
});

QUnit.test('recognizes absolute URIs and requests them unmodified', function() {
  this.player.src({
    src: 'manifest/absoluteUris.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  QUnit.strictEqual(this.requests[1].url,
                    'http://example.com/00001.ts',
                    'the first segment is requested');
});

QUnit.test('recognizes domain-relative URLs', function() {
  this.player.src({
    src: 'manifest/domainUris.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  QUnit.strictEqual(this.requests[1].url,
                    window.location.protocol + '//' + window.location.host +
                    '/00001.ts',
                    'the first segment is requested');
});

QUnit.test('re-initializes the handler for each source', function() {
  let firstPlaylists;
  let secondPlaylists;
  let firstMSE;
  let secondMSE;
  let aborts = 0;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  firstPlaylists = this.player.tech_.hls.playlists;
  firstMSE = this.player.tech_.hls.mediaSource;
  standardXHRResponse(this.requests.shift());
  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.sourceBuffer.abort = function() {
    aborts++;
  };

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  secondPlaylists = this.player.tech_.hls.playlists;
  secondMSE = this.player.tech_.hls.mediaSource;

  QUnit.equal(1, aborts, 'aborted the old source buffer');
  QUnit.ok(this.requests[0].aborted, 'aborted the old segment request');
  QUnit.notStrictEqual(firstPlaylists,
                       secondPlaylists,
                       'the playlist object is not reused');
  QUnit.notStrictEqual(firstMSE, secondMSE, 'the media source object is not reused');
});

QUnit.test('triggers an error when a master playlist request errors', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.requests.pop().respond(500);

  QUnit.equal(this.player.tech_.hls.mediaSource.error_,
              'network',
              'a network error is triggered');
});

QUnit.test('downloads media playlists after loading the master', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 20e10;
  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  standardXHRResponse(this.requests[2]);

  QUnit.strictEqual(this.requests[0].url,
                    'manifest/master.m3u8',
                    'master playlist requested');
  QUnit.strictEqual(this.requests[1].url,
                    absoluteUrl('manifest/media2.m3u8'),
                    'media playlist requested');
  QUnit.strictEqual(this.requests[2].url,
                    absoluteUrl('manifest/media2-00001.ts'),
                    'first segment requested');
});

QUnit.test('upshifts if the initial bandwidth hint is high', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 10e20;
  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  standardXHRResponse(this.requests[2]);

  QUnit.strictEqual(this.requests[0].url,
                    'manifest/master.m3u8',
                    'master playlist requested');
  QUnit.strictEqual(this.requests[1].url,
                    absoluteUrl('manifest/media2.m3u8'),
                    'media playlist requested');
  QUnit.strictEqual(this.requests[2].url,
                    absoluteUrl('manifest/media2-00001.ts'),
                    'first segment requested');
});

QUnit.test('downshifts if the initial bandwidth hint is low', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 100;
  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  standardXHRResponse(this.requests[2]);

  QUnit.strictEqual(this.requests[0].url,
                    'manifest/master.m3u8',
                    'master playlist requested');
  QUnit.strictEqual(this.requests[1].url,
                    absoluteUrl('manifest/media1.m3u8'),
                    'media playlist requested');
  QUnit.strictEqual(this.requests[2].url,
                    absoluteUrl('manifest/media1-00001.ts'),
                    'first segment requested');
});

QUnit.test('starts checking the buffer on init', function() {
  let player;
  let fills = 0;
  let drains = 0;

  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player, this.clock);

  // wait long enough for the buffer check interval to expire and
  // trigger fill/drainBuffer
  player.tech_.hls.fillBuffer = function() {
    fills++;
  };
  player.tech_.hls.drainBuffer = function() {
    drains++;
  };
  this.clock.tick(500);
  QUnit.equal(fills, 1, 'called fillBuffer');
  QUnit.equal(drains, 1, 'called drainBuffer');

  player.dispose();
  this.clock.tick(100 * 1000);
  QUnit.equal(fills, 1, 'did not call fillBuffer again');
  QUnit.equal(drains, 1, 'did not call drainBuffer again');
});

QUnit.test('buffer checks are noops until a media playlist is ready', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.checkBuffer_();

  QUnit.strictEqual(1, this.requests.length, 'one request was made');
  QUnit.strictEqual(this.requests[0].url,
                    'manifest/media.m3u8',
                    'media playlist requested');
});

QUnit.test('buffer checks are noops when only the master is ready', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());
  // ignore any outstanding segment requests
  this.requests.length = 0;

  // load in a new playlist which will cause playlists.media() to be
  // undefined while it is being fetched
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  // respond with the master playlist but don't send the media playlist yet
  // force media1 to be requested
  this.player.tech_.hls.bandwidth = 1;
  // master
  standardXHRResponse(this.requests.shift());
  // trigger fillBuffer()
  this.player.tech_.hls.checkBuffer_();

  QUnit.strictEqual(1, this.requests.length, 'one request was made');
  QUnit.strictEqual(this.requests[0].url,
                    absoluteUrl('manifest/media1.m3u8'),
                    'media playlist requested');
});

QUnit.test('calculates the bandwidth after downloading a segment', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests[0]);

  // set the request time to be a bit earlier so our bandwidth calculations are not NaN
  this.requests[1].requestTime = (new Date()) - 100;

  standardXHRResponse(this.requests[1]);

  QUnit.ok(this.player.tech_.hls.bandwidth, 'bandwidth is calculated');
  QUnit.ok(this.player.tech_.hls.bandwidth > 0,
           'bandwidth is positive: ' + this.player.tech_.hls.bandwidth);
  QUnit.ok(this.player.tech_.hls.segmentXhrTime >= 0,
           'saves segment request time: ' + this.player.tech_.hls.segmentXhrTime + 's');
});

QUnit.test('fires a progress event after downloading a segment', function() {
  let progressCount = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests.shift());
  this.player.on('progress', function() {
    progressCount++;
  });
  standardXHRResponse(this.requests.shift());
  QUnit.equal(progressCount, 1, 'fired a progress event');
});

QUnit.test('selects a playlist after segment downloads', function() {
  let calls = 0;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.selectPlaylist = () => {
    calls++;
    return this.player.tech_.hls.playlists.master.playlists[0];
  };

  // master
  standardXHRResponse(this.requests[0]);
  // media
  standardXHRResponse(this.requests[1]);
  // segment
  standardXHRResponse(this.requests[2]);

  QUnit.strictEqual(calls, 2, 'selects after the initial segment');
  this.player.currentTime = function() {
    return 1;
  };
  this.player.buffered = function() {
    return videojs.createTimeRange(0, 2);
  };
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  this.player.tech_.hls.checkBuffer_();

  standardXHRResponse(this.requests[3]);

  QUnit.strictEqual(calls, 3, 'selects after additional segments');
});

QUnit.test('updates the duration after switching playlists', function() {
  let selectedPlaylist = false;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e20;
  // master
  standardXHRResponse(this.requests[0]);
  // media3
  standardXHRResponse(this.requests[1]);

  this.player.tech_.hls.selectPlaylist = () => {
    selectedPlaylist = true;

    // this duration should be overwritten by the playlist change
    this.player.tech_.hls.mediaSource.duration = -Infinity;

    return this.player.tech_.hls.playlists.master.playlists[1];
  };

  // segment 0
  standardXHRResponse(this.requests[2]);
  // media1
  standardXHRResponse(this.requests[3]);
  QUnit.ok(selectedPlaylist, 'selected playlist');
  QUnit.ok(this.player.tech_.hls.mediaSource.duration !== -Infinity,
           'updates the duration');
});

QUnit.test('downloads additional playlists if required', function() {
  let called = false;
  let playlist = {
    uri: 'media3.m3u8'
  };

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 20000;
  standardXHRResponse(this.requests[0]);

  standardXHRResponse(this.requests[1]);
  // before an m3u8 is downloaded, no segments are available
  this.player.tech_.hls.selectPlaylist = function() {
    if (!called) {
      called = true;
      return playlist;
    }
    playlist.segments = [1, 1, 1];
    return playlist;
  };

  // the playlist selection is revisited after a new segment is downloaded
  this.player.trigger('timeupdate');

  this.requests[2].bandwidth = 3000000;
  this.requests[2].response = new Uint8Array([0]);
  this.requests[2].respond(200, null, '');
  standardXHRResponse(this.requests[3]);

  QUnit.strictEqual(4, this.requests.length, 'requests were made');
  QUnit.strictEqual(this.requests[3].url,
                    absoluteUrl('manifest/' + playlist.uri),
                    'made playlist request');
  QUnit.strictEqual(playlist.uri,
                    this.player.tech_.hls.playlists.media().uri,
                    'a new playlists was selected');
  QUnit.ok(this.player.tech_.hls.playlists.media().segments,
           'segments are now available');
});

QUnit.test('selects a playlist below the current bandwidth', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests[0]);

  // the default playlist has a really high bitrate
  this.player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 9e10;
  // playlist 1 has a very low bitrate
  this.player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 1;
  // but the detected client bandwidth is really low
  this.player.tech_.hls.bandwidth = 10;

  playlist = this.player.tech_.hls.selectPlaylist();
  QUnit.strictEqual(playlist,
                    this.player.tech_.hls.playlists.master.playlists[1],
                    'the low bitrate stream is selected');
});

QUnit.test('allows initial bandwidth to be provided', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.bandwidth = 500;

  this.requests[0].bandwidth = 1;
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                                '#EXT-X-TARGETDURATION:10\n');
  QUnit.equal(this.player.tech_.hls.bandwidth,
              500,
              'prefers user-specified intial bandwidth');
});

QUnit.test('raises the minimum bitrate for a stream proportionially', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);

  // the default playlist's bandwidth + 10% is QUnit.equal to the current bandwidth
  this.player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 10;
  this.player.tech_.hls.bandwidth = 11;

  // 9.9 * 1.1 < 11
  this.player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 9.9;
  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.strictEqual(playlist,
                    this.player.tech_.hls.playlists.master.playlists[1],
                    'a lower bitrate stream is selected');
});

QUnit.test('uses the lowest bitrate if no other is suitable', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);

  // the lowest bitrate playlist is much greater than 1b/s
  this.player.tech_.hls.bandwidth = 1;
  playlist = this.player.tech_.hls.selectPlaylist();

  // playlist 1 has the lowest advertised bitrate
  QUnit.strictEqual(playlist,
                    this.player.tech_.hls.playlists.master.playlists[1],
                    'the lowest bitrate stream is selected');
});

QUnit.test('selects the correct rendition by player dimensions', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests[0]);

  this.player.width(640);
  this.player.height(360);
  this.player.tech_.hls.bandwidth = 3000000;

  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.deepEqual(playlist.attributes.RESOLUTION,
                  {width: 960, height: 540},
                  'should return the correct resolution by player dimensions');
  QUnit.equal(playlist.attributes.BANDWIDTH,
              1928000,
              'should have the expected bandwidth in case of multiple');

  this.player.width(1920);
  this.player.height(1080);
  this.player.tech_.hls.bandwidth = 3000000;

  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.deepEqual(playlist.attributes.RESOLUTION,
                  {width: 960, height: 540},
                  'should return the correct resolution by playerdimensions');
  QUnit.equal(playlist.attributes.BANDWIDTH,
              1928000,
              'should have the expected bandwidth in case of multiple');

  this.player.width(396);
  this.player.height(224);
  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.deepEqual(playlist.attributes.RESOLUTION,
                  {width: 396, height: 224},
                  'should return the correct resolution by ' +
                  'player dimensions, if exact match');
  QUnit.equal(playlist.attributes.BANDWIDTH,
              440000,
              'should have the expected bandwidth in case of multiple, if exact match');

  this.player.width(395);
  this.player.height(222);
  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.deepEqual(playlist.attributes.RESOLUTION,
                  {width: 396, height: 224},
                  'should return the next larger resolution by player dimensions, ' +
                  'if no exact match exists');
  QUnit.equal(playlist.attributes.BANDWIDTH,
              440000,
              'should have the expected bandwidth in case of multiple, if exact match');
});

QUnit.test('selects the highest bitrate playlist when the player dimensions are ' +
     'larger than any of the variants', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=2x1\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x1\n' +
                                'media1.m3u8\n');
  // media
  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.bandwidth = 1e10;

  this.player.width(1024);
  this.player.height(768);

  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.equal(playlist.attributes.BANDWIDTH,
              1000,
              'selected the highest bandwidth variant');
});

QUnit.test('filters playlists that are currently excluded', function() {
  let playlist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e10;
  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                                'media1.m3u8\n');
  // media
  standardXHRResponse(this.requests.shift());

  // exclude the current playlist
  this.player.tech_.hls.playlists.master.playlists[0].excludeUntil = +new Date() + 1000;
  playlist = this.player.tech_.hls.selectPlaylist();
  QUnit.equal(playlist,
              this.player.tech_.hls.playlists.master.playlists[1],
              'respected exclusions');

  // timeout the exclusion
  this.clock.tick(1000);
  playlist = this.player.tech_.hls.selectPlaylist();
  QUnit.equal(playlist,
              this.player.tech_.hls.playlists.master.playlists[0],
              'expired the exclusion');
});

QUnit.test('blacklists switching from video+audio playlists to audio only', function() {
  let audioPlaylist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e10;
  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                                'media1.m3u8\n');

  // media1
  standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.playlists.media(),
              this.player.tech_.hls.playlists.master.playlists[1],
              'selected video+audio');
  audioPlaylist = this.player.tech_.hls.playlists.master.playlists[0];
  QUnit.equal(audioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

QUnit.test('blacklists switching from audio-only playlists to video+audio', function() {
  let videoAudioPlaylist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                                'media.m3u8\n' +
                                '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                                'media1.m3u8\n');

  // media1
  standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.playlists.media(),
              this.player.tech_.hls.playlists.master.playlists[0],
              'selected audio only');
  videoAudioPlaylist = this.player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(videoAudioPlaylist.excludeUntil,
              Infinity,
              'excluded incompatible playlist');
});

QUnit.test('blacklists switching from video-only playlists to video+audio', function() {
  let videoAudioPlaylist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media1.m3u8\n');

  // media
  standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.playlists.media(),
              this.player.tech_.hls.playlists.master.playlists[0],
              'selected video only');
  videoAudioPlaylist = this.player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(videoAudioPlaylist.excludeUntil,
              Infinity,
              'excluded incompatible playlist');
});

QUnit.test('After an initial media playlist 404s, we fire loadedmetadata once we successfully load a playlist', function() {
  let count = 0;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.bandwidth = 20000;
  this.player.on('loadedmetadata', function() {
    count += 1;
  });
  // master
  standardXHRResponse(this.requests.shift());
  QUnit.equal(count,
    0,
    'loadedMedia not triggered before requesting playlist');
  // media
  this.requests.shift().respond(404);
  QUnit.equal(count,
              0,
              'loadedMedia not triggered after playlist 404');
  // media
  standardXHRResponse(this.requests.shift());
  QUnit.equal(count,
              1,
              'loadedMedia triggered after successful recovery from 404');
});

QUnit.test('does not blacklist compatible H.264 codec strings', function() {
  let master;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400f,mp4a.40.5"\n' +
             'media1.m3u8\n');

  // media
  standardXHRResponse(this.requests.shift());
  master = this.player.tech_.hls.playlists.master;
  QUnit.strictEqual(typeof master.playlists[0].excludeUntil,
                    'undefined',
                    'did not blacklist');
  QUnit.strictEqual(typeof master.playlists[1].excludeUntil,
                    'undefined',
                    'did not blacklist');
});

QUnit.test('does not blacklist compatible AAC codec strings', function() {
  let master;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.3"\n' +
             'media1.m3u8\n');

  // media
  standardXHRResponse(this.requests.shift());
  master = this.player.tech_.hls.playlists.master;
  QUnit.strictEqual(typeof master.playlists[0].excludeUntil,
                    'undefined',
                    'did not blacklist');
  QUnit.strictEqual(typeof master.playlists[1].excludeUntil,
                    'undefined',
                    'did not blacklist');
});

QUnit.test('blacklists switching between playlists with incompatible audio codecs', function() {
  let alternatePlaylist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
             'media.m3u8\n' +
             '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
             'media1.m3u8\n');

  // media
  standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.playlists.media(),
              this.player.tech_.hls.playlists.master.playlists[0],
              'selected HE-AAC stream');
  alternatePlaylist = this.player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(alternatePlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

QUnit.test('does not download the next segment if the buffer is full', function() {
  let currentTime = 15;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.currentTime = function() {
    return currentTime;
  };
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, currentTime + videojs.Hls.GOAL_BUFFER_LENGTH);
  };
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);

  this.player.trigger('timeupdate');

  QUnit.strictEqual(this.requests.length, 1, 'no segment request was made');
});

QUnit.test('downloads the next segment if the buffer is getting low', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);

  QUnit.strictEqual(this.requests.length, 2, 'made two requests');
  this.player.tech_.currentTime = function() {
    return 15;
  };
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 19.999);
  };
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  this.player.tech_.hls.checkBuffer_();

  standardXHRResponse(this.requests[2]);

  QUnit.strictEqual(this.requests.length, 3, 'made a request');
  QUnit.strictEqual(this.requests[2].url,
                    absoluteUrl('manifest/media-00002.ts'),
                    'made segment request');
});

QUnit.test('buffers based on the correct TimeRange if multiple ranges exist', function() {
  let currentTime;
  let buffered;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.currentTime = function() {
    return currentTime;
  };
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(buffered);
  };
  currentTime = 8;
  buffered = [[0, 10], [20, 30]];

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);

  QUnit.strictEqual(this.requests.length, 2, 'made two requests');
  QUnit.strictEqual(this.requests[1].url,
                    absoluteUrl('manifest/media-00002.ts'),
                    'made segment request');

  currentTime = 22;
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  this.player.tech_.hls.checkBuffer_();
  QUnit.strictEqual(this.requests.length, 3, 'made three requests');
  QUnit.strictEqual(this.requests[2].url,
                    absoluteUrl('manifest/media-00003.ts'),
                    'made segment request');
});

QUnit.test('stops downloading segments at the end of the playlist', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests[0]);
  this.requests = [];
  this.player.tech_.hls.mediaIndex = 4;
  this.player.trigger('timeupdate');

  QUnit.strictEqual(this.requests.length, 0, 'no request is made');
});

QUnit.test('only makes one segment request at a time', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests.pop());
  this.player.trigger('timeupdate');

  QUnit.strictEqual(1, this.requests.length, 'one XHR is made');
  this.player.trigger('timeupdate');
  QUnit.strictEqual(1, this.requests.length, 'only one XHR is made');
});

QUnit.test('only appends one segment at a time', function() {
  let appends = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  // media.m3u8
  standardXHRResponse(this.requests.pop());
  this.player.tech_.hls.sourceBuffer.appendBuffer = function() {
    appends++;
  };

  // segment 0
  standardXHRResponse(this.requests.pop());

  this.player.tech_.hls.checkBuffer_();
  QUnit.equal(this.requests.length, 0, 'did not request while updating');

  this.player.tech_.hls.checkBuffer_();
  QUnit.equal(appends, 1, 'appended once');
});

QUnit.test('waits to download new segments until the media playlist is stable', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  // make sure we stay on the lowest variant
  this.player.tech_.hls.bandwidth = 1;
  // master
  standardXHRResponse(this.requests.shift());
  // media1
  standardXHRResponse(this.requests.shift());

  // force a playlist switch
  this.player.tech_.hls.playlists.media('media2.m3u8');

  // segment 0
  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.sourceBuffer.trigger('updateend');

  QUnit.equal(this.requests.length, 1, 'only the playlist request outstanding');
  this.player.tech_.hls.checkBuffer_();
  QUnit.equal(this.requests.length, 1, 'delays segment fetching');

  // media3
  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.checkBuffer_();
  QUnit.equal(this.requests.length, 1, 'resumes segment fetching');
});

QUnit.test('cancels outstanding XHRs when seeking', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests[0]);
  this.player.tech_.hls.media = {
    segments: [{
      uri: '0.ts',
      duration: 10
    }, {
      uri: '1.ts',
      duration: 10
    }]
  };

  // attempt to seek while the download is in progress
  this.player.currentTime(7);
  this.clock.tick(1);

  QUnit.ok(this.requests[1].aborted, 'XHR aborted');
  QUnit.strictEqual(this.requests.length, 3, 'opened new XHR');
});

QUnit.test('when outstanding XHRs are cancelled, they get aborted properly', function() {
  let readystatechanges = 0;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests[0]);

  // trigger a segment download request
  this.player.trigger('timeupdate');

  this.player.tech_.hls.segmentXhr_.onreadystatechange = function() {
    readystatechanges++;
  };

  // attempt to seek while the download is in progress
  this.player.currentTime(12);
  this.clock.tick(1);

  QUnit.ok(this.requests[1].aborted, 'XHR aborted');
  QUnit.strictEqual(this.requests.length, 3, 'opened new XHR');
  QUnit.notEqual(this.player.tech_.hls.segmentXhr_.url,
                 this.requests[1].url,
                 'a new segment is request that is not the aborted one');
  QUnit.strictEqual(readystatechanges, 0, 'onreadystatechange was not called');
});

QUnit.test('segmentXhr is properly nulled out when dispose is called', function() {
  let readystatechanges = 0;
  let oldDispose = Flash.prototype.dispose;
  let player;

  Flash.prototype.dispose = function() {};

  player = createPlayer();
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player, this.clock);
  standardXHRResponse(this.requests[0]);

  // trigger a segment download request
  player.trigger('timeupdate');

  player.tech_.hls.segmentXhr_.onreadystatechange = function() {
    readystatechanges++;
  };

  player.tech_.hls.dispose();

  QUnit.ok(this.requests[1].aborted, 'XHR aborted');
  QUnit.strictEqual(this.requests.length, 2, 'did not open a new XHR');
  QUnit.equal(player.tech_.hls.segmentXhr_, null, 'the segment xhr is nulled out');
  QUnit.strictEqual(readystatechanges, 0, 'onreadystatechange was not called');

  Flash.prototype.dispose = oldDispose;
});

QUnit.test('does not modify the media index for in-buffer seeking', function() {
  let mediaIndex;

  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  standardXHRResponse(this.requests.shift());
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };
  mediaIndex = this.player.tech_.hls.mediaIndex;

  this.player.tech_.setCurrentTime(11);
  this.clock.tick(1);
  QUnit.equal(this.player.tech_.hls.mediaIndex,
              mediaIndex,
              'did not interrupt buffering');
  QUnit.equal(this.requests.length, 1, 'did not abort the outstanding request');
});

QUnit.test('playlist 404 should end stream with a network error', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.requests.pop().respond(404);

  QUnit.equal(this.player.tech_.hls.mediaSource.error_, 'network', 'set a network error');
});

QUnit.test('segment 404 should trigger blacklisting of media', function() {
  let media;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 20000;
  // master
  standardXHRResponse(this.requests[0]);
  // media
  standardXHRResponse(this.requests[1]);

  media = this.player.tech_.hls.playlists.media_;

  // segment
  this.requests[2].respond(400);
  QUnit.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
});

QUnit.test('playlist 404 should blacklist media', function() {
  let media;
  let url;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1e10;
  // master
  this.requests[0].respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'media1.m3u8\n');

  QUnit.equal(typeof this.player.tech_.hls.playlists.media_,
              'undefined',
              'no media is initially set');

  // media
  this.requests[1].respond(400);

  url = this.requests[1].url.slice(this.requests[1].url.lastIndexOf('/') + 1);
  media = this.player.tech_.hls.playlists.master.playlists[url];

  QUnit.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
});

QUnit.test('seeking in an empty playlist is a non-erroring noop', function() {
  let requestsLength;

  this.player.src({
    src: 'manifest/empty-live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(200, null, '#EXTM3U\n');

  requestsLength = this.requests.length;
  this.player.tech_.setCurrentTime(183);
  this.clock.tick(1);

  QUnit.equal(this.requests.length, requestsLength, 'made no additional requests');
});

QUnit.test('sets seekable and duration for live playlists', function() {
  this.player.src({
    src: 'http://example.com/manifest/missingEndlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);

  QUnit.equal(this.player.tech_.hls.mediaSource.seekable.length,
              1,
              'set one seekable range');
  QUnit.equal(this.player.tech_.hls.mediaSource.seekable.start(0),
              this.player.tech_.hls.seekable().start(0),
              'set seekable start');
  QUnit.equal(this.player.tech_.hls.mediaSource.seekable.end(0),
              this.player.tech_.hls.seekable().end(0),
              'set seekable end');

  QUnit.strictEqual(this.player.tech_.hls.mediaSource.duration,
                    Infinity,
                    'duration on the mediaSource is infinity');
});

QUnit.test('live playlist starts three target durations before live', function() {
  this.player.src({
    src: 'live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:101\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXTINF:10,\n' +
                                '2.ts\n' +
                                '#EXTINF:10,\n' +
                                '3.ts\n' +
                                '#EXTINF:10,\n' +
                                '4.ts\n');

  QUnit.equal(this.requests.length, 0, 'no outstanding segment request');

  this.player.tech_.paused = function() {
    return false;
  };
  this.player.tech_.readyState = function() {
    return 1;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);
  QUnit.equal(this.player.currentTime(),
              this.player.tech_.hls.seekable().end(0),
              'seeked to the seekable end');

  QUnit.equal(this.requests.length, 1, 'begins buffering');
});

QUnit.test('live playlist starts with correct currentTime value', function() {
  this.player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);

  this.player.tech_.hls.playlists.trigger('loadedmetadata');

  this.player.tech_.paused = function() {
    return false;
  };
  this.player.tech_.readyState = function() {
    return 1;
  };
  this.player.tech_.trigger('play');
  this.clock.tick(1);

  let media = this.player.tech_.hls.playlists.media();

  QUnit.strictEqual(this.player.currentTime(),
                    videojs.Hls.Playlist.seekable(media).end(0),
                    'currentTime is updated at playback');
});

QUnit.test('adjusts the seekable start based on the amount of expired live content', function() {
  this.player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests.shift());

  // add timeline info to the playlist
  this.player.tech_.hls.playlists.media().segments[1].end = 29.5;
  // expired_ should be ignored if there is timeline information on
  // the playlist
  this.player.tech_.hls.playlists.expired_ = 172;

  QUnit.equal(this.player.seekable().start(0),
              29.5 - 29,
              'offset the seekable start');
});

QUnit.test('estimates seekable ranges for live streams that have been paused for a long time', function() {
  this.player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.playlists.expired_ = 172;

  QUnit.equal(this.player.seekable().start(0),
              this.player.tech_.hls.playlists.expired_,
              'offset the seekable start');
});

QUnit.test('resets the time to a seekable position when resuming a live stream ' +
           'after a long break', function() {
  let seekTarget;

  this.player.src({
    src: 'live0.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-MEDIA-SEQUENCE:16\n' +
                                '#EXTINF:10,\n' +
                                '16.ts\n');
  // mock out the player to simulate a live stream that has been
  // playing for awhile
  this.player.tech_.hls.seekable = function() {
    return videojs.createTimeRange(160, 170);
  };
  this.player.tech_.setCurrentTime = function(time) {
    if (typeof time !== 'undefined') {
      seekTarget = time;
    }
  };
  this.player.tech_.played = function() {
    return videojs.createTimeRange(120, 170);
  };
  this.player.tech_.trigger('playing');

  this.player.tech_.trigger('play');
  QUnit.equal(seekTarget,
              this.player.seekable().start(0),
              'seeked to the start of seekable');
  this.player.tech_.trigger('seeked');
});

QUnit.test('if withCredentials global option is used, withCredentials is set on the XHR object', function() {
  let hlsOptions = videojs.options.hls;

  this.player.dispose();
  videojs.options.hls = {
    withCredentials: true
  };
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  QUnit.ok(this.requests[0].withCredentials,
           'with credentials should be set to true if that option is passed in');
  videojs.options.hls = hlsOptions;
});

QUnit.test('if withCredentials src option is used, withCredentials is set on the XHR object', function() {
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: true
  });
  openMediaSource(this.player, this.clock);
  QUnit.ok(this.requests[0].withCredentials,
           'with credentials should be set to true if that option is passed in');
});

QUnit.test('src level credentials supersede the global options', function() {
  this.player.dispose();
  this.player = createPlayer();
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: true
  });
  openMediaSource(this.player, this.clock);
  QUnit.ok(this.requests[0].withCredentials,
           'with credentials should be set to true if that option is passed in');

});

QUnit.test('aborts segment processing on seek', function() {
  let currentTime = 0;

  this.player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.currentTime = function() {
    return currentTime;
  };
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange();
  };
  // media
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:10,0\n' +
                                '1.ts\n' +
                                '#EXT-X-DISCONTINUITY\n' +
                                '#EXTINF:10,0\n' +
                                '2.ts\n' +
                                '#EXT-X-ENDLIST\n');
  // 1.ts
  standardXHRResponse(this.requests.shift());
  // key.php
  standardXHRResponse(this.requests.shift());
  QUnit.ok(this.player.tech_.hls.pendingSegment_, 'decrypting the segment');

  // seek back to the beginning
  this.player.currentTime(0);
  this.clock.tick(1);
  QUnit.ok(!this.player.tech_.hls.pendingSegment_, 'aborted processing');
});

QUnit.test('calls mediaSource\'s timestampOffset on discontinuity', function() {
  let buffered = [[]];

  this.player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.play();
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(buffered);
  };

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,0\n' +
                                '1.ts\n' +
                                '#EXT-X-DISCONTINUITY\n' +
                                '#EXTINF:10,0\n' +
                                '2.ts\n' +
                                '#EXT-X-ENDLIST\n');
  this.player.tech_.hls.sourceBuffer.timestampOffset = 0;
  // 1.ts
  standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.sourceBuffer.timestampOffset,
              0,
              'timestampOffset starts at zero');

  buffered = [[0, 10]];
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  // 2.ts
  standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.sourceBuffer.timestampOffset,
              10,
              'timestampOffset set after discontinuity');
});

QUnit.test('sets timestampOffset when seeking with discontinuities', function() {
  let timeRange = videojs.createTimeRange(0, 10);

  this.player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.play();
  this.player.tech_.buffered = function() {
    return timeRange;
  };
  this.player.tech_.seeking = function() {
    return true;
  };

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,0\n' +
                              '1.ts\n' +
                              '#EXTINF:10,0\n' +
                              '2.ts\n' +
                              '#EXT-X-DISCONTINUITY\n' +
                              '#EXTINF:10,0\n' +
                              '3.ts\n' +
                              '#EXT-X-ENDLIST\n');
  this.player.tech_.hls.sourceBuffer.timestampOffset = 0;
  this.player.currentTime(21);
  this.clock.tick(1);
  QUnit.equal(this.requests.shift().aborted, true, 'aborted first request');
  // 3.ts
  standardXHRResponse(this.requests.pop());
  this.clock.tick(1000);
  QUnit.equal(this.player.tech_.hls.sourceBuffer.timestampOffset,
              20,
              'timestampOffset starts at zero');
});

QUnit.test('can seek before the source buffer opens', function() {
  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  this.player.triggerReady();

  this.player.currentTime(1);
  QUnit.equal(this.player.currentTime(), 1, 'seeked');
});

QUnit.skip('sets the timestampOffset after seeking to discontinuity', function() {
  let bufferEnd;

  this.player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, bufferEnd);
  };

  this.requests.pop().respond(200, null,
                              '#EXTM3U\n' +
                              '#EXTINF:10,0\n' +
                              '1.ts\n' +
                              '#EXT-X-DISCONTINUITY\n' +
                              '#EXTINF:10,0\n' +
                              '2.ts\n' +
                              '#EXT-X-ENDLIST\n');
  // 1.ts
  standardXHRResponse(this.requests.pop());

  // seek to a discontinuity
  this.player.tech_.setCurrentTime(10);
  bufferEnd = 9.9;
  this.clock.tick(1);
  // 1.ts, again
  standardXHRResponse(this.requests.pop());
  this.player.tech_.hls.checkBuffer_();
  // 2.ts
  standardXHRResponse(this.requests.pop());
  QUnit.equal(this.player.tech_.hls.sourceBuffer.timestampOffset,
              9.9,
              'set the timestamp offset');
});

QUnit.test('tracks segment end times as they are buffered', function() {
  let bufferEnd = 0;

  this.player.src({
    src: 'media.m3u8',
    type: 'application/x-mpegURL'
  });
  openMediaSource(this.player, this.clock);

  // as new segments are downloaded, the buffer end is updated
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, bufferEnd);
  };
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXT-X-ENDLIST\n');

  // 0.ts is shorter than advertised
  standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.mediaSource.duration,
              20,
              'original duration is from the m3u8');

  bufferEnd = 9.5;
  this.player.tech_.hls.sourceBuffer.trigger('update');
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  QUnit.equal(this.player.tech_.hls.mediaSource.duration, 10 + 9.5, 'updated duration');
});

QUnit.test('updates first segment duration as it is buffered', function() {
  let bufferEnd = 0;

  this.player.src({
    src: 'media.m3u8',
    type: 'application/x-mpegURL'
  });
  openMediaSource(this.player, this.clock);

  // as new segments are downloaded, the buffer end is updated
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, bufferEnd);
  };
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXT-X-ENDLIST\n');

  // 0.ts is shorter than advertised
  standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.mediaSource.duration, 20, 'original duration is from the m3u8');
  QUnit.equal(this.player.tech_.hls.playlists.media().segments[0].duration, 10,
    'segment duration initially based on playlist');

  bufferEnd = 9.5;
  this.player.tech_.hls.sourceBuffer.trigger('update');
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  QUnit.equal(this.player.tech_.hls.playlists.media().segments[0].duration, 9.5,
    'updated segment duration');
});

QUnit.test('updates segment durations as they are buffered', function() {
  let bufferEnd = 0;

  this.player.src({
    src: 'media.m3u8',
    type: 'application/x-mpegURL'
  });
  openMediaSource(this.player, this.clock);

  // as new segments are downloaded, the buffer end is updated
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, bufferEnd);
  };
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXT-X-ENDLIST\n');

  // 0.ts is shorter than advertised
  standardXHRResponse(this.requests.shift());
  QUnit.equal(this.player.tech_.hls.mediaSource.duration, 20, 'original duration is from the m3u8');

  QUnit.equal(this.player.tech_.hls.playlists.media().segments[1].duration, 10,
    'segment duration initially based on playlist');

  bufferEnd = 9.5;
  this.player.tech_.hls.sourceBuffer.trigger('update');
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  bufferEnd = 19;
  this.player.tech_.hls.sourceBuffer.trigger('update');
  this.player.tech_.hls.sourceBuffer.trigger('updateend');

  QUnit.equal(this.player.tech_.hls.playlists.media().segments[1].duration, 9.5,
    'updated segment duration');
});

QUnit.skip('seeking does not fail when targeted between segments', function() {
  let currentTime;
  let segmentUrl;

  this.player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  // mock out the currentTime callbacks
  /* eslint-disable camelcase */
  this.player.tech_.el().vjs_setProperty = function(property, value) {
    if (property === 'currentTime') {
      currentTime = value;
    }
  };
  this.player.tech_.el().vjs_getProperty = function(property) {
    if (property === 'currentTime') {
      return currentTime;
    }
  };
  /* eslint-enable camelcase */

  // media
  standardXHRResponse(this.requests.shift());
  // segment 0
  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.checkBuffer_();
  segmentUrl = this.requests[0].url;
  // segment 1
  standardXHRResponse(this.requests.shift());

  // seek to a time that is greater than the last tag in segment 0 but
  // less than the first in segment 1

  /* eslint-disable no-warning-comments */
  // FIXME: it's not possible to seek here without timestamp-based
  // segment durations
  /* eslint-enable no-warning-comments */

  this.player.tech_.setCurrentTime(9.4);
  this.clock.tick(1);
  QUnit.equal(this.requests[0].url, segmentUrl, 'requested the later segment');

  // segment 1
  standardXHRResponse(this.requests.shift());
  this.player.tech_.trigger('seeked');
  QUnit.equal(this.player.currentTime(), 9.5, 'seeked to the later time');
});

QUnit.test('resets the switching algorithm if a request times out', function() {
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.bandwidth = 1e20;

  // master
  standardXHRResponse(this.requests.shift());
  // media.m3u8
  standardXHRResponse(this.requests.shift());
  // simulate a segment timeout
  this.requests[0].timedout = true;
  this.requests.shift().abort();

  standardXHRResponse(this.requests.shift());

  QUnit.strictEqual(this.player.tech_.hls.playlists.media(),
                    this.player.tech_.hls.playlists.master.playlists[1],
                    'reset to the lowest bitrate playlist');
});

QUnit.test('disposes the playlist loader', function() {
  let disposes = 0;
  let player;
  let loaderDispose;

  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player, this.clock);
  loaderDispose = player.tech_.hls.playlists.dispose;
  player.tech_.hls.playlists.dispose = function() {
    disposes++;
    loaderDispose.call(player.tech_.hls.playlists);
  };

  player.dispose();
  QUnit.strictEqual(disposes, 1, 'disposed playlist loader');
});

QUnit.test('remove event handlers on dispose', function() {
  let player;
  let unscoped = 0;

  player = createPlayer();
  player.on = function(owner) {
    if (typeof owner !== 'object') {
      unscoped++;
    }
  };
  player.off = function(owner) {
    if (typeof owner !== 'object') {
      unscoped--;
    }
  };
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player, this.clock);

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);

  player.dispose();

  QUnit.ok(unscoped <= 0, 'no unscoped handlers');
});

QUnit.test('aborts the source buffer on disposal', function() {
  let aborts = 0;
  let player;

  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player, this.clock);
  player.dispose();
  QUnit.ok(true, 'disposed before creating the source buffer');
  this.requests.length = 0;

  player = createPlayer();
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player, this.clock);
  standardXHRResponse(this.requests.shift());
  player.tech_.hls.sourceBuffer.abort = function() {
    aborts++;
  };

  player.dispose();
  QUnit.strictEqual(aborts, 1, 'aborted the source buffer');
});

QUnit.test('the source handler supports HLS mime types', function() {
  ['html5', 'flash'].forEach(function(techName) {
    QUnit.ok(videojs.HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/x-MPegUrl'
    }), 'supports x-mpegurl');
    QUnit.ok(videojs.HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/VnD.aPPle.MpEgUrL'
    }), 'supports vnd.apple.mpegurl');
    QUnit.ok(videojs.HlsSourceHandler(techName).canPlayType('aPplicatiOn/VnD.aPPle.MpEgUrL'),
            'supports vnd.apple.mpegurl');
    QUnit.ok(videojs.HlsSourceHandler(techName).canPlayType('aPplicatiOn/x-MPegUrl'),
             'supports x-mpegurl');

    QUnit.ok(!(videojs.HlsSourceHandler(techName).canHandleSource({
      type: 'video/mp4'
    }) instanceof videojs.HlsHandler), 'does not support mp4');
    QUnit.ok(!(videojs.HlsSourceHandler(techName).canHandleSource({
      type: 'video/x-flv'
    }) instanceof videojs.HlsHandler), 'does not support flv');
    QUnit.ok(!(videojs.HlsSourceHandler(techName).canPlayType('video/mp4')),
             'does not support mp4');
    QUnit.ok(!(videojs.HlsSourceHandler(techName).canPlayType('video/x-flv')),
             'does not support flv');
  });
});

QUnit.test('fires loadstart manually if Flash is used', function() {
  let tech = new (videojs.extend(videojs.EventTarget, {
    buffered() {
      return videojs.createTimeRange();
    },
    currentTime() {
      return 0;
    },
    el() {
      return {};
    },
    preload() {
      return 'auto';
    },
    src() {},
    setTimeout: window.setTimeout
  }))();
  let loadstarts = 0;

  tech.on('loadstart', function() {
    loadstarts++;
  });
  videojs.HlsSourceHandler('flash').handleSource({
    src: 'movie.m3u8',
    type: 'application/x-mpegURL'
  }, tech);

  QUnit.equal(loadstarts, 0, 'loadstart is not synchronous');
  this.clock.tick(1);
  QUnit.equal(loadstarts, 1, 'fired loadstart');
});

QUnit.test('has no effect if native HLS is available', function() {
  let player;

  videojs.Hls.supportsNativeHls = true;
  player = createPlayer();
  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  QUnit.ok(!player.tech_.hls, 'did not load hls tech');
  player.dispose();
});

QUnit.test('is not supported on browsers without typed arrays', function() {
  let oldArray = window.Uint8Array;

  window.Uint8Array = null;
  QUnit.ok(!videojs.Hls.isSupported(), 'HLS is not supported');

  // cleanup
  window.Uint8Array = oldArray;
});

QUnit.test('tracks the bytes downloaded', function() {
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  QUnit.strictEqual(this.player.tech_.hls.bytesReceived, 0, 'no bytes received');
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXT-X-ENDLIST\n');
  // transmit some segment bytes
  this.requests[0].response = new ArrayBuffer(17);
  this.requests.shift().respond(200, null, '');
  this.player.tech_.hls.sourceBuffer.trigger('updateend');

  QUnit.strictEqual(this.player.tech_.hls.bytesReceived, 17, 'tracked bytes received');

  this.player.tech_.hls.checkBuffer_();

  // transmit some more
  this.requests[0].response = new ArrayBuffer(5);
  this.requests.shift().respond(200, null, '');

  QUnit.strictEqual(this.player.tech_.hls.bytesReceived, 22, 'tracked more bytes');
});

QUnit.test('re-emits mediachange events', function() {
  let mediaChanges = 0;

  this.player.on('mediachange', function() {
    mediaChanges++;
  });

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.playlists.trigger('mediachange');
  QUnit.strictEqual(mediaChanges, 1, 'fired mediachange');
});

QUnit.test('can be disposed before finishing initialization', function() {
  let readyHandlers = [];

  this.player.ready = function(callback) {
    readyHandlers.push(callback);
  };
  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.src({
    src: 'http://example.com/media.mp4',
    type: 'video/mp4'
  });
  QUnit.ok(readyHandlers.length > 0, 'registered a ready handler');
  try {
    while (readyHandlers.length) {
      readyHandlers.shift().call(this.player);
      openMediaSource(this.player, this.clock);
    }
    QUnit.ok(true, 'did not throw an exception');
  } catch (e) {
    QUnit.ok(false, 'threw an exception');
  }
});

QUnit.test('calls endOfStream on the media source after appending the last segment', function() {
  let endOfStreams = 0;
  let buffered = [[]];

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.buffered = function() {
    return videojs.createTimeRanges(buffered);
  };
  this.player.tech_.hls.mediaSource.endOfStream = function() {
    endOfStreams++;
  };
  this.player.currentTime(20);
  this.clock.tick(1);
  // playlist response
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXT-X-ENDLIST\n');
  // segment response
  this.requests[0].response = new ArrayBuffer(17);
  this.requests.shift().respond(200, null, '');
  QUnit.strictEqual(endOfStreams, 0, 'waits for the buffer update to finish');

  buffered = [[0, 10]];
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  QUnit.strictEqual(endOfStreams, 1, 'called endOfStream on the media source');
});

QUnit.test('calls endOfStream on the media source when the current buffer ends at duration', function() {
  let endOfStreams = 0;
  let buffered = [[]];

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.buffered = function() {
    return videojs.createTimeRanges(buffered);
  };
  this.player.tech_.hls.mediaSource.endOfStream = function() {
    endOfStreams++;
  };
  this.player.currentTime(19);
  this.clock.tick(1);
  // playlist response
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXTINF:10,\n' +
                                '1.ts\n' +
                                '#EXT-X-ENDLIST\n');
  // segment response
  this.requests[0].response = new ArrayBuffer(17);
  this.requests.shift().respond(200, null, '');
  QUnit.strictEqual(endOfStreams, 0, 'waits for the buffer update to finish');

  buffered = [[10, 20]];
  this.player.tech_.hls.sourceBuffer.trigger('updateend');

  this.player.currentTime(5);
  this.clock.tick(1);
  // segment response
  this.requests[0].response = new ArrayBuffer(17);
  this.requests.shift().respond(200, null, '');

  buffered = [[0, 20]];
  this.player.tech_.hls.sourceBuffer.trigger('updateend');

  QUnit.strictEqual(endOfStreams, 2, 'called endOfStream on the media source twice');
});

QUnit.test('calling play() at the end of a video replays', function() {
  let seekTime = -1;

  this.player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.setCurrentTime = function(time) {
    if (typeof time !== 'undefined') {
      seekTime = time;
    }
    return 0;
  };
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXTINF:10,\n' +
                                '0.ts\n' +
                                '#EXT-X-ENDLIST\n');
  standardXHRResponse(this.requests.shift());
  this.player.tech_.ended = function() {
    return true;
  };

  this.player.tech_.trigger('play');
  QUnit.equal(seekTime, 0, 'seeked to the beginning');
});

QUnit.test('segments remain pending without a source buffer', function() {
  this.player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php?r=52"\n' +
                                '#EXTINF:10,\n' +
                                'http://media.example.com/fileSequence52-A.ts' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php?r=53"\n' +
                                '#EXTINF:10,\n' +
                                'http://media.example.com/fileSequence53-B.ts\n' +
                                '#EXT-X-ENDLIST\n');

  this.player.tech_.hls.sourceBuffer = null;

  // key
  standardXHRResponse(this.requests.shift());
  // segment
  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.checkBuffer_();
  QUnit.ok(this.player.tech_.hls.pendingSegment_, 'waiting for the source buffer');
});

QUnit.test('keys are requested when an encrypted segment is loaded', function() {
  this.player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  // playlist
  standardXHRResponse(this.requests.shift());

  QUnit.strictEqual(this.requests.length, 2, 'a key XHR is created');
  QUnit.strictEqual(this.requests[0].url,
                    this.player.tech_.hls.playlists.media().segments[0].key.uri,
                    'key XHR is created with correct uri');
  QUnit.strictEqual(this.requests[1].url,
                    this.player.tech_.hls.playlists.media().segments[0].uri,
                    'segment XHR is created with correct uri');
});

QUnit.test('keys are resolved relative to the master playlist', function() {
  this.player.src({
    src: 'video/master-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
                                'playlist/playlist.m3u8\n' +
                                '#EXT-X-ENDLIST\n');
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:2.833,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-ENDLIST\n');
  QUnit.equal(this.requests.length, 2, 'requested the key');
  QUnit.equal(this.requests[0].url,
              absoluteUrl('video/playlist/keys/key.php'),
              'resolves multiple relative paths');
});

QUnit.test('keys are resolved relative to their containing playlist', function() {
  this.player.src({
    src: 'video/media-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:2.833,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-ENDLIST\n');
  QUnit.equal(this.requests.length, 2, 'requested a key');
  QUnit.equal(this.requests[0].url,
              absoluteUrl('video/keys/key.php'),
              'resolves multiple relative paths');
});

QUnit.test('a new key XHR is created when a the segment is requested', function() {
  this.player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:2.833,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key2.php"\n' +
                                '#EXTINF:2.833,\n' +
                                'http://media.example.com/fileSequence2.ts\n' +
                                '#EXT-X-ENDLIST\n');
  // key 1
  standardXHRResponse(this.requests.shift());
  // segment 1
  standardXHRResponse(this.requests.shift());
  // "finish" decrypting segment 1
  this.player.tech_.hls.pendingSegment_.bytes = new Uint8Array(16);
  this.player.tech_.hls.checkBuffer_();
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 2.833);
  };
  this.player.tech_.hls.sourceBuffer.trigger('updateend');

  QUnit.strictEqual(this.requests.length, 2, 'a key XHR is created');
  QUnit.strictEqual(this.requests[0].url,
                    'https://example.com/' +
                    this.player.tech_.hls.playlists.media().segments[1].key.uri,
                    'a key XHR is created with the correct uri');
});

QUnit.test('seeking should abort an outstanding key request and create a new one', function() {
  this.player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.requests.shift().respond(200, null,
                                '#EXTM3U\n' +
                                '#EXT-X-TARGETDURATION:15\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                                '#EXTINF:9,\n' +
                                'http://media.example.com/fileSequence1.ts\n' +
                                '#EXT-X-KEY:METHOD=AES-128,URI="keys/key2.php"\n' +
                                '#EXTINF:9,\n' +
                                'http://media.example.com/fileSequence2.ts\n' +
                                '#EXT-X-ENDLIST\n');
  // segment 1
  standardXHRResponse(this.requests.pop());

  this.player.currentTime(11);
  this.clock.tick(1);
  QUnit.ok(this.requests[0].aborted, 'the key XHR should be aborted');
  // aborted key 1
  this.requests.shift();

  QUnit.equal(this.requests.length, 2, 'requested the new key');
  QUnit.equal(this.requests[0].url,
              'https://example.com/' +
              this.player.tech_.hls.playlists.media().segments[1].key.uri,
              'urls should match');
});

QUnit.test('retries key requests once upon failure', function() {
  this.player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');

  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
             '#EXTINF:15.0,\n' +
             'http://media.example.com/fileSequence53-A.ts\n');
    // segment
  standardXHRResponse(this.requests.pop());
  this.requests[0].respond(404);
  QUnit.equal(this.requests.length, 2, 'create a new XHR for the same key');
  QUnit.equal(this.requests[1].url, this.requests[0].url, 'should be the same key');

  this.requests[1].respond(404);
  QUnit.equal(this.requests.length, 2, 'gives up after one retry');
});

QUnit.test('blacklists playlist if key requests fail more than once', function() {
  let bytes = [];
  let media;

  this.player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');

  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
             '#EXTINF:15.0,\n' +
             'http://media.example.com/fileSequence53-A.ts\n');
  this.player.tech_.hls.sourceBuffer.appendBuffer = function(chunk) {
    bytes.push(chunk);
  };

  media = this.player.tech_.hls.playlists.media_;

  // segment 1
  standardXHRResponse(this.requests.pop());
  // fail key
  this.requests.shift().respond(400);
  // fail key, again
  this.requests.shift().respond(400);
  this.player.tech_.hls.checkBuffer_();

  QUnit.ok(media.excludeUntil > 0,
           'playlist blacklisted');
});

QUnit.test('the key is supplied to the decrypter in the correct format', function() {
  let keys = [];

  this.player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');

  this.requests.pop()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-MEDIA-SEQUENCE:5\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXTINF:15.0,\n' +
             'http://media.example.com/fileSequence52-B.ts\n');

  videojs.Hls.Decrypter = function(encrypted, key) {
    keys.push(key);
  };

  // segment
  standardXHRResponse(this.requests.pop());
  this.requests[0].response = new Uint32Array([0, 1, 2, 3]).buffer;
  this.requests[0].respond(200, null, '');
  // key
  this.requests.shift();
  QUnit.equal(keys.length, 1, 'only one Decrypter was constructed');
  QUnit.deepEqual(keys[0],
                  new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
                  'passed the specified segment key');

});

QUnit.test('supplies the media sequence of current segment as the IV by default, if no IV is specified', function() {
  let ivs = [];

  this.player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');

  this.requests.pop()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-MEDIA-SEQUENCE:5\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXTINF:15.0,\n' +
             'http://media.example.com/fileSequence52-B.ts\n');

  videojs.Hls.Decrypter = function(encrypted, key, iv) {
    ivs.push(iv);
  };

  this.requests[0].response = new Uint32Array([0, 0, 0, 0]).buffer;
  this.requests[0].respond(200, null, '');
  this.requests.shift();
  standardXHRResponse(this.requests.pop());

  QUnit.equal(ivs.length, 1, 'only one Decrypter was constructed');
  QUnit.deepEqual(ivs[0],
                  new Uint32Array([0, 0, 0, 5]),
                  'the IV for the segment is the media sequence');
});

QUnit.test('switching playlists with an outstanding key request does not stall playback', function() {
  let buffered = [];
  let media = '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:5\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
    '#EXTINF:2.833,\n' +
    'http://media.example.com/fileSequence52-A.ts\n' +
    '#EXTINF:15.0,\n' +
    'http://media.example.com/fileSequence52-B.ts\n';

  this.player.src({
    src: 'https://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');

  this.player.tech_.hls.bandwidth = 1;
  this.player.tech_.buffered = function() {
    return videojs.createTimeRange(buffered);
  };
  // master playlist
  standardXHRResponse(this.requests.shift());
  // media playlist
  this.requests.shift().respond(200, null, media);
  // mock out media switching from this point on
  this.player.tech_.hls.playlists.media = () => {
    return this.player.tech_.hls.playlists.master.playlists[1];
  };
  // first segment of the original media playlist
  standardXHRResponse(this.requests.pop());

  // "switch" media
  this.player.tech_.hls.playlists.trigger('mediachange');
  QUnit.ok(!this.requests[0].aborted, 'did not abort the key request');

  // "finish" decrypting segment 1
  // key
  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.pendingSegment_.bytes = new Uint8Array(16);
  this.player.tech_.hls.checkBuffer_();
  buffered = [[0, 2.833]];
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  this.player.tech_.hls.checkBuffer_();

  QUnit.equal(this.requests.length, 1, 'made a request');
  QUnit.equal(this.requests[0].url,
              'http://media.example.com/fileSequence52-B.ts',
              'requested the segment');
});

QUnit.test('resolves relative key URLs against the playlist', function() {
  this.player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-MEDIA-SEQUENCE:5\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-ENDLIST\n');
  QUnit.equal(this.requests[0].url,
              'https://example.com/key.php?r=52',
              'resolves the key URL');
});

QUnit.test('treats invalid keys as a key request failure and blacklists playlist', function() {
  let bytes = [];
  let media;

  this.player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.requests.shift()
    .respond(200, null,
             '#EXTM3U\n' +
             '#EXT-X-MEDIA-SEQUENCE:5\n' +
             '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
             '#EXTINF:2.833,\n' +
             'http://media.example.com/fileSequence52-A.ts\n' +
             '#EXT-X-KEY:METHOD=NONE\n' +
             '#EXTINF:15.0,\n' +
             'http://media.example.com/fileSequence52-B.ts\n');
  this.player.tech_.hls.sourceBuffer.appendBuffer = function(chunk) {
    bytes.push(chunk);
  };

  media = this.player.tech_.hls.playlists.media_;
  // segment request
  standardXHRResponse(this.requests.pop());
  // keys should be 16 bytes long
  this.requests[0].response = new Uint8Array(1).buffer;
  this.requests.shift().respond(200, null, '');

  QUnit.equal(this.requests[0].url,
              'https://priv.example.com/key.php?r=52',
              'retries the key');

  // the retried response is invalid, too
  this.requests[0].response = new Uint8Array(1);
  this.requests.shift().respond(200, null, '');
  this.player.tech_.hls.checkBuffer_();

  // two failed attempts is an error - blacklist this playlist
  QUnit.ok(media.excludeUntil > 0,
           'blacklisted playlist');
});

QUnit.test('live stream should not call endOfStream', function() {
  this.player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.trigger('play');
  this.requests[0].respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:0\n' +
                           '#EXTINF:1\n' +
                           '0.ts\n');
  this.requests[1].response = new Uint8Array(1);
  this.requests[1].respond(200, null, '');
  QUnit.equal('open',
              this.player.tech_.hls.mediaSource.readyState,
              'media source should be in open state, not ended ' +
              'state for live stream after the last segment in m3u8 downloaded');
});

QUnit.test('does not download segments if preload option set to none', function() {
  this.player.preload('none');
  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(this.player, this.clock);
  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.checkBuffer_();

  this.requests = this.requests.filter(function(request) {
    return !(/m3u8$/).test(request.uri);
  });
  QUnit.equal(this.requests.length, 0, 'did not download any segments');
});

QUnit.test('does not process update end until buffered value has been set', function() {
  let drainBufferCallCount = 0;
  let origDrainBuffer;

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(this.player, this.clock);
  origDrainBuffer = this.player.tech_.hls.drainBuffer;
  this.player.tech_.hls.drainBuffer = function() {
    drainBufferCallCount++;
  };

  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());

  QUnit.equal(drainBufferCallCount, 0, 'drainBuffer not called yet');

  // segment
  standardXHRResponse(this.requests.shift());

  QUnit.ok(this.player.tech_.hls.pendingSegment_, 'pending segment exists');
  QUnit.equal(drainBufferCallCount, 1, 'drainBuffer called');

  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  QUnit.ok(this.player.tech_.hls.pendingSegment_, 'pending segment exists');

  this.player.tech_.hls.drainBuffer = origDrainBuffer;
  this.player.tech_.hls.drainBuffer();
  QUnit.ok(this.player.tech_.hls.pendingSegment_, 'pending segment exists');

  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  QUnit.ok(!this.player.tech_.hls.pendingSegment_, 'pending segment cleared out');
});

// workaround https://bugzilla.mozilla.org/show_bug.cgi?id=548397
QUnit.test('selectPlaylist does not fail if getComputedStyle returns null', function() {
  let oldGetComputedStyle = window.getComputedStyle;

  window.getComputedStyle = function() {
    return null;
  };

  this.player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  // master
  standardXHRResponse(this.requests.shift());
  // media
  standardXHRResponse(this.requests.shift());

  this.player.tech_.hls.selectPlaylist();
  QUnit.ok(true, 'should not throw');
  window.getComputedStyle = oldGetComputedStyle;
});

QUnit.module('Buffer Inspection');
QUnit.test('detects time range end-point changed by updates', function() {
  let edge;

  // Single-range changes
  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10]]),
                                                    videojs.createTimeRange([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'detected a forward addition');

  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[5, 10]]),
                                                    videojs.createTimeRange([[0, 10]]));
  QUnit.strictEqual(edge, null, 'ignores backward addition');

  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[5, 10]]),
                                                    videojs.createTimeRange([[0, 11]]));
  QUnit.strictEqual(edge,
                    11,
                    'detected a forward addition & ignores a backward addition');

  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10]]),
                                                    videojs.createTimeRange([[0, 9]]));
  QUnit.strictEqual(edge,
                    null,
                    'ignores a backwards addition resulting from a shrinking range');

  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10]]),
                                                    videojs.createTimeRange([[2, 7]]));
  QUnit.strictEqual(edge,
                    null,
                    'ignores a forward & backwards addition ' +
                    'resulting from a shrinking range');

  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[2, 10]]),
                                                    videojs.createTimeRange([[0, 7]]));
  QUnit.strictEqual(edge,
                    null,
                    'ignores a forward & backwards addition resulting ' +
                    'from a range shifted backward');

  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[2, 10]]),
                                                    videojs.createTimeRange([[5, 15]]));
  QUnit.strictEqual(edge,
                    15,
                    'detected a forwards addition resulting from a range shifted foward');

  // Multiple-range changes
  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10]]),
                                                    videojs.createTimeRange([[0, 11], [12, 15]]));
  QUnit.strictEqual(edge, null, 'ignores multiple new forward additions');

  edge = videojs.Hls
    .findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10], [20, 40]]),
                                    videojs.createTimeRange([[20, 50]]));
  QUnit.strictEqual(edge, 50, 'detected a forward addition & ignores range removal');

  edge =
    videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10],
                                                                       [20, 40]]),
                                               videojs.createTimeRange([[0, 50]]));
  QUnit.strictEqual(edge, 50, 'detected a forward addition & ignores merges');

  edge =
    videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10],
                                                                       [20, 40]]),
                                               videojs.createTimeRange([[0, 40]]));
  QUnit.strictEqual(edge, null, 'ignores merges');

  // Empty input
  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange(),
                                                    videojs.createTimeRange([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'handle an empty original TimeRanges object');

  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 11]]),
                                                    videojs.createTimeRange());
  QUnit.strictEqual(edge, null, 'handle an empty update TimeRanges object');

  // Null input
  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(null,
                                                    videojs.createTimeRange([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'treat null original buffer as an empty TimeRanges object');

  edge = videojs.Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 11]]),
                                                    null);
  QUnit.strictEqual(edge, null, 'treat null update buffer as an empty TimeRanges object');
});

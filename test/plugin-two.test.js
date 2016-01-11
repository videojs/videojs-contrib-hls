import videojs from 'video.js';
import sinon from 'sinon';
import QUnit from 'qunit';
import {Hls} from '../src/plugin';
import testDataManifests from './test-data/manifests.js';

const Player = videojs.getComponent('Player');
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
  request.respond(
    200,
    { 'Content-Type': contentType },
    testDataManifests[manifestName]
  );
};

// a no-op MediaSource implementation to allow synchronous testing
let MockMediaSource = videojs.extend(videojs.EventTarget, {
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
});

// do a shallow copy of the properties of source onto the target object
const merge = function(target, source) {
  var name;
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
        .join('/'));
};

MockMediaSource.open = function() {};

QUnit.module('HLS', {
  beforeEach() {
    let self = this;
    this.nextId = 0;
    // create the test player
    this.player = createPlayer();

    this.Flash = videojs.getComponent('Flash'),

    this.oldMediaSource = Player.prototype.MediaSource;
    Player.prototype.MediaSource = MockMediaSource;
    this.oldCreateUrl = Player.prototype.URL.createObjectURL;
    Player.prototype.URL.createObjectURL = function() {
      return 'blob:mock-vjs-object-url';
    };

    // mock out Flash features for phantomjs
    this.oldFlash = videojs.mergeOptions({}, this.Flash);
    this.Flash.embed = function(swf, flashVars) {
      var el = document.createElement('div');
      el.id = 'vjs_mock_flash_' + self.nextId++;
      el.className = 'vjs-tech vjs-mock-flash';
      el.duration = Infinity;
      el.vjs_load = function() {};
      el.vjs_getProperty = function(attr) {
        if (attr === 'buffered') {
          return [[0,0]];
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
    this.oldFlashSupported = this.Flash.isSupported;
    this.Flash.isSupported = function() {
      return true;
    };

    this.oldSourceBuffer = window.videojs.SourceBuffer;
    window.videojs.SourceBuffer = function() {
      this.appendBuffer = function() {};
      this.abort = function() {};
    };

    // store functionality that some tests need to mock
    // What is this??
    // oldSegmentParser = Hls.SegmentParser;
    this.oldGlobalOptions = videojs.mergeOptions(videojs.options);

    // force the HLS tech to run
    this.oldNativeHlsSupport = Hls.supportsNativeHls;
    Hls.supportsNativeHls = false;

    this.oldDecrypt = Hls.Decrypter;
    Hls.Decrypter = function() {};

    // fake XHRs
    this.oldXhr = window.XMLHttpRequest;
    this.sinonXhr = sinon.useFakeXMLHttpRequest();
    videojs.xhr.XMLHttpRequest = this.sinonXhr;
    this.requests = [];
    this.sinonXhr.onCreate = function(xhr) {
      self.requests.push(xhr);
    };

    // fake timers
    this.clock = sinon.useFakeTimers();

  },

  afterEach() {
    Player.prototype.MediaSource = this.oldMediaSource;
    Player.prototype.URL.createObjectURL = this.oldCreateUrl;

    merge(videojs.options, this.oldGlobalOptions);
    this.Flash.isSupported = this.oldFlashSupported;
    merge(this.Flash, this.oldFlash);

    // TODO: what is this??
    // Hls.SegmentParser = oldSegmentParser;
    Hls.supportsNativeHls = this.oldNativeHlsSupport;
    Hls.Decrypter = this.oldDecrypt;
    this.player.SourceBuffer = this.oldSourceBuffer;

    this.player.dispose();
    this.sinonXhr.restore();
    videojs.xhr.XMLHttpRequest = this.oldXhr;
    // TODO: this breaks some test cases: timer created with setTimeout() but cleared with clearInterval()
    //this.clock.restore();
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

QUnit.test('autoplay seeks to the live point after playlist load', function() {
  let currentTime = 0;
  let self = this;

  this.player.autoplay(true);
  this.player.on('seeking', function() {
    currentTime = self.player.currentTime();
  });
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.readyState = function(){return 1;};
  this.player.tech_.trigger('play');
  standardXHRResponse(this.requests.shift());
  this.clock.tick(1);

  QUnit.notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test('autoplay seeks to the live point after media source open', function() {
  let currentTime = 0;
  let self = this;

  this.player.autoplay(true);
  this.player.on('seeking', function() {
    currentTime = self.player.currentTime();
  });
  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  this.player.tech_.triggerReady();
  this.clock.tick(1);
  standardXHRResponse(this.requests.shift());
  openMediaSource(this.player, this.clock);
  this.player.tech_.readyState = function(){return 1;};
  this.player.tech_.trigger('play');
  this.clock.tick(1);
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

  QUnit.equal(this.player.tech_.hls.mediaSource.duration , 40, 'set the duration');
});

QUnit.test('calls `remove` on sourceBuffer to when loading a live segment', function() {
  let removes = [];
  let seekable = videojs.createTimeRanges([[60, 120]]);

  this.player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.seekable = function(){
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
  this.player.tech_.paused = function() { return false; };
  this.player.tech_.readyState = function(){return 1;};
  this.player.tech_.trigger('play');

  this.clock.tick(1);
  standardXHRResponse(this.requests[1]);

  QUnit.strictEqual(
    this.requests[0].url,
    'liveStart30sBefore.m3u8',
    'master playlist requested'
  );
  QUnit.equal(removes.length, 1, 'remove called');
  QUnit.deepEqual(
    removes[0],
    [0, seekable.start(0)],
    'remove called with the right range'
  );
});

// WARN: 'VIDEOJS:', 'WARN:',
// 'Problem encountered with the current
// HLS playlist. Switching to another playlist.'
QUnit.test('calls `remove` on sourceBuffer to when loading a vod segment', function() {
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

  QUnit.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  QUnit.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/media3.m3u8'),
    'media playlist requested'
  );
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
    'media.m3u8\n'
  );
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


// WARN: 'VIDEOJS:', 'WARN:',
// 'player.hls is deprecated. Use player.tech.hls instead.'
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
  QUnit.ok(this.player.tech_.hls.playlists.master, 'set the master playlist');
  QUnit.ok(this.player.tech_.hls.playlists.media(), 'set the media playlist');
  QUnit.ok(
    this.player.tech_.hls.playlists.media().segments,
    'the segment entries are parsed'
  );
  QUnit.strictEqual(
    this.player.tech_.hls.playlists.master.playlists[0],
    this.player.tech_.hls.playlists.media(),
    'the playlist is selected'
  );
});

// WARN: 'VIDEOJS:', 'WARN:',
// 'player.hls is deprecated. Use player.tech.hls instead.'
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
  QUnit.ok(
    this.requests[0].url.indexOf('master.m3u8') >= 0,
    'requested only the new playlist'
  );
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
  QUnit.equal(this.player.tech_.hls.mediaSource.duration, 40, 'set the duration');
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
  QUnit.strictEqual(
    this.player.tech_.hls.mediaSource.duration,
    this.player.tech_.hls.playlists.media().segments.length * 10,
    'duration is updated'
  );
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
    '3.ts\n'
  );

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
  QUnit.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/media-00001.ts'),
    'the first segment is requested'
  );
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
  QUnit.equal(
    this.player.tech_.hls.findBufferedRange_().end(0),
    5,
    'inside the first buffered region'
  );
  this.player.currentTime(6);
  this.clock.tick(1);
  QUnit.equal(
    this.player.tech_.hls.findBufferedRange_().end(0),
    12,
    'inside the second buffered region'
  );
});

QUnit.test('recognizes absolute URIs and requests them unmodified', function() {
  this.player.src({
    src: 'manifest/absoluteUris.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  QUnit.strictEqual(
    this.requests[1].url,
    'http://example.com/00001.ts',
    'the first segment is requested'
  );
});

QUnit.test('recognizes domain-relative URLs', function() {
  this.player.src({
    src: 'manifest/domainUris.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);
  QUnit.strictEqual(
    this.requests[1].url,
    window.location.protocol + '//' + window.location.host + '/00001.ts',
    'the first segment is requested'
  );
});

// VIDEOJS:', 'WARN:',
// 'player.hls is deprecated. Use player.tech.hls instead.'
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
  QUnit.notStrictEqual(
    firstPlaylists,
    secondPlaylists,
    'the playlist object is not reused'
  );
  QUnit.notStrictEqual(firstMSE, secondMSE, 'the media source object is not reused');
});

QUnit.test('triggers an error when a master playlist request errors', function() {
  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.requests.pop().respond(500);

  QUnit.equal(
    this.player.tech_.hls.mediaSource.error_,
    'network',
    'a network error is triggered'
  );
});

// 'VIDEOJS:', 'WARN:',
// 'Problem encountered with the current HLS playlist.
// Switching to another playlist.'
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

  QUnit.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  QUnit.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/media3.m3u8'),
    'media playlist requested'
  );
  QUnit.strictEqual(
    this.requests[2].url,
    absoluteUrl('manifest/media3-00001.ts'),
    'first segment requested'
  );
});

// 'VIDEOJS:', 'WARN:',
// 'Problem encountered with the current HLS playlist.
// Switching to another playlist.'
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

  QUnit.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  QUnit.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/media3.m3u8'),
    'media playlist requested'
  );
  QUnit.strictEqual(
    this.requests[2].url,
    absoluteUrl('manifest/media3-00001.ts'),
    'first segment requested'
  );
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

  QUnit.strictEqual(
    this.requests[0].url,
    'manifest/master.m3u8',
    'master playlist requested'
  );
  QUnit.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/media1.m3u8'),
    'media playlist requested'
  );
  QUnit.strictEqual(
    this.requests[2].url,
    absoluteUrl('manifest/media1-00001.ts'),
    'first segment requested'
  );
});

QUnit.test('starts checking the buffer on init', function() {
  let player = createPlayer();
  let fills = 0;
  let drains = 0;

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
  QUnit.strictEqual(
    this.requests[0].url,
    'manifest/media.m3u8',
    'media playlist requested'
  );
});

// 'player.hls is deprecated. Use player.tech.hls instead.'
// 'Problem encountered with the current HLS playlist.
// Switching to another playlist.'
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
  QUnit.strictEqual(
    this.requests[0].url,
    absoluteUrl('manifest/media1.m3u8'),
    'media playlist requested'
  );
});

/* TODO: Failure
QUnit.test('calculates the bandwidth after downloading a segment', function() {
  this.player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  standardXHRResponse(this.requests[0]);

  // set the request time to be a bit earlier so our bandwidth calculations are not NaN
  this.requests[1].requestTime = (new Date())-100;

  standardXHRResponse(this.requests[1]);

  QUnit.ok(this.player.tech_.hls.bandwidth, 'bandwidth is calculated');
  QUnit.ok(
    this.player.tech_.hls.bandwidth > 0,
    'bandwidth is positive: ' + this.player.tech_.hls.bandwidth
  );
  QUnit.ok(
    this.player.tech_.hls.segmentXhrTime >= 0,
    'saves segment request time: ' + this.player.tech_.hls.segmentXhrTime + 's'
  );
});
*/

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
  let self = this;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);
  this.player.tech_.hls.selectPlaylist = function() {
    calls++;
    return self.player.tech_.hls.playlists.master.playlists[0];
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
  let self = this;

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

  this.player.tech_.hls.selectPlaylist = function() {
    selectedPlaylist = true;

    // this duration should be overwritten by the playlist change
    self.player.tech_.hls.mediaSource.duration = -Infinity;

    return self.player.tech_.hls.playlists.master.playlists[1];
  };

  // segment 0
  standardXHRResponse(this.requests[2]);
  // media1
  standardXHRResponse(this.requests[3]);
  QUnit.ok(selectedPlaylist, 'selected playlist');
  QUnit.ok(
    this.player.tech_.hls.mediaSource.duration !== -Infinity,
    'updates the duration'
  );
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
  QUnit.strictEqual(
    this.requests[3].url,
    absoluteUrl('manifest/' + playlist.uri),
    'made playlist request'
  );
  QUnit.strictEqual(
    playlist.uri,
    this.player.tech_.hls.playlists.media().uri,
    'a new playlists was selected'
  );
  QUnit.ok(
    this.player.tech_.hls.playlists.media().segments,
    'segments are now available'
  );
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
  QUnit.strictEqual(
    playlist,
    this.player.tech_.hls.playlists.master.playlists[1],
    'the low bitrate stream is selected'
  );
});

// TODO: Causes warning
// Problem encountered with the current HLS playlist.
// Switching to another playlist.
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
    '#EXT-X-TARGETDURATION:10\n'
  );
  QUnit.equal(
    this.player.tech_.hls.bandwidth,
    500,
    'prefers user-specified intial bandwidth'
  );
});

// TODO: Causes warning
// Problem encountered with the current HLS playlist.
// Switching to another playlist.
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

  QUnit.strictEqual(
    playlist,
    this.player.tech_.hls.playlists.master.playlists[1],
    'a lower bitrate stream is selected'
  );
});

// TODO: Causes warning
// Problem encountered with the current HLS playlist.
// Switching to another playlist.
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
  QUnit.strictEqual(
    playlist,
    this.player.tech_.hls.playlists.master.playlists[1],
    'the lowest bitrate stream is selected'
  );
});

/* TODO: Failure
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

  QUnit.deepEqual(
    playlist.attributes.RESOLUTION,
    {width:960, height:540},
    'should return the correct resolution by player dimensions'
  );
  QUnit.equal(
    playlist.attributes.BANDWIDTH,
    1928000,
    'should have the expected bandwidth in case of multiple'
  );

  this.player.width(1920);
  this.player.height(1080);
  this.player.tech_.hls.bandwidth = 3000000;

  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.deepEqual(
    playlist.attributes.RESOLUTION,
    {width:960, height:540},
    'should return the correct resolution by player dimensions'
  );
  QUnit.equal(
    playlist.attributes.BANDWIDTH,
    1928000,
    'should have the expected bandwidth in case of multiple'
  );

  this.player.width(396);
  this.player.height(224);
  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.deepEqual(
    playlist.attributes.RESOLUTION,
    {width:396, height:224},
    'should return the correct resolution by player dimensions, if exact match'
  );
  QUnit.equal(
    playlist.attributes.BANDWIDTH,
    440000,
    'should have the expected bandwidth in case of multiple, if exact match'
  );
});
*/

QUnit.test(
'selects the highest bitrate playlist when the player ' +
'dimensions are larger than any of the variants',
function() {
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
    'media1.m3u8\n'
  );
  // media
  standardXHRResponse(this.requests.shift());
  this.player.tech_.hls.bandwidth = 1e10;

  this.player.width(1024);
  this.player.height(768);

  playlist = this.player.tech_.hls.selectPlaylist();

  QUnit.equal(
    playlist.attributes.BANDWIDTH,
    1000,
    'selected the highest bandwidth variant'
  );
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
    'media1.m3u8\n'
  );
  // media
  standardXHRResponse(this.requests.shift());

  // exclude the current playlist
  this.player.tech_.hls.playlists.master.playlists[0].excludeUntil =
    +new Date() + 1000;
  playlist = this.player.tech_.hls.selectPlaylist();
  QUnit.equal(
    playlist,
    this.player.tech_.hls.playlists.master.playlists[1],
    'respected exclusions'
  );

  // timeout the exclusion
  this.clock.tick(1000);
  playlist = this.player.tech_.hls.selectPlaylist();
  QUnit.equal(
    playlist,
    this.player.tech_.hls.playlists.master.playlists[0],
    'expired the exclusion'
  );
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
    'media1.m3u8\n'
  );

  // media1
  standardXHRResponse(this.requests.shift());
  QUnit.equal(
    this.player.tech_.hls.playlists.media(),
    this.player.tech_.hls.playlists.master.playlists[1],
    'selected video+audio'
  );
  audioPlaylist = this.player.tech_.hls.playlists.master.playlists[0];
  QUnit.equal(
    audioPlaylist.excludeUntil,
    Infinity,
    'excluded incompatible playlist'
  );
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
    'media1.m3u8\n'
  );

  // media1
  standardXHRResponse(this.requests.shift());
  QUnit.equal(
    this.player.tech_.hls.playlists.media(),
    this.player.tech_.hls.playlists.master.playlists[0],
    'selected audio only'
  );
  videoAudioPlaylist =
    this.player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(
    videoAudioPlaylist.excludeUntil,
    Infinity,
    'excluded incompatible playlist'
  );
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
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n'
  );

  // media
  standardXHRResponse(this.requests.shift());
  QUnit.equal(
    this.player.tech_.hls.playlists.media(),
    this.player.tech_.hls.playlists.master.playlists[0],
    'selected video only'
  );
  videoAudioPlaylist =
    this.player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(
    videoAudioPlaylist.excludeUntil,
    Infinity,
    'excluded incompatible playlist'
  );
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
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400f,mp4a.40.5"\n' +
    'media1.m3u8\n'
  );

  // media
  standardXHRResponse(this.requests.shift());
  master = this.player.tech_.hls.playlists.master;
  QUnit.strictEqual(
    typeof master.playlists[0].excludeUntil,
    'undefined',
    'did not blacklist'
  );
  QUnit.strictEqual(
    typeof master.playlists[1].excludeUntil,
    'undefined',
    'did not blacklist'
  );
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
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.3"\n' +
    'media1.m3u8\n'
  );

  // media
  standardXHRResponse(this.requests.shift());
  master = this.player.tech_.hls.playlists.master;
  QUnit.strictEqual(
    typeof master.playlists[0].excludeUntil,
    'undefined',
    'did not blacklist'
  );
  QUnit.strictEqual(
    typeof master.playlists[1].excludeUntil,
    'undefined',
    'did not blacklist'
  );
});

QUnit.test(
'blacklists switching between playlists with incompatible audio codecs',
function() {
  let alternatePlaylist;

  this.player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(this.player, this.clock);

  this.player.tech_.hls.bandwidth = 1;
  // master
  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
    'media.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
    'media1.m3u8\n'
  );

  // media
  standardXHRResponse(this.requests.shift());
  QUnit.equal(
    this.player.tech_.hls.playlists.media(),
    this.player.tech_.hls.playlists.master.playlists[0],
    'selected HE-AAC stream'
  );
  alternatePlaylist =
    this.player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(
    alternatePlaylist.excludeUntil,
    Infinity,
    'excluded incompatible playlist'
  );
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
    return videojs.createTimeRange(0, currentTime + Hls.GOAL_BUFFER_LENGTH);
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

  QUnit.strictEqual(
    this.requests.length,
    2,
    'made two requests'
  );
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
  QUnit.strictEqual(
    this.requests[2].url,
    absoluteUrl('manifest/media-00002.ts'),
    'made segment request'
  );
});

QUnit.test('buffers based on the correct TimeRange if multiple ranges exist', function() {
  let currentTime = 8;
  let buffered = [[0, 10], [20, 30]];

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

  standardXHRResponse(this.requests[0]);
  standardXHRResponse(this.requests[1]);

  QUnit.strictEqual(this.requests.length, 2, 'made two requests');
  QUnit.strictEqual(
    this.requests[1].url,
    absoluteUrl('manifest/media-00002.ts'),
    'made segment request'
  );

  currentTime = 22;
  this.player.tech_.hls.sourceBuffer.trigger('updateend');
  this.player.tech_.hls.checkBuffer_();
  QUnit.strictEqual(
    this.requests.length,
    3,
    'made three requests'
  );
  QUnit.strictEqual(
    this.requests[2].url,
    absoluteUrl('manifest/media-00003.ts'),
    'made segment request'
  );
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

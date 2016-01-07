import videojs from 'video.js';
import sinon from 'sinon';
import QUnit from 'qunit';
import {Hls, HlsSourceHandler, HlsHandler} from '../src/plugin';

var
  Flash = videojs.getComponent('Flash'),
  oldFlash,
  clock,
  oldMediaSource,
  oldCreateUrl,
  oldSegmentParser,
  oldSourceBuffer,
  oldFlashSupported,
  oldNativeHlsSupport,
  oldDecrypt,
  oldGlobalOptions,
  requests,
  xhr,

  nextId = 0,

  // patch over some methods of the provided tech so it can be tested
  // synchronously with sinon's fake timers
  mockTech = function(tech) {
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
      return tech.time_ === undefined ? tech.currentTime_() : tech.time_;
    };

    tech.setSrc = function(src) {
      tech.src_ = src;
    };
    tech.src = function(src) {
      if (src !== undefined) {
        return tech.setSrc(src);
      }
      return tech.src_ === undefined ? tech.src : tech.src_;
    };
    tech.currentSrc_ = tech.currentSrc;
    tech.currentSrc = function() {
      return tech.src_ === undefined ? tech.currentSrc_() : tech.src_;
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

  createPlayer = function(options) {
    var video, player;
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
  },
  openMediaSource = function(player) {
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
  },
  standardXHRResponse = function(request) {
    if (!request.url) {
      return;
    }

    var contentType = "application/json",
        // contents off the global object
        manifestName = (/(?:.*\/)?(.*)\.m3u8/).exec(request.url);

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
    request.respond(200,
                    { 'Content-Type': contentType },
                    window.manifests[manifestName]);
  },

  // a no-op MediaSource implementation to allow synchronous testing
  MockMediaSource = videojs.extend(videojs.EventTarget, {
    constructor: function() {},
    duration: NaN,
    seekable: videojs.createTimeRange(),
    addSeekableRange_: function(start, end) {
      this.seekable = videojs.createTimeRange(start, end);
    },
    addSourceBuffer: function() {
      return new (videojs.extend(videojs.EventTarget, {
        constructor: function() {},
        abort: function() {},
        buffered: videojs.createTimeRange(),
        appendBuffer: function() {},
        remove: function() {}
      }))();
    },
    // endOfStream triggers an exception if flash isn't available
    endOfStream: function(error) {
      this.error_ = error;
    }
  }),

  // do a shallow copy of the properties of source onto the target object
  merge = function(target, source) {
    var name;
    for (name in source) {
      target[name] = source[name];
    }
  },

  // return an absolute version of a page-relative URL
  absoluteUrl = function(relativeUrl) {
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
  beforeEach: function() {
    // create the test player
    this.player = createPlayer();

    oldMediaSource = this.player.MediaSource;
    this.player.MediaSource = MockMediaSource;
    oldCreateUrl = this.player.URL.createObjectURL;
    this.player.URL.createObjectURL = function() {
      return 'blob:mock-vjs-object-url';
    };

    // mock out Flash features for phantomjs
    oldFlash = videojs.mergeOptions({}, Flash);
    Flash.embed = function(swf, flashVars) {
      var el = document.createElement('div');
      el.id = 'vjs_mock_flash_' + nextId++;
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
    oldFlashSupported = Flash.isSupported;
    Flash.isSupported = function() {
      return true;
    };

    oldSourceBuffer = window.this.player.SourceBuffer;
    window.videojs.SourceBuffer = function() {
      this.appendBuffer = function() {};
      this.abort = function() {};
    };

    // store functionality that some tests need to mock
    oldSegmentParser = this.player.Hls.SegmentParser;
    oldGlobalOptions = videojs.mergeOptions(videojs.options);

    // force the HLS tech to run
    oldNativeHlsSupport = this.player.Hls.supportsNativeHls;
    this.player.Hls.supportsNativeHls = false;

    oldDecrypt = this.player.Hls.Decrypter;
    this.player.Hls.Decrypter = function() {};

    // fake XHRs
    xhr = sinon.useFakeXMLHttpRequest();
    this.player.xhr.XMLHttpRequest = xhr;
    requests = [];
    xhr.onCreate = function(xhr) {
      requests.push(xhr);
    };

    // fake timers
    clock = sinon.useFakeTimers();

  },

  afterEach: function() {
    this.player.MediaSource = oldMediaSource;
    this.player.URL.createObjectURL = oldCreateUrl;

    merge(this.player.options, oldGlobalOptions);
    Flash.isSupported = oldFlashSupported;
    merge(Flash, oldFlash);

    this.player.Hls.SegmentParser = oldSegmentParser;
    this.player.Hls.supportsNativeHls = oldNativeHlsSupport;
    this.player.Hls.Decrypter = oldDecrypt;
    this.player.SourceBuffer = oldSourceBuffer;

    this.player.dispose();
    xhr.restore();
    this.player.xhr.XMLHttpRequest = window.XMLHttpRequest;
    clock.restore();
  }
});

QUnit.test('starts playing if autoplay is specified', function() {
  var plays = 0;
  player.autoplay(true);
  player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  // REMOVEME workaround https://github.com/videojs/video.js/issues/2326
  player.tech_.triggerReady();
  clock.tick(1);
  // make sure play() is called *after* the media source opens
  player.tech_.hls.play = function() {
    plays++;
  };
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  QUnit.strictEqual(1, plays, 'play was called');
});

QUnit.test('autoplay seeks to the live point after playlist load', function() {
  var currentTime = 0;
  player.autoplay(true);
  player.on('seeking', function() {
    currentTime = player.currentTime();
  });
  player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.readyState = function(){return 1;};
  player.tech_.trigger('play');
  standardXHRResponse(requests.shift());
  clock.tick(1);

  notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test('autoplay seeks to the live point after media source open', function() {
  var currentTime = 0;
  player.autoplay(true);
  player.on('seeking', function() {
    currentTime = player.currentTime();
  });
  player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech_.triggerReady();
  clock.tick(1);
  standardXHRResponse(requests.shift());
  openMediaSource(player);
  player.tech_.readyState = function(){return 1;};
  player.tech_.trigger('play');
  clock.tick(1);

  notEqual(currentTime, 0, 'seeked on autoplay');
});

QUnit.test('duration is set when the source opens after the playlist is loaded', function() {
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech_.triggerReady();
  clock.tick(1);
  standardXHRResponse(requests.shift());
  openMediaSource(player);

  QUnit.equal(player.tech_.hls.mediaSource.duration , 40, 'set the duration');
});

QUnit.test('calls `remove` on sourceBuffer to when loading a live segment', function() {
  var
    removes = [],
    seekable = videojs.createTimeRanges([[60, 120]]);

  player.src({
    src: 'liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.seekable = function(){
    return seekable;
  };

  openMediaSource(player);
  player.tech_.hls.mediaSource.addSourceBuffer = function() {
    return new (videojs.extend(videojs.EventTarget, {
      constructor: function() {},
      abort: function() {},
      buffered: videojs.createTimeRange(),
      appendBuffer: function() {},
      remove: function(start, end) {
        removes.push([start, end]);
      }
    }))();
  };
  player.tech_.hls.bandwidth = 20e10;
  player.tech_.triggerReady();
  standardXHRResponse(requests[0]);

  player.tech_.hls.playlists.trigger('loadedmetadata');
  player.tech_.trigger('canplay');
  player.tech_.paused = function() { return false; };
  player.tech_.readyState = function(){return 1;};
  player.tech_.trigger('play');

  clock.tick(1);
  standardXHRResponse(requests[1]);

  QUnit.strictEqual(requests[0].url, 'liveStart30sBefore.m3u8', 'master playlist requested');
  QUnit.equal(removes.length, 1, 'remove called');
  QUnit.deepEqual(removes[0], [0, seekable.start(0)], 'remove called with the right range');
});

QUnit.test('calls `remove` on sourceBuffer to when loading a vod segment', function() {
  var removes = [];
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.mediaSource.addSourceBuffer = function() {
    return new (videojs.extend(videojs.EventTarget, {
      constructor: function() {},
      abort: function() {},
      buffered: videojs.createTimeRange(),
      appendBuffer: function() {},
      remove: function(start, end) {
        removes.push([start, end]);
      }
    }))();
  };
  player.tech_.hls.bandwidth = 20e10;
  standardXHRResponse(requests[0]);
  player.currentTime(120);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  QUnit.strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  QUnit.strictEqual(requests[1].url,
              absoluteUrl('manifest/media3.m3u8'),
              'media playlist requested');
  QUnit.equal(removes.length, 1, 'remove called');
  QUnit.deepEqual(removes[0], [0, 120 - 60], 'remove called with the right range');
});

QUnit.test('codecs are passed to the source buffer', function() {
  var codecs = [];
  player.src({
    src: 'custom-codecs.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.mediaSource.addSourceBuffer = function(codec) {
    codecs.push(codec);
  };

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:CODECS="video, audio"\n' +
                           'media.m3u8\n');
  standardXHRResponse(requests.shift());
  QUnit.equal(codecs.length, 1, 'created a source buffer');
  QUnit.equal(codecs[0], 'video/mp2t; codecs="video, audio"', 'specified the codecs');
});

QUnit.test('including HLS as a tech does not error', function() {
  var player = createPlayer({
    techOrder: ['hls', 'html5']
  });

  QUnit.ok(player, 'created the player');
});

QUnit.test('creates a PlaylistLoader on init', function() {
  player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.src({
    src:'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  QUnit.equal(requests[0].aborted, true, 'aborted previous src');
  standardXHRResponse(requests[1]);
  QUnit.ok(player.tech_.hls.playlists.master, 'set the master playlist');
  QUnit.ok(player.tech_.hls.playlists.media(), 'set the media playlist');
  QUnit.ok(player.tech_.hls.playlists.media().segments, 'the segment entries are parsed');
  QUnit.strictEqual(player.tech_.hls.playlists.master.playlists[0],
              player.tech_.hls.playlists.media(),
              'the playlist is selected');
});

QUnit.test('re-initializes the playlist loader when switching sources', function() {
  // source is set
  player.src({
    src:'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  // loader gets media playlist
  standardXHRResponse(requests.shift());
  // request a segment
  standardXHRResponse(requests.shift());
  // change the source
  player.src({
    src:'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  // maybe not needed if https://github.com/videojs/video.js/issues/2326 gets fixed
  clock.tick(1);
  QUnit.ok(!player.tech_.hls.playlists.media(), 'no media playlist');
  QUnit.equal(player.tech_.hls.playlists.state,
        'HAVE_NOTHING',
        'reset the playlist loader state');
  QUnit.equal(requests.length, 1, 'requested the new src');

  // buffer check
  player.tech_.hls.checkBuffer_();
  QUnit.equal(requests.length, 1, 'did not request a stale segment');

  // sourceopen
  openMediaSource(player);

  QUnit.equal(requests.length, 1, 'made one request');
  QUnit.ok(requests[0].url.indexOf('master.m3u8') >= 0, 'requested only the new playlist');
});

QUnit.test('sets the duration if one is available on the playlist', function() {
  var events = 0;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.on('durationchange', function() {
    events++;
  });

  standardXHRResponse(requests[0]);
  QUnit.equal(player.tech_.hls.mediaSource.duration, 40, 'set the duration');
  QUnit.equal(events, 1, 'durationchange is fired');
});

QUnit.test('estimates individual segment durations if needed', function() {
  var changes = 0;
  player.src({
    src: 'http://example.com/manifest/missingExtinf.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.mediaSource.duration = NaN;
  player.tech_.on('durationchange', function() {
    changes++;
  });

  standardXHRResponse(requests[0]);
  QUnit.strictEqual(player.tech_.hls.mediaSource.duration,
              player.tech_.hls.playlists.media().segments.length * 10,
              'duration is updated');
  QUnit.strictEqual(changes, 1, 'one durationchange fired');
});

QUnit.test('translates seekable by the starting time for live playlists', function() {
  var seekable;
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
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

  seekable = player.seekable();
  QUnit.equal(seekable.length, 1, 'one seekable range');
  QUnit.equal(seekable.start(0), 0, 'the earliest possible position is at zero');
  QUnit.equal(seekable.end(0), 10, 'end is relative to the start');
});

QUnit.test('starts downloading a segment on loadedmetadata', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.buffered = function() {
    return videojs.createTimeRange(0, 0);
  };
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  QUnit.strictEqual(requests[1].url,
              absoluteUrl('manifest/media-00001.ts'),
              'the first segment is requested');
});

QUnit.test('finds the correct buffered region based on currentTime', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech_.buffered = function() {
    return videojs.createTimeRanges([[0, 5], [6, 12]]);
  };
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  player.currentTime(3);
  clock.tick(1);
  QUnit.equal(player.tech_.hls.findBufferedRange_().end(0),
        5, 'inside the first buffered region');
  player.currentTime(6);
  clock.tick(1);
  QUnit.equal(player.tech_.hls.findBufferedRange_().end(0),
        12, 'inside the second buffered region');
});

QUnit.test('recognizes absolute URIs and requests them unmodified', function() {
  player.src({
    src: 'manifest/absoluteUris.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  QUnit.strictEqual(requests[1].url,
              'http://example.com/00001.ts',
              'the first segment is requested');
});

QUnit.test('recognizes domain-relative URLs', function() {
  player.src({
    src: 'manifest/domainUris.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  QUnit.strictEqual(requests[1].url,
              window.location.protocol + '//' + window.location.host +
              '/00001.ts',
              'the first segment is requested');
});

QUnit.test('re-initializes the handler for each source', function() {
  var firstPlaylists, secondPlaylists, firstMSE, secondMSE, aborts;

  aborts = 0;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  firstPlaylists = player.tech_.hls.playlists;
  firstMSE = player.tech_.hls.mediaSource;
  standardXHRResponse(requests.shift());
  standardXHRResponse(requests.shift());
  player.tech_.hls.sourceBuffer.abort = function() {
    aborts++;
  };

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  secondPlaylists = player.tech_.hls.playlists;
  secondMSE = player.tech_.hls.mediaSource;

  QUnit.equal(1, aborts, 'aborted the old source buffer');
  QUnit.ok(requests[0].aborted, 'aborted the old segment request');
  QUnit.notStrictEqual(firstPlaylists, secondPlaylists, 'the playlist object is not reused');
  QUnit.notStrictEqual(firstMSE, secondMSE, 'the media source object is not reused');
});

QUnit.test('triggers an error when a master playlist request errors', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.pop().respond(500);

  QUnit.equal(player.tech_.hls.mediaSource.error_, 'network', 'a network error is triggered');
});

QUnit.test('downloads media playlists after loading the master', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 20e10;
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  QUnit.strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  QUnit.strictEqual(requests[1].url,
              absoluteUrl('manifest/media3.m3u8'),
              'media playlist requested');
  QUnit.strictEqual(requests[2].url,
              absoluteUrl('manifest/media3-00001.ts'),
              'first segment requested');
});

QUnit.test('upshifts if the initial bandwidth hint is high', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 10e20;
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  QUnit.strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  QUnit.strictEqual(requests[1].url,
              absoluteUrl('manifest/media3.m3u8'),
              'media playlist requested');
  QUnit.strictEqual(requests[2].url,
              absoluteUrl('manifest/media3-00001.ts'),
              'first segment requested');
});

QUnit.test('downshifts if the initial bandwidth hint is low', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 100;
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  QUnit.strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  QUnit.strictEqual(requests[1].url,
              absoluteUrl('manifest/media1.m3u8'),
              'media playlist requested');
  QUnit.strictEqual(requests[2].url,
              absoluteUrl('manifest/media1-00001.ts'),
              'first segment requested');
});

QUnit.test('starts checking the buffer on init', function() {
  var player, fills = 0, drains = 0;

  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  // wait long enough for the buffer check interval to expire and
  // trigger fill/drainBuffer
  player.tech_.hls.fillBuffer = function() {
    fills++;
  };
  player.tech_.hls.drainBuffer = function() {
    drains++;
  };
  clock.tick(500);
  QUnit.equal(fills, 1, 'called fillBuffer');
  QUnit.equal(drains, 1, 'called drainBuffer');

  player.dispose();
  clock.tick(100 * 1000);
  QUnit.equal(fills, 1, 'did not call fillBuffer again');
  QUnit.equal(drains, 1, 'did not call drainBuffer again');
});

QUnit.test('buffer checks are noops until a media playlist is ready', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.checkBuffer_();

  QUnit.strictEqual(1, requests.length, 'one request was made');
  QUnit.strictEqual(requests[0].url, 'manifest/media.m3u8', 'media playlist requested');
});

QUnit.test('buffer checks are noops when only the master is ready', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media
  // ignore any outstanding segment requests
  requests.length = 0;

  // load in a new playlist which will cause playlists.media() to be
  // undefined while it is being fetched
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  // respond with the master playlist but don't send the media playlist yet
  player.tech_.hls.bandwidth = 1; // force media1 to be requested
  standardXHRResponse(requests.shift()); // master
  // trigger fillBuffer()
  player.tech_.hls.checkBuffer_();

  QUnit.strictEqual(1, requests.length, 'one request was made');
  QUnit.strictEqual(requests[0].url,
              absoluteUrl('manifest/media1.m3u8'),
              'media playlist requested');
});

QUnit.test('calculates the bandwidth after downloading a segment', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  // set the request time to be a bit earlier so our bandwidth calculations are not NaN
  requests[1].requestTime = (new Date())-100;

  standardXHRResponse(requests[1]);

  QUnit.ok(player.tech_.hls.bandwidth, 'bandwidth is calculated');
  QUnit.ok(player.tech_.hls.bandwidth > 0,
     'bandwidth is positive: ' + player.tech_.hls.bandwidth);
  QUnit.ok(player.tech_.hls.segmentXhrTime >= 0,
     'saves segment request time: ' + player.tech_.hls.segmentXhrTime + 's');
});

QUnit.test('fires a progress event after downloading a segment', function() {
  var progressCount = 0;

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift());
  player.on('progress', function() {
    progressCount++;
  });
  standardXHRResponse(requests.shift());

  QUnit.equal(progressCount, 1, 'fired a progress event');
});

QUnit.test('selects a playlist after segment downloads', function() {
  var calls = 0;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.selectPlaylist = function() {
    calls++;
    return player.tech_.hls.playlists.master.playlists[0];
  };

  standardXHRResponse(requests[0]); // master
  standardXHRResponse(requests[1]); // media
  standardXHRResponse(requests[2]); // segment

  QUnit.strictEqual(calls, 2, 'selects after the initial segment');
  player.currentTime = function() {
    return 1;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 2);
  };
  player.tech_.hls.sourceBuffer.trigger('updateend');
  player.tech_.hls.checkBuffer_();

  standardXHRResponse(requests[3]);

  QUnit.strictEqual(calls, 3, 'selects after additional segments');
});

QUnit.test('updates the duration after switching playlists', function() {
  var selectedPlaylist = false;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 1e20;
  standardXHRResponse(requests[0]); // master
  standardXHRResponse(requests[1]); // media3

  player.tech_.hls.selectPlaylist = function() {
    selectedPlaylist = true;

    // this duration should be overwritten by the playlist change
    player.tech_.hls.mediaSource.duration = -Infinity;

    return player.tech_.hls.playlists.master.playlists[1];
  };

  standardXHRResponse(requests[2]); // segment 0
  standardXHRResponse(requests[3]); // media1
  QUnit.ok(selectedPlaylist, 'selected playlist');
  QUnit.ok(player.tech_.hls.mediaSource.duration !== -Infinity, 'updates the duration');
});

QUnit.test('downloads additional playlists if required', function() {
  var
    called = false,
    playlist = {
      uri: 'media3.m3u8'
    };
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 20000;
  standardXHRResponse(requests[0]);

  standardXHRResponse(requests[1]);
  // before an m3u8 is downloaded, no segments are available
  player.tech_.hls.selectPlaylist = function() {
    if (!called) {
      called = true;
      return playlist;
    }
    playlist.segments = [1, 1, 1];
    return playlist;
  };

  // the playlist selection is revisited after a new segment is downloaded
  player.trigger('timeupdate');

  requests[2].bandwidth = 3000000;
  requests[2].response = new Uint8Array([0]);
  requests[2].respond(200, null, '');
  standardXHRResponse(requests[3]);

  QUnit.strictEqual(4, requests.length, 'requests were made');
  QUnit.strictEqual(requests[3].url,
              absoluteUrl('manifest/' + playlist.uri),
              'made playlist request');
  QUnit.strictEqual(playlist.uri,
              player.tech_.hls.playlists.media().uri,
              'a new playlists was selected');
  QUnit.ok(player.tech_.hls.playlists.media().segments, 'segments are now available');
});

QUnit.test('selects a playlist below the current bandwidth', function() {
  var playlist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  // the default playlist has a really high bitrate
  player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 9e10;
  // playlist 1 has a very low bitrate
  player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 1;
  // but the detected client bandwidth is really low
  player.tech_.hls.bandwidth = 10;

  playlist = player.tech_.hls.selectPlaylist();
  QUnit.strictEqual(playlist,
              player.tech_.hls.playlists.master.playlists[1],
              'the low bitrate stream is selected');
});

QUnit.test('allows initial bandwidth to be provided', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.bandwidth = 500;

  requests[0].bandwidth = 1;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                           '#EXT-X-TARGETDURATION:10\n');
  QUnit.equal(player.tech_.hls.bandwidth, 500, 'prefers user-specified intial bandwidth');
});

QUnit.test('raises the minimum bitrate for a stream proportionially', function() {
  var playlist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  // the default playlist's bandwidth + 10% is equal to the current bandwidth
  player.tech_.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 10;
  player.tech_.hls.bandwidth = 11;

  // 9.9 * 1.1 < 11
  player.tech_.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 9.9;
  playlist = player.tech_.hls.selectPlaylist();

  QUnit.strictEqual(playlist,
              player.tech_.hls.playlists.master.playlists[1],
              'a lower bitrate stream is selected');
});

QUnit.test('uses the lowest bitrate if no other is suitable', function() {
  var playlist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  // the lowest bitrate playlist is much greater than 1b/s
  player.tech_.hls.bandwidth = 1;
  playlist = player.tech_.hls.selectPlaylist();

  // playlist 1 has the lowest advertised bitrate
  QUnit.strictEqual(playlist,
              player.tech_.hls.playlists.master.playlists[1],
              'the lowest bitrate stream is selected');
});

QUnit.test('selects the correct rendition by player dimensions', function() {
  var playlist;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.width(640);
  player.height(360);
  player.tech_.hls.bandwidth = 3000000;

  playlist = player.tech_.hls.selectPlaylist();

  QUnit.deepEqual(playlist.attributes.RESOLUTION, {width:960,height:540},'should return the correct resolution by player dimensions');
  QUnit.equal(playlist.attributes.BANDWIDTH, 1928000, 'should have the expected bandwidth in case of multiple');

  player.width(1920);
  player.height(1080);
  player.tech_.hls.bandwidth = 3000000;

  playlist = player.tech_.hls.selectPlaylist();

  QUnit.deepEqual(playlist.attributes.RESOLUTION, {
    width:960,
    height:540
  },'should return the correct resolution by player dimensions');
  QUnit.equal(playlist.attributes.BANDWIDTH, 1928000, 'should have the expected bandwidth in case of multiple');

  player.width(396);
  player.height(224);
  playlist = player.tech_.hls.selectPlaylist();

  QUnit.deepEqual(playlist.attributes.RESOLUTION, {
    width:396,
    height:224
  },'should return the correct resolution by player dimensions, if exact match');
  QUnit.equal(playlist.attributes.BANDWIDTH, 440000, 'should have the expected bandwidth in case of multiple, if exact match');

});

QUnit.test('selects the highest bitrate playlist when the player dimensions are ' +
     'larger than any of the variants', function() {
  var playlist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=2x1\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x1\n' +
                           'media1.m3u8\n'); // master
  standardXHRResponse(requests.shift()); // media
  player.tech_.hls.bandwidth = 1e10;

  player.width(1024);
  player.height(768);

  playlist = player.tech_.hls.selectPlaylist();

  QUnit.equal(playlist.attributes.BANDWIDTH,
        1000,
        'selected the highest bandwidth variant');
});

QUnit.test('filters playlists that are currently excluded', function() {
  var playlist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 1e10;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'media1.m3u8\n'); // master
  standardXHRResponse(requests.shift()); // media

  // exclude the current playlist
  player.tech_.hls.playlists.master.playlists[0].excludeUntil = +new Date() + 1000;
  playlist = player.tech_.hls.selectPlaylist();
  QUnit.equal(playlist, player.tech_.hls.playlists.master.playlists[1], 'respected exclusions');

  // timeout the exclusion
  clock.tick(1000);
  playlist = player.tech_.hls.selectPlaylist();
  QUnit.equal(playlist, player.tech_.hls.playlists.master.playlists[0], 'expired the exclusion');
});

QUnit.test('blacklists switching from video+audio playlists to audio only', function() {
  var audioPlaylist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 1e10;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                           'media1.m3u8\n'); // master

  standardXHRResponse(requests.shift()); // media1
  QUnit.equal(player.tech_.hls.playlists.media(),
        player.tech_.hls.playlists.master.playlists[1],
        'selected video+audio');
  audioPlaylist = player.tech_.hls.playlists.master.playlists[0];
  QUnit.equal(audioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

QUnit.test('blacklists switching from audio-only playlists to video+audio', function() {
  var videoAudioPlaylist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 1;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="mp4a.40.2"\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1x1\n' +
                           'media1.m3u8\n'); // master

  standardXHRResponse(requests.shift()); // media1
  QUnit.equal(player.tech_.hls.playlists.media(),
        player.tech_.hls.playlists.master.playlists[0],
        'selected audio only');
  videoAudioPlaylist = player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(videoAudioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

QUnit.test('blacklists switching from video-only playlists to video+audio', function() {
  var videoAudioPlaylist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 1;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d"\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
                           'media1.m3u8\n'); // master

  standardXHRResponse(requests.shift()); // media
  QUnit.equal(player.tech_.hls.playlists.media(),
        player.tech_.hls.playlists.master.playlists[0],
        'selected video only');
  videoAudioPlaylist = player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(videoAudioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

QUnit.test('does not blacklist compatible H.264 codec strings', function() {
  var master;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 1;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400f,mp4a.40.5"\n' +
                           'media1.m3u8\n'); // master

  standardXHRResponse(requests.shift()); // media
  master = player.tech_.hls.playlists.master;
  QUnit.strictEqual(master.playlists[0].excludeUntil, undefined, 'did not blacklist');
  QUnit.strictEqual(master.playlists[1].excludeUntil, undefined, 'did not blacklist');
});

QUnit.test('does not blacklist compatible AAC codec strings', function() {
  var master;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 1;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.2"\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.3"\n' +
                           'media1.m3u8\n'); // master

  standardXHRResponse(requests.shift()); // media
  master = player.tech_.hls.playlists.master;
  QUnit.strictEqual(master.playlists[0].excludeUntil, undefined, 'did not blacklist');
  QUnit.strictEqual(master.playlists[1].excludeUntil, undefined, 'did not blacklist');
});

QUnit.test('blacklists switching between playlists with incompatible audio codecs', function() {
  var alternatePlaylist;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 1;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4d400d,mp4a.40.5"\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=10,CODECS="avc1.4d400d,mp4a.40.2"\n' +
                           'media1.m3u8\n'); // master

  standardXHRResponse(requests.shift()); // media
  QUnit.equal(player.tech_.hls.playlists.media(),
        player.tech_.hls.playlists.master.playlists[0],
        'selected HE-AAC stream');
  alternatePlaylist = player.tech_.hls.playlists.master.playlists[1];
  QUnit.equal(alternatePlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

QUnit.test('does not download the next segment if the buffer is full', function() {
  var currentTime = 15;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech_.currentTime = function() {
    return currentTime;
  };
  player.tech_.buffered = function() {
    return videojs.createTimeRange(0, currentTime + this.player.Hls.GOAL_BUFFER_LENGTH);
  };
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.trigger('timeupdate');

  QUnit.strictEqual(requests.length, 1, 'no segment request was made');
});

QUnit.test('downloads the next segment if the buffer is getting low', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  QUnit.strictEqual(requests.length, 2, 'made two requests');
  player.tech_.currentTime = function() {
    return 15;
  };
  player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 19.999);
  };
  player.tech_.hls.sourceBuffer.trigger('updateend');
  player.tech_.hls.checkBuffer_();

  standardXHRResponse(requests[2]);

  QUnit.strictEqual(requests.length, 3, 'made a request');
  QUnit.strictEqual(requests[2].url,
              absoluteUrl('manifest/media-00002.ts'),
              'made segment request');
});

QUnit.test('buffers based on the correct TimeRange if multiple ranges exist', function() {
  var currentTime, buffered;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.currentTime = function() {
    return currentTime;
  };
  player.tech_.buffered = function() {
    return videojs.createTimeRange(buffered);
  };
  currentTime = 8;
  buffered = [[0, 10], [20, 30]];

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  QUnit.strictEqual(requests.length, 2, 'made two requests');
  QUnit.strictEqual(requests[1].url,
              absoluteUrl('manifest/media-00002.ts'),
              'made segment request');

  currentTime = 22;
  player.tech_.hls.sourceBuffer.trigger('updateend');
  player.tech_.hls.checkBuffer_();
  QUnit.strictEqual(requests.length, 3, 'made three requests');
  QUnit.strictEqual(requests[2].url,
              absoluteUrl('manifest/media-00003.ts'),
              'made segment request');
});

QUnit.test('stops downloading segments at the end of the playlist', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests[0]);
  requests = [];
  player.tech_.hls.mediaIndex = 4;
  player.trigger('timeupdate');

  QUnit.strictEqual(requests.length, 0, 'no request is made');
});

QUnit.test('only makes one segment request at a time', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop());
  player.trigger('timeupdate');

  QUnit.strictEqual(1, requests.length, 'one XHR is made');
  player.trigger('timeupdate');
  QUnit.strictEqual(1, requests.length, 'only one XHR is made');
});

QUnit.test('only appends one segment at a time', function() {
  var appends = 0;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop()); // media.m3u8
  player.tech_.hls.sourceBuffer.appendBuffer = function() {
    appends++;
  };

  standardXHRResponse(requests.pop()); // segment 0

  player.tech_.hls.checkBuffer_();
  QUnit.equal(requests.length, 0, 'did not request while updating');

  player.tech_.hls.checkBuffer_();
  QUnit.equal(appends, 1, 'appended once');
});

QUnit.test('waits to download new segments until the media playlist is stable', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.bandwidth = 1; // make sure we stay on the lowest variant
  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media1

  // force a playlist switch
  player.tech_.hls.playlists.media('media3.m3u8');

  standardXHRResponse(requests.shift()); // segment 0
  player.tech_.hls.sourceBuffer.trigger('updateend');

  QUnit.equal(requests.length, 1, 'only the playlist request outstanding');
  player.tech_.hls.checkBuffer_();
  QUnit.equal(requests.length, 1, 'delays segment fetching');

  standardXHRResponse(requests.shift()); // media3
  player.tech_.hls.checkBuffer_();
  QUnit.equal(requests.length, 1, 'resumes segment fetching');
});

QUnit.test('cancels outstanding XHRs when seeking', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests[0]);
  player.tech_.hls.media = {
    segments: [{
      uri: '0.ts',
      duration: 10
    }, {
      uri: '1.ts',
      duration: 10
    }]
  };

  // attempt to seek while the download is in progress
  player.currentTime(7);
  clock.tick(1);

  QUnit.ok(requests[1].aborted, 'XHR aborted');
  QUnit.strictEqual(requests.length, 3, 'opened new XHR');
});

QUnit.test('when outstanding XHRs are cancelled, they get aborted properly', function() {
  var readystatechanges = 0;

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests[0]);

  // trigger a segment download request
  player.trigger('timeupdate');

  player.tech_.hls.segmentXhr_.onreadystatechange = function() {
    readystatechanges++;
  };

  // attempt to seek while the download is in progress
  player.currentTime(12);
  clock.tick(1);

  QUnit.ok(requests[1].aborted, 'XHR aborted');
  QUnit.strictEqual(requests.length, 3, 'opened new XHR');
  notEqual(player.tech_.hls.segmentXhr_.url, requests[1].url, 'a new segment is request that is not the aborted one');
  QUnit.strictEqual(readystatechanges, 0, 'onreadystatechange was not called');
});

QUnit.test('segmentXhr is properly nulled out when dispose is called', function() {
  var
    readystatechanges = 0,
    oldDispose = Flash.prototype.dispose,
    player;
  Flash.prototype.dispose = function() {};

  player = createPlayer();
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests[0]);

  // trigger a segment download request
  player.trigger('timeupdate');

  player.tech_.hls.segmentXhr_.onreadystatechange = function() {
    readystatechanges++;
  };

  player.tech_.hls.dispose();

  QUnit.ok(requests[1].aborted, 'XHR aborted');
  QUnit.strictEqual(requests.length, 2, 'did not open a new XHR');
  QUnit.equal(player.tech_.hls.segmentXhr_, null, 'the segment xhr is nulled out');
  QUnit.strictEqual(readystatechanges, 0, 'onreadystatechange was not called');

  Flash.prototype.dispose = oldDispose;
});

QUnit.test('does not modify the media index for in-buffer seeking', function() {
  var mediaIndex;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift());
  player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };
  mediaIndex = player.tech_.hls.mediaIndex;

  player.tech_.setCurrentTime(11);
  clock.tick(1);
  QUnit.equal(player.tech_.hls.mediaIndex, mediaIndex, 'did not interrupt buffering');
  QUnit.equal(requests.length, 1, 'did not abort the outstanding request');
});

QUnit.test('playlist 404 should end stream with a network error', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.pop().respond(404);

  QUnit.equal(player.tech_.hls.mediaSource.error_, 'network', 'set a network error');
});

QUnit.test('segment 404 should trigger blacklisting of media', function () {
  var media;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 20000;
  standardXHRResponse(requests[0]); // master
  standardXHRResponse(requests[1]); // media

  media = player.tech_.hls.playlists.media_;

  requests[2].respond(400); // segment
  QUnit.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
});

QUnit.test('playlist 404 should blacklist media', function () {
  var media, url;

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 1e10;
  requests[0].respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1000\n' +
                           'media.m3u8\n' +
                           '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
                           'media1.m3u8\n'); // master

  QUnit.equal(player.tech_.hls.playlists.media_, undefined, 'no media is initially set');

  requests[1].respond(400); // media

  url = requests[1].url.slice(requests[1].url.lastIndexOf('/') + 1);
  media = player.tech_.hls.playlists.master.playlists[url];

  QUnit.ok(media.excludeUntil > 0, 'original media blacklisted for some time');
});

QUnit.test('seeking in an empty playlist is a non-erroring noop', function() {
  var requestsLength;

  player.src({
    src: 'manifest/empty-live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.shift().respond(200, null, '#EXTM3U\n');

  requestsLength = requests.length;
  player.tech_.setCurrentTime(183);
  clock.tick(1);

  QUnit.equal(requests.length, requestsLength, 'made no additional requests');
});

QUnit.test('sets seekable and duration for live playlists', function() {
  player.src({
    src: 'http://example.com/manifest/missingEndlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  QUnit.equal(player.tech_.hls.mediaSource.seekable.length,
        1,
        'set one seekable range');
  QUnit.equal(player.tech_.hls.mediaSource.seekable.start(0),
        player.tech_.hls.seekable().start(0),
        'set seekable start');
  QUnit.equal(player.tech_.hls.mediaSource.seekable.end(0),
        player.tech_.hls.seekable().end(0),
        'set seekable end');

  QUnit.strictEqual(player.tech_.hls.mediaSource.duration,
              Infinity,
              'duration on the mediaSource is infinity');
});

QUnit.test('live playlist starts three target durations before live', function() {
  var mediaPlaylist;
  player.src({
    src: 'live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
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

  QUnit.equal(requests.length, 0, 'no outstanding segment request');

  player.tech_.paused = function() { return false; };
  player.tech_.readyState = function(){return 1;};
  player.tech_.trigger('play');
  clock.tick(1);
  mediaPlaylist = player.tech_.hls.playlists.media();
  QUnit.equal(player.currentTime(), player.tech_.hls.seekable().end(0), 'seeked to the seekable end');

  QUnit.equal(requests.length, 1, 'begins buffering');
});

QUnit.test('live playlist starts with correct currentTime value', function() {
  player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.tech_.hls.playlists.trigger('loadedmetadata');

  player.tech_.paused = function() { return false; };
  player.tech_.readyState = function(){return 1;};
  player.tech_.trigger('play');
  clock.tick(1);

  QUnit.strictEqual(player.currentTime(),
              this.player.Hls.Playlist.seekable(player.tech_.hls.playlists.media()).end(0),
              'currentTime is updated at playback');
});

QUnit.test('adjusts the seekable start based on the amount of expired live content', function() {
  player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests.shift());

  // add timeline info to the playlist
  player.tech_.hls.playlists.media().segments[1].end = 29.5;
  // expired_ should be ignored if there is timeline information on
  // the playlist
  player.tech_.hls.playlists.expired_ = 172;

  QUnit.equal(player.seekable().start(0),
        29.5 - 29,
        'offset the seekable start');
});

QUnit.test('estimates seekable ranges for live streams that have been paused for a long time', function() {
  player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests.shift());
  player.tech_.hls.playlists.expired_ = 172;

  QUnit.equal(player.seekable().start(0),
        player.tech_.hls.playlists.expired_,
        'offset the seekable start');
});

QUnit.test('resets the time to a seekable position when resuming a live stream ' +
     'after a long break', function() {
  var seekTarget;
  player.src({
    src: 'live0.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:16\n' +
                           '#EXTINF:10,\n' +
                           '16.ts\n');
  // mock out the player to simulate a live stream that has been
  // playing for awhile
  player.tech_.hls.seekable = function() {
    return videojs.createTimeRange(160, 170);
  };
  player.tech_.setCurrentTime = function(time) {
    if (time !== undefined) {
      seekTarget = time;
    }
  };
  player.tech_.played = function() {
    return videojs.createTimeRange(120, 170);
  };
  player.tech_.trigger('playing');

  player.tech_.trigger('play');
  QUnit.equal(seekTarget, player.seekable().start(0), 'seeked to the start of seekable');
  player.tech_.trigger('seeked');
});

QUnit.test('reloads out-of-date live playlists when switching variants', function() {
  player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.master = {
    playlists: [{
      mediaSequence: 15,
      segments: [1, 1, 1]
    }, {
      uri: 'http://example.com/variant-update.m3u8',
      mediaSequence: 0,
      segments: [1, 1]
    }]
  };
  // playing segment 15 on playlist zero
  player.tech_.hls.media = player.tech_.hls.master.playlists[0];
  player.mediaIndex = 1;
  window.manifests['variant-update'] = '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:16\n' +
    '#EXTINF:10,\n' +
    '16.ts\n' +
    '#EXTINF:10,\n' +
    '17.ts\n';

  // switch playlists
  player.tech_.hls.selectPlaylist = function() {
    return player.tech_.hls.master.playlists[1];
  };
  // timeupdate downloads segment 16 then switches playlists
  player.trigger('timeupdate');

  QUnit.strictEqual(player.mediaIndex, 1, 'mediaIndex points at the next segment');
});

QUnit.test('if withCredentials global option is used, withCredentials is set on the XHR object', function() {
  var hlsOptions = videojs.options.hls;
  player.dispose();
  videojs.options.hls = {
    withCredentials: true
  };
  player = createPlayer();
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  QUnit.ok(requests[0].withCredentials,
     'with credentials should be set to true if that option is passed in');
  videojs.options.hls = hlsOptions;
});

QUnit.test('if withCredentials src option is used, withCredentials is set on the XHR object', function() {
  player.dispose();
  player = createPlayer();
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: true
  });
  openMediaSource(player);
  QUnit.ok(requests[0].withCredentials,
     'with credentials should be set to true if that option is passed in');
});

QUnit.test('src level credentials supersede the global options', function() {
  player.dispose();
  player = createPlayer();
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: true
  });
  openMediaSource(player);
  QUnit.ok(requests[0].withCredentials,
     'with credentials should be set to true if that option is passed in');

});

QUnit.test('does not break if the playlist has no segments', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  try {
    openMediaSource(player);
    requests[0].respond(200, null,
                        '#EXTM3U\n' +
                        '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                        '#EXT-X-TARGETDURATION:10\n');
  } catch(e) {
    QUnit.ok(false, 'an error was thrown');
    throw e;
  }
  QUnit.ok(true, 'no error was thrown');
  QUnit.strictEqual(requests.length, 1, 'no requests for non-existent segments were queued');
});

QUnit.test('aborts segment processing on seek', function() {
  var currentTime = 0;
  player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.currentTime = function() {
    return currentTime;
  };
  player.tech_.buffered = function() {
    return videojs.createTimeRange();
  };

  requests.shift().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                         '#EXTINF:10,0\n' +
                         '1.ts\n' +
                         '#EXT-X-DISCONTINUITY\n' +
                         '#EXTINF:10,0\n' +
                         '2.ts\n' +
                         '#EXT-X-ENDLIST\n'); // media
  standardXHRResponse(requests.shift()); // 1.ts
  standardXHRResponse(requests.shift()); // key.php
  QUnit.ok(player.tech_.hls.pendingSegment_, 'decrypting the segment');

  // seek back to the beginning
  player.currentTime(0);
  clock.tick(1);
  QUnit.ok(!player.tech_.hls.pendingSegment_, 'aborted processing');
});

QUnit.test('calls mediaSource\'s timestampOffset on discontinuity', function() {
  var buffered = [[]];
  player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.play();
  player.tech_.buffered = function() {
    return videojs.createTimeRange(buffered);
  };

  requests.shift().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXTINF:10,0\n' +
                         '1.ts\n' +
                         '#EXT-X-DISCONTINUITY\n' +
                         '#EXTINF:10,0\n' +
                         '2.ts\n' +
                         '#EXT-X-ENDLIST\n');
  player.tech_.hls.sourceBuffer.timestampOffset = 0;
  standardXHRResponse(requests.shift()); // 1.ts
  QUnit.equal(player.tech_.hls.sourceBuffer.timestampOffset,
        0,
        'timestampOffset starts at zero');

  buffered = [[0, 10]];
  player.tech_.hls.sourceBuffer.trigger('updateend');
  standardXHRResponse(requests.shift()); // 2.ts
  QUnit.equal(player.tech_.hls.sourceBuffer.timestampOffset, 10, 'timestampOffset set after discontinuity');
});

QUnit.test('sets timestampOffset when seeking with discontinuities', function() {
  var timeRange = videojs.createTimeRange(0, 10);

  player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.play();
  player.tech_.buffered = function() {
    return timeRange;
  };
  player.tech_.seeking = function (){
    return true;
  };

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXTINF:10,0\n' +
                         '1.ts\n' +
                         '#EXTINF:10,0\n' +
                         '2.ts\n' +
                         '#EXT-X-DISCONTINUITY\n' +
                         '#EXTINF:10,0\n' +
                         '3.ts\n' +
                         '#EXT-X-ENDLIST\n');
  player.tech_.hls.sourceBuffer.timestampOffset = 0;
  player.currentTime(21);
  clock.tick(1);
  QUnit.equal(requests.shift().aborted, true, 'aborted first request');
  standardXHRResponse(requests.pop()); // 3.ts
  clock.tick(1000);
  QUnit.equal(player.tech_.hls.sourceBuffer.timestampOffset, 20, 'timestampOffset starts at zero');
});

QUnit.test('can seek before the source buffer opens', function() {
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech_.triggerReady();
  clock.tick(1);
  standardXHRResponse(requests.shift());
  player.triggerReady();

  player.currentTime(1);
  QUnit.equal(player.currentTime(), 1, 'seeked');
});

QUnit.skip('sets the timestampOffset after seeking to discontinuity', function() {
  var bufferEnd;
  player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.buffered = function() {
    return videojs.createTimeRange(0, bufferEnd);
  };

  requests.pop().respond(200, null,
    '#EXTM3U\n' +
    '#EXTINF:10,0\n' +
    '1.ts\n' +
    '#EXT-X-DISCONTINUITY\n' +
    '#EXTINF:10,0\n' +
    '2.ts\n' +
    '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.pop()); // 1.ts

  // seek to a discontinuity
  player.tech_.setCurrentTime(10);
  bufferEnd = 9.9;
  clock.tick(1);
  standardXHRResponse(requests.pop()); // 1.ts, again
  player.tech_.hls.checkBuffer_();
  standardXHRResponse(requests.pop()); // 2.ts
  QUnit.equal(player.tech_.hls.sourceBuffer.timestampOffset,
        9.9,
        'set the timestamp offset');
});

QUnit.test('tracks segment end times as they are buffered', function() {
  var bufferEnd = 0;
  player.src({
    src: 'media.m3u8',
    type: 'application/x-mpegURL'
  });
  openMediaSource(player);

  // as new segments are downloaded, the buffer end is updated
  player.tech_.buffered = function() {
    return videojs.createTimeRange(0, bufferEnd);
  };
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXTINF:10,\n' +
                           '1.ts\n' +
                           '#EXT-X-ENDLIST\n');

  // 0.ts is shorter than advertised
  standardXHRResponse(requests.shift());
  QUnit.equal(player.tech_.hls.mediaSource.duration, 20, 'original duration is from the m3u8');

  bufferEnd = 9.5;
  player.tech_.hls.sourceBuffer.trigger('update');
  player.tech_.hls.sourceBuffer.trigger('updateend');
  QUnit.equal(player.tech_.hls.mediaSource.duration, 10 + 9.5, 'updated duration');
});

QUnit.skip('seeking does not fail when targeted between segments', function() {
  var currentTime, segmentUrl;
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  // mock out the currentTime callbacks
  player.tech_.el().vjs_setProperty = function(property, value) {
    if (property === 'currentTime') {
      currentTime = value;
    }
  };
  player.tech_.el().vjs_getProperty = function(property) {
    if (property === 'currentTime') {
      return currentTime;
    }
  };

  standardXHRResponse(requests.shift()); // media
  standardXHRResponse(requests.shift()); // segment 0
  player.tech_.hls.checkBuffer_();
  segmentUrl = requests[0].url;
  standardXHRResponse(requests.shift()); // segment 1

  // seek to a time that is greater than the last tag in segment 0 but
  // less than the first in segment 1
  // FIXME: it's not possible to seek here without timestamp-based
  // segment durations
  player.tech_.setCurrentTime(9.4);
  clock.tick(1);
  QUnit.equal(requests[0].url, segmentUrl, 'requested the later segment');

  standardXHRResponse(requests.shift()); // segment 1
  player.tech_.trigger('seeked');
  QUnit.equal(player.currentTime(), 9.5, 'seeked to the later time');
});

QUnit.test('resets the switching algorithm if a request times out', function() {
  player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.bandwidth = 1e20;

  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media.m3u8
  // simulate a segment timeout
  requests[0].timedout = true;
  requests.shift().abort();

  standardXHRResponse(requests.shift());

  QUnit.strictEqual(player.tech_.hls.playlists.media(),
              player.tech_.hls.playlists.master.playlists[1],
              'reset to the lowest bitrate playlist');
});

QUnit.test('disposes the playlist loader', function() {
  var disposes = 0, player, loaderDispose;
  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  loaderDispose = player.tech_.hls.playlists.dispose;
  player.tech_.hls.playlists.dispose = function() {
    disposes++;
    loaderDispose.call(player.tech_.hls.playlists);
  };

  player.dispose();
  QUnit.strictEqual(disposes, 1, 'disposed playlist loader');
});

QUnit.test('remove event handlers on dispose', function() {
  var
    player,
    unscoped = 0;

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
  openMediaSource(player);

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  player.dispose();

  QUnit.ok(unscoped <= 0, 'no unscoped handlers');
});

QUnit.test('aborts the source buffer on disposal', function() {
  var aborts = 0, player;
  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.dispose();
  QUnit.ok(true, 'disposed before creating the source buffer');
  requests.length = 0;

  player = createPlayer();
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift());
  player.tech_.hls.sourceBuffer.abort = function() {
    aborts++;
  };

  player.dispose();
  QUnit.strictEqual(aborts, 1, 'aborted the source buffer');
});

QUnit.test('the source handler supports HLS mime types', function() {
  ['html5', 'flash'].forEach(function(techName) {
    QUnit.ok(this.player.HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/x-MPegUrl'
    }), 'supports x-mpegurl');
    QUnit.ok(this.player.HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/VnD.aPPle.MpEgUrL'
    }), 'supports vnd.apple.mpegurl');
    QUnit.ok(this.player.HlsSourceHandler(techName).canPlayType('aPplicatiOn/VnD.aPPle.MpEgUrL'), 'supports vnd.apple.mpegurl');
    QUnit.ok(this.player.HlsSourceHandler(techName).canPlayType('aPplicatiOn/x-MPegUrl'), 'supports x-mpegurl');

    QUnit.ok(!(this.player.HlsSourceHandler(techName).canHandleSource({
      type: 'video/mp4'
    }) instanceof this.player.HlsHandler), 'does not support mp4');
    QUnit.ok(!(this.player.HlsSourceHandler(techName).canHandleSource({
      type: 'video/x-flv'
    }) instanceof this.player.HlsHandler), 'does not support flv');
    QUnit.ok(!(this.player.HlsSourceHandler(techName).canPlayType('video/mp4')), 'does not support mp4');
    QUnit.ok(!(this.player.HlsSourceHandler(techName).canPlayType('video/x-flv')), 'does not support flv');
  });
});

QUnit.test('fires loadstart manually if Flash is used', function() {
  var
    tech = new (videojs.extend(videojs.EventTarget, {
      buffered: function() {
        return videojs.createTimeRange();
      },
      currentTime: function() {
        return 0;
      },
      el: function() {
        return {};
      },
      preload: function() {
        return 'auto';
      },
      src: function() {},
      setTimeout: window.setTimeout
    }))(),
    loadstarts = 0;
  tech.on('loadstart', function() {
    loadstarts++;
  });
  this.player.HlsSourceHandler('flash').handleSource({
    src: 'movie.m3u8',
    type: 'application/x-mpegURL'
  }, tech);

  QUnit.equal(loadstarts, 0, 'loadstart is not synchronous');
  clock.tick(1);
  QUnit.equal(loadstarts, 1, 'fired loadstart');
});

QUnit.test('has no effect if native HLS is available', function() {
  var player;
  this.player.Hls.supportsNativeHls = true;
  player = createPlayer();
  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  QUnit.ok(!player.tech_.hls, 'did not load hls tech');
  player.dispose();
});

QUnit.test('is not supported on browsers without typed arrays', function() {
  var oldArray = window.Uint8Array;
  window.Uint8Array = null;
  QUnit.ok(!this.player.Hls.isSupported(), 'HLS is not supported');

  // cleanup
  window.Uint8Array = oldArray;
});

QUnit.test('tracks the bytes downloaded', function() {
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  QUnit.strictEqual(player.tech_.hls.bytesReceived, 0, 'no bytes received');

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXTINF:10,\n' +
                           '1.ts\n' +
                           '#EXT-X-ENDLIST\n');
  // transmit some segment bytes
  requests[0].response = new ArrayBuffer(17);
  requests.shift().respond(200, null, '');
  player.tech_.hls.sourceBuffer.trigger('updateend');

  QUnit.strictEqual(player.tech_.hls.bytesReceived, 17, 'tracked bytes received');

  player.tech_.hls.checkBuffer_();

  // transmit some more
  requests[0].response = new ArrayBuffer(5);
  requests.shift().respond(200, null, '');

  QUnit.strictEqual(player.tech_.hls.bytesReceived, 22, 'tracked more bytes');
});

QUnit.test('re-emits mediachange events', function() {
  var mediaChanges = 0;
  player.on('mediachange', function() {
    mediaChanges++;
  });

  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.playlists.trigger('mediachange');
  QUnit.strictEqual(mediaChanges, 1, 'fired mediachange');
});

QUnit.test('can be disposed before finishing initialization', function() {
  var readyHandlers = [];
  player.ready = function(callback) {
    readyHandlers.push(callback);
  };
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.src({
    src: 'http://example.com/media.mp4',
    type: 'video/mp4'
  });
  QUnit.ok(readyHandlers.length > 0, 'registered a ready handler');
  try {
    while (readyHandlers.length) {
      readyHandlers.shift().call(player);
      openMediaSource(player);
    }
    QUnit.ok(true, 'did not throw an exception');
  } catch (e) {
    QUnit.ok(false, 'threw an exception');
  }
});

QUnit.test('calls ended() on the media source at the end of a playlist', function() {
  var endOfStreams = 0, buffered = [[]];
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.buffered = function() {
    return videojs.createTimeRanges(buffered);
  };
  player.tech_.hls.mediaSource.endOfStream = function() {
    endOfStreams++;
  };
  // playlist response
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXT-X-ENDLIST\n');
  // segment response
  requests[0].response = new ArrayBuffer(17);
  requests.shift().respond(200, null, '');
  QUnit.strictEqual(endOfStreams, 0, 'waits for the buffer update to finish');

  buffered =[[0, 10]];
  player.tech_.hls.sourceBuffer.trigger('updateend');
  QUnit.strictEqual(endOfStreams, 1, 'ended media source');
});

QUnit.test('calling play() at the end of a video replays', function() {
  var seekTime = -1;
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.setCurrentTime = function(time) {
    if (time !== undefined) {
      seekTime = time;
    }
    return 0;
  };
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.shift());
  player.tech_.ended = function() {
    return true;
  };

  player.tech_.trigger('play');
  QUnit.equal(seekTime, 0, 'seeked to the beginning');
});

QUnit.test('segments remain pending without a source buffer', function() {
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php?r=52"\n' +
                           '#EXTINF:10,\n' +
                           'http://media.example.com/fileSequence52-A.ts' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php?r=53"\n' +
                           '#EXTINF:10,\n' +
                           'http://media.example.com/fileSequence53-B.ts\n' +
                           '#EXT-X-ENDLIST\n');

  player.tech_.hls.sourceBuffer = undefined;

  standardXHRResponse(requests.shift()); // key
  standardXHRResponse(requests.shift()); // segment
  player.tech_.hls.checkBuffer_();
  QUnit.ok(player.tech_.hls.pendingSegment_, 'waiting for the source buffer');
});

QUnit.test('keys are requested when an encrypted segment is loaded', function() {
  player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.trigger('play');
  standardXHRResponse(requests.shift()); // playlist

  QUnit.strictEqual(requests.length, 2, 'a key XHR is created');
  QUnit.strictEqual(requests[0].url,
              player.tech_.hls.playlists.media().segments[0].key.uri,
              'key XHR is created with correct uri');
  QUnit.strictEqual(requests[1].url,
              player.tech_.hls.playlists.media().segments[0].uri,
              'segment XHR is created with correct uri');
});

QUnit.test('keys are resolved relative to the master playlist', function() {
  player.src({
    src: 'video/master-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=17\n' +
                           'playlist/playlist.m3u8\n' +
                           '#EXT-X-ENDLIST\n');
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-TARGETDURATION:15\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence1.ts\n' +
                           '#EXT-X-ENDLIST\n');
  QUnit.equal(requests.length, 2, 'requested the key');
  QUnit.equal(requests[0].url,
        absoluteUrl('video/playlist/keys/key.php'),
        'resolves multiple relative paths');
});

QUnit.test('keys are resolved relative to their containing playlist', function() {
  player.src({
    src: 'video/media-encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-TARGETDURATION:15\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence1.ts\n' +
                           '#EXT-X-ENDLIST\n');
  QUnit.equal(requests.length, 2, 'requested a key');
  QUnit.equal(requests[0].url,
        absoluteUrl('video/keys/key.php'),
        'resolves multiple relative paths');
});

QUnit.test('a new key XHR is created when a the segment is requested', function() {
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-TARGETDURATION:15\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence1.ts\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key2.php"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence2.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.shift()); // key 1
  standardXHRResponse(requests.shift()); // segment 1
  // "finish" decrypting segment 1
  player.tech_.hls.pendingSegment_.bytes = new Uint8Array(16);
  player.tech_.hls.checkBuffer_();
  player.tech_.buffered = function() {
    return videojs.createTimeRange(0, 2.833);
  };
  player.tech_.hls.sourceBuffer.trigger('updateend');

  QUnit.strictEqual(requests.length, 2, 'a key XHR is created');
  QUnit.strictEqual(requests[0].url,
              'https://example.com/' +
              player.tech_.hls.playlists.media().segments[1].key.uri,
              'a key XHR is created with the correct uri');
});

QUnit.test('seeking should abort an outstanding key request and create a new one', function() {
  player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-TARGETDURATION:15\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.php"\n' +
                           '#EXTINF:9,\n' +
                           'http://media.example.com/fileSequence1.ts\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="keys/key2.php"\n' +
                           '#EXTINF:9,\n' +
                           'http://media.example.com/fileSequence2.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.pop()); // segment 1

  player.currentTime(11);
  clock.tick(1);
  QUnit.ok(requests[0].aborted, 'the key XHR should be aborted');
  requests.shift(); // aborted key 1

  QUnit.equal(requests.length, 2, 'requested the new key');
  QUnit.equal(requests[0].url,
        'https://example.com/' +
        player.tech_.hls.playlists.media().segments[1].key.uri,
        'urls should match');
});

QUnit.test('retries key requests once upon failure', function() {
  player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.trigger('play');

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence52-A.ts\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
                           '#EXTINF:15.0,\n' +
                           'http://media.example.com/fileSequence53-A.ts\n');
  standardXHRResponse(requests.pop()); // segment
  requests[0].respond(404);
  QUnit.equal(requests.length, 2, 'create a new XHR for the same key');
  QUnit.equal(requests[1].url, requests[0].url, 'should be the same key');

  requests[1].respond(404);
  QUnit.equal(requests.length, 2, 'gives up after one retry');
});

QUnit.test('blacklists playlist if key requests fail more than once', function() {
  var bytes = [], media;

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.trigger('play');

  requests.shift().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence53-A.ts\n');
  player.tech_.hls.sourceBuffer.appendBuffer = function(chunk) {
    bytes.push(chunk);
  };

  media = player.tech_.hls.playlists.media_;

  standardXHRResponse(requests.pop()); // segment 1
  requests.shift().respond(404); // fail key
  requests.shift().respond(404); // fail key, again
  player.tech_.hls.checkBuffer_();

  QUnit.ok(media.excludeUntil > 0,
        'playlist blacklisted');
});

QUnit.test('the key is supplied to the decrypter in the correct format', function() {
  var keys = [];

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.trigger('play');

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-MEDIA-SEQUENCE:5\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence52-B.ts\n');

  this.player.Hls.Decrypter = function(encrypted, key) {
    keys.push(key);
  };

  standardXHRResponse(requests.pop()); // segment
  requests[0].response = new Uint32Array([0,1,2,3]).buffer;
  requests[0].respond(200, null, '');
  requests.shift(); // key

  QUnit.equal(keys.length, 1, 'only one Decrypter was constructed');
  QUnit.deepEqual(keys[0],
            new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
            'passed the specified segment key');

});
QUnit.test('supplies the media sequence of current segment as the IV by default, if no IV is specified', function() {
  var ivs = [];

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.trigger('play');

  requests.pop().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-MEDIA-SEQUENCE:5\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence52-B.ts\n');


  this.player.Hls.Decrypter = function(encrypted, key, iv) {
    ivs.push(iv);
  };

  requests[0].response = new Uint32Array([0,0,0,0]).buffer;
  requests[0].respond(200, null, '');
  requests.shift();
  standardXHRResponse(requests.pop());

  QUnit.equal(ivs.length, 1, 'only one Decrypter was constructed');
  QUnit.deepEqual(ivs[0],
        new Uint32Array([0, 0, 0, 5]),
        'the IV for the segment is the media sequence');
});

QUnit.test('switching playlists with an outstanding key request does not stall playback', function() {
  var buffered = [];
  var media = '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:5\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
    '#EXTINF:2.833,\n' +
    'http://media.example.com/fileSequence52-A.ts\n' +
    '#EXTINF:15.0,\n' +
    'http://media.example.com/fileSequence52-B.ts\n';
  player.src({
    src: 'https://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.trigger('play');

  player.tech_.hls.bandwidth = 1;
  player.tech_.buffered = function() {
    return videojs.createTimeRange(buffered);
  };
  // master playlist
  standardXHRResponse(requests.shift());
  // media playlist
  requests.shift().respond(200, null, media);
  // mock out media switching from this point on
  player.tech_.hls.playlists.media = function() {
    return player.tech_.hls.playlists.master.playlists[1];
  };
  // first segment of the original media playlist
  standardXHRResponse(requests.pop());

  // "switch" media
  player.tech_.hls.playlists.trigger('mediachange');
  QUnit.ok(!requests[0].aborted, 'did not abort the key request');

  // "finish" decrypting segment 1
  standardXHRResponse(requests.shift()); // key
  player.tech_.hls.pendingSegment_.bytes = new Uint8Array(16);
  player.tech_.hls.checkBuffer_();
  buffered = [[0, 2.833]];
  player.tech_.hls.sourceBuffer.trigger('updateend');
  player.tech_.hls.checkBuffer_();

  QUnit.equal(requests.length, 1, 'made a request');
  QUnit.equal(requests[0].url,
        'http://media.example.com/fileSequence52-B.ts',
        'requested the segment');
});

QUnit.test('resolves relative key URLs against the playlist', function() {
  player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:5\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="key.php?r=52"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence52-A.ts\n' +
                           '#EXT-X-ENDLIST\n');
  QUnit.equal(requests[0].url, 'https://example.com/key.php?r=52', 'resolves the key URL');
});

QUnit.test('treats invalid keys as a key request failure and blacklists playlist', function() {
  var bytes = [], media;

  player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.trigger('play');
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:5\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence52-A.ts\n' +
                           '#EXT-X-KEY:METHOD=NONE\n' +
                           '#EXTINF:15.0,\n' +
                           'http://media.example.com/fileSequence52-B.ts\n');
  player.tech_.hls.sourceBuffer.appendBuffer = function(chunk) {
    bytes.push(chunk);
  };

  media = player.tech_.hls.playlists.media_;
  // segment request
  standardXHRResponse(requests.pop());
  // keys should be 16 bytes long
  requests[0].response = new Uint8Array(1).buffer;
  requests.shift().respond(200, null, '');

  QUnit.equal(requests[0].url, 'https://priv.example.com/key.php?r=52', 'retries the key');

  // the retried response is invalid, too
  requests[0].response = new Uint8Array(1);
  requests.shift().respond(200, null, '');
  player.tech_.hls.checkBuffer_();

  // two failed attempts is an error - blacklist this playlist
  QUnit.ok(media.excludeUntil > 0,
        'blacklisted playlist');
});

QUnit.test('live stream should not call endOfStream', function(){
  player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.trigger('play');
  requests[0].respond(200, null,
                      '#EXTM3U\n' +
                      '#EXT-X-MEDIA-SEQUENCE:0\n' +
                      '#EXTINF:1\n' +
                      '0.ts\n'
                     );
  requests[1].response = window.bcSegment;
  requests[1].respond(200, null, "");
  QUnit.equal("open", player.tech_.hls.mediaSource.readyState,
        "media source should be in open state, not ended state for live stream after the last segment in m3u8 downloaded");
});

QUnit.test('does not download segments if preload option set to none', function() {
  player.preload('none');
  player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(player);
  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media
  player.tech_.hls.checkBuffer_();

  requests = requests.filter(function(request) {
    return !/m3u8$/.test(request.uri);
  });
  QUnit.equal(requests.length, 0, 'did not download any segments');
});

QUnit.module('Buffer Inspection');

QUnit.test('detects time range end-point changed by updates', function() {
  var edge;

  // Single-range changes
  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10]]),
                                                    videojs.createTimeRange([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'detected a forward addition');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[5, 10]]),
                                                    videojs.createTimeRange([[0, 10]]));
  QUnit.strictEqual(edge, null, 'ignores backward addition');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[5, 10]]),
                                                    videojs.createTimeRange([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'detected a forward addition & ignores a backward addition');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10]]),
                                                    videojs.createTimeRange([[0, 9]]));
  QUnit.strictEqual(edge, null, 'ignores a backwards addition resulting from a shrinking range');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10]]),
                                                    videojs.createTimeRange([[2, 7]]));
  QUnit.strictEqual(edge, null, 'ignores a forward & backwards addition resulting from a shrinking range');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[2, 10]]),
                                                    videojs.createTimeRange([[0, 7]]));
  QUnit.strictEqual(edge, null, 'ignores a forward & backwards addition resulting from a range shifted backward');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[2, 10]]),
                                                    videojs.createTimeRange([[5, 15]]));
  QUnit.strictEqual(edge, 15, 'detected a forwards addition resulting from a range shifted foward');

  // Multiple-range changes
  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10]]),
                                                    videojs.createTimeRange([[0, 11], [12, 15]]));
  QUnit.strictEqual(edge, null, 'ignores multiple new forward additions');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10], [20, 40]]),
                                                    videojs.createTimeRange([[20, 50]]));
  QUnit.strictEqual(edge, 50, 'detected a forward addition & ignores range removal');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10], [20, 40]]),
                                                    videojs.createTimeRange([[0, 50]]));
  QUnit.strictEqual(edge, 50, 'detected a forward addition & ignores merges');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 10], [20, 40]]),
                                                    videojs.createTimeRange([[0, 40]]));
  QUnit.strictEqual(edge, null, 'ignores merges');

  // Empty input
  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange(),
                                                    videojs.createTimeRange([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'handle an empty original TimeRanges object');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 11]]),
                                                    videojs.createTimeRange());
  QUnit.strictEqual(edge, null, 'handle an empty update TimeRanges object');

  // Null input
  edge = Hls.findSoleUncommonTimeRangesEnd_(null,
                                                    videojs.createTimeRange([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'treat null original buffer as an empty TimeRanges object');

  edge = Hls.findSoleUncommonTimeRangesEnd_(videojs.createTimeRange([[0, 11]]),
                                                    null);
  QUnit.strictEqual(edge, null, 'treat null update buffer as an empty TimeRanges object');
});

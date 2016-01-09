(function(window, videojs, undefined) {
  'use strict';
  /*
    ======== A Handy Little QUnit Reference ========
    http://api.qunitjs.com/

    Test methods:
    module(name, {[setup][ ,teardown]})
    test(name, callback)
    expect(numberOfAssertions)
    stop(increment)
    start(decrement)
    Test assertions:
    ok(value, [message])
    equal(actual, expected, [message])
    notEqual(actual, expected, [message])
    deepEqual(actual, expected, [message])
    notDeepEqual(actual, expected, [message])
    strictEqual(actual, expected, [message])
    notStrictEqual(actual, expected, [message])
    throws(block, [expected], [message])
  */

var
  Flash = videojs.getComponent('Flash'),
  oldFlash,
  player,
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

module('HLS', {
  beforeEach: function() {
    oldMediaSource = videojs.MediaSource;
    videojs.MediaSource = MockMediaSource;
    oldCreateUrl = videojs.URL.createObjectURL;
    videojs.URL.createObjectURL = function() {
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

    oldSourceBuffer = window.videojs.SourceBuffer;
    window.videojs.SourceBuffer = function() {
      this.appendBuffer = function() {};
      this.abort = function() {};
    };

    // store functionality that some tests need to mock
    oldSegmentParser = videojs.Hls.SegmentParser;
    oldGlobalOptions = videojs.mergeOptions(videojs.options);

    // force the HLS tech to run
    oldNativeHlsSupport = videojs.Hls.supportsNativeHls;
    videojs.Hls.supportsNativeHls = false;

    oldDecrypt = videojs.Hls.Decrypter;
    videojs.Hls.Decrypter = function() {};

    // fake XHRs
    xhr = sinon.useFakeXMLHttpRequest();
    videojs.xhr.XMLHttpRequest = xhr;
    requests = [];
    xhr.onCreate = function(xhr) {
      requests.push(xhr);
    };

    // fake timers
    clock = sinon.useFakeTimers();

    // create the test player
    player = createPlayer();
  },

  afterEach: function() {
    videojs.MediaSource = oldMediaSource;
    videojs.URL.createObjectURL = oldCreateUrl;

    merge(videojs.options, oldGlobalOptions);
    Flash.isSupported = oldFlashSupported;
    merge(Flash, oldFlash);

    videojs.Hls.SegmentParser = oldSegmentParser;
    videojs.Hls.supportsNativeHls = oldNativeHlsSupport;
    videojs.Hls.Decrypter = oldDecrypt;
    videojs.SourceBuffer = oldSourceBuffer;

    player.dispose();
    xhr.restore();
    videojs.xhr.XMLHttpRequest = window.XMLHttpRequest;
    clock.restore();
  }
});

test('starts playing if autoplay is specified', function() {
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
  strictEqual(1, plays, 'play was called');
});

test('autoplay seeks to the live point after playlist load', function() {
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

test('autoplay seeks to the live point after media source open', function() {
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

test('duration is set when the source opens after the playlist is loaded', function() {
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech_.triggerReady();
  clock.tick(1);
  standardXHRResponse(requests.shift());
  openMediaSource(player);

  equal(player.tech_.hls.mediaSource.duration , 40, 'set the duration');
});

test('codecs are passed to the source buffer', function() {
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
  equal(codecs.length, 1, 'created a source buffer');
  equal(codecs[0], 'video/mp2t; codecs="video, audio"', 'specified the codecs');
});

test('including HLS as a tech does not error', function() {
  var player = createPlayer({
    techOrder: ['hls', 'html5']
  });

  ok(player, 'created the player');
});

test('creates a PlaylistLoader on init', function() {
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

  equal(requests[0].aborted, true, 'aborted previous src');
  standardXHRResponse(requests[1]);
  ok(player.tech_.hls.playlists.master, 'set the master playlist');
  ok(player.tech_.hls.playlists.media(), 'set the media playlist');
  ok(player.tech_.hls.playlists.media().segments, 'the segment entries are parsed');
  strictEqual(player.tech_.hls.playlists.master.playlists[0],
              player.tech_.hls.playlists.media(),
              'the playlist is selected');
});

test('creates a SegmentLoader on init', function() {
  player.src({
    src: 'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  equal(player.tech_.hls.segments.state, 'INIT', 'created a segment loader');
});

test('re-initializes the playlist loader when switching sources', function() {
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
  ok(!player.tech_.hls.playlists.media(), 'no media playlist');
  equal(player.tech_.hls.playlists.state,
        'HAVE_NOTHING',
        'reset the playlist loader state');
  equal(requests.length, 1, 'requested the new src');

  // buffer check
  player.tech_.hls.checkBuffer_();
  equal(requests.length, 1, 'did not request a stale segment');

  // sourceopen
  openMediaSource(player);

  equal(requests.length, 1, 'made one request');
  ok(requests[0].url.indexOf('master.m3u8') >= 0, 'requested only the new playlist');
});

test('updates the segment loader on media changes', function() {
  var updates = [], hls;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  hls = player.tech_.hls;

  hls.bandwidth = 1;
  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media
  hls.segments.playlist = function(update) {
    updates.push(update);
  };

  // downloading the new segment will update bandwidth and cause a
  // playlist change
  standardXHRResponse(requests.shift()); // segment 0
  standardXHRResponse(requests.shift()); // media
  equal(updates.length, 1, 'updated the segment list');
});

test('updates the segment loader on live playlist refreshes', function() {
  var updates = [], hls;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  hls = player.tech_.hls;

  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media
  hls.segments.playlist = function(update) {
    updates.push(update);
  };

  hls.playlists.trigger('loadedplaylist');
  equal(updates.length, 1, 'updated the segment list');
});

test('sets the duration if one is available on the playlist', function() {
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
  equal(player.tech_.hls.mediaSource.duration, 40, 'set the duration');
  equal(events, 1, 'durationchange is fired');
});

test('estimates individual segment durations if needed', function() {
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
  strictEqual(player.tech_.hls.mediaSource.duration,
              player.tech_.hls.playlists.media().segments.length * 10,
              'duration is updated');
  strictEqual(changes, 1, 'one durationchange fired');
});

test('translates seekable by the starting time for live playlists', function() {
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
  equal(seekable.length, 1, 'one seekable range');
  equal(seekable.start(0), 0, 'the earliest possible position is at zero');
  equal(seekable.end(0), 10, 'end is relative to the start');
});

test('starts downloading a segment on loadedmetadata', function() {
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
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media-00001.ts'),
              'the first segment is requested');
});

test('re-initializes the handler for each source', function() {
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

  equal(1, aborts, 'aborted the old source buffer');
  ok(requests[0].aborted, 'aborted the old segment request');
  notStrictEqual(firstPlaylists, secondPlaylists, 'the playlist object is not reused');
  notStrictEqual(firstMSE, secondMSE, 'the media source object is not reused');
});

test('triggers an error when a master playlist request errors', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.pop().respond(500);

  equal(player.tech_.hls.mediaSource.error_, 'network', 'a network error is triggered');
});

test('downloads media playlists after loading the master', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 20e10;
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media3.m3u8'),
              'media playlist requested');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media3-00001.ts'),
              'first segment requested');
});

test('upshifts if the initial bandwidth hint is high', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 10e20;
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media3.m3u8'),
              'media playlist requested');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media3-00001.ts'),
              'first segment requested');
});

test('downshifts if the initial bandwidth hint is low', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech_.hls.bandwidth = 100;
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media1.m3u8'),
              'media playlist requested');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media1-00001.ts'),
              'first segment requested');
});

QUnit.skip('buffer checks are noops until a media playlist is ready', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech_.hls.checkBuffer_();

  strictEqual(1, requests.length, 'one request was made');
  strictEqual(requests[0].url, 'manifest/media.m3u8', 'media playlist requested');
});

QUnit.skip('buffer checks are noops when only the master is ready', function() {
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

  strictEqual(1, requests.length, 'one request was made');
  strictEqual(requests[0].url,
              absoluteUrl('manifest/media1.m3u8'),
              'media playlist requested');
});

QUnit.skip('fires a progress event after downloading a segment', function() {
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

  equal(progressCount, 1, 'fired a progress event');
});

test('selects a playlist after segment downloads', function() {
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

  strictEqual(calls, 2, 'selects after the initial segment');
  player.currentTime = function() {
    return 1;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 2);
  };
  player.tech_.hls.sourceBuffer.trigger('updateend');
  player.tech_.hls.checkBuffer_();

  standardXHRResponse(requests[3]);

  strictEqual(calls, 3, 'selects after additional segments');
});

test('updates the duration after switching playlists', function() {
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
  ok(selectedPlaylist, 'selected playlist');
  ok(player.tech_.hls.mediaSource.duration !== -Infinity, 'updates the duration');
});

test('downloads additional playlists if required', function() {
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

  strictEqual(4, requests.length, 'requests were made');
  strictEqual(requests[3].url,
              absoluteUrl('manifest/' + playlist.uri),
              'made playlist request');
  strictEqual(playlist.uri,
              player.tech_.hls.playlists.media().uri,
              'a new playlists was selected');
  ok(player.tech_.hls.playlists.media().segments, 'segments are now available');
});

test('selects a playlist below the current bandwidth', function() {
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
  strictEqual(playlist,
              player.tech_.hls.playlists.master.playlists[1],
              'the low bitrate stream is selected');
});

test('allows initial bandwidth to be provided', function() {
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
  equal(player.tech_.hls.bandwidth, 500, 'prefers user-specified intial bandwidth');
});

test('raises the minimum bitrate for a stream proportionially', function() {
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

  strictEqual(playlist,
              player.tech_.hls.playlists.master.playlists[1],
              'a lower bitrate stream is selected');
});

test('uses the lowest bitrate if no other is suitable', function() {
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
  strictEqual(playlist,
              player.tech_.hls.playlists.master.playlists[1],
              'the lowest bitrate stream is selected');
});

test('selects the correct rendition by player dimensions', function() {
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

  deepEqual(playlist.attributes.RESOLUTION, {width:960,height:540},'should return the correct resolution by player dimensions');
  equal(playlist.attributes.BANDWIDTH, 1928000, 'should have the expected bandwidth in case of multiple');

  player.width(1920);
  player.height(1080);
  player.tech_.hls.bandwidth = 3000000;

  playlist = player.tech_.hls.selectPlaylist();

  deepEqual(playlist.attributes.RESOLUTION, {
    width:960,
    height:540
  },'should return the correct resolution by player dimensions');
  equal(playlist.attributes.BANDWIDTH, 1928000, 'should have the expected bandwidth in case of multiple');

  player.width(396);
  player.height(224);
  playlist = player.tech_.hls.selectPlaylist();

  deepEqual(playlist.attributes.RESOLUTION, {
    width:396,
    height:224
  },'should return the correct resolution by player dimensions, if exact match');
  equal(playlist.attributes.BANDWIDTH, 440000, 'should have the expected bandwidth in case of multiple, if exact match');

});

test('selects the highest bitrate playlist when the player dimensions are ' +
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

  equal(playlist.attributes.BANDWIDTH,
        1000,
        'selected the highest bandwidth variant');
});

test('filters playlists that are currently excluded', function() {
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
  equal(playlist, player.tech_.hls.playlists.master.playlists[1], 'respected exclusions');

  // timeout the exclusion
  clock.tick(1000);
  playlist = player.tech_.hls.selectPlaylist();
  equal(playlist, player.tech_.hls.playlists.master.playlists[0], 'expired the exclusion');
});

test('blacklists switching from video+audio playlists to audio only', function() {
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
  equal(player.tech_.hls.playlists.media(),
        player.tech_.hls.playlists.master.playlists[1],
        'selected video+audio');
  audioPlaylist = player.tech_.hls.playlists.master.playlists[0];
  equal(audioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

test('blacklists switching from audio-only playlists to video+audio', function() {
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
  equal(player.tech_.hls.playlists.media(),
        player.tech_.hls.playlists.master.playlists[0],
        'selected audio only');
  videoAudioPlaylist = player.tech_.hls.playlists.master.playlists[1];
  equal(videoAudioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

test('blacklists switching from video-only playlists to video+audio', function() {
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
  equal(player.tech_.hls.playlists.media(),
        player.tech_.hls.playlists.master.playlists[0],
        'selected video only');
  videoAudioPlaylist = player.tech_.hls.playlists.master.playlists[1];
  equal(videoAudioPlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

test('does not blacklist compatible H.264 codec strings', function() {
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
  strictEqual(master.playlists[0].excludeUntil, undefined, 'did not blacklist');
  strictEqual(master.playlists[1].excludeUntil, undefined, 'did not blacklist');
});

test('does not blacklist compatible AAC codec strings', function() {
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
  strictEqual(master.playlists[0].excludeUntil, undefined, 'did not blacklist');
  strictEqual(master.playlists[1].excludeUntil, undefined, 'did not blacklist');
});

test('blacklists switching between playlists with incompatible audio codecs', function() {
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
  equal(player.tech_.hls.playlists.media(),
        player.tech_.hls.playlists.master.playlists[0],
        'selected HE-AAC stream');
  alternatePlaylist = player.tech_.hls.playlists.master.playlists[1];
  equal(alternatePlaylist.excludeUntil, Infinity, 'excluded incompatible playlist');
});

test('waits to download new segments until the media playlist is stable', function() {
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

  equal(requests.length, 1, 'only the playlist request outstanding');
  player.tech_.hls.checkBuffer_();
  equal(requests.length, 1, 'delays segment fetching');

  standardXHRResponse(requests.shift()); // media3
  player.tech_.hls.checkBuffer_();
  equal(requests.length, 1, 'resumes segment fetching');
});

test('cancels outstanding XHRs when seeking', function() {
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

  ok(requests[1].aborted, 'XHR aborted');
  strictEqual(requests.length, 3, 'opened new XHR');
});

test('when outstanding XHRs are cancelled, they get aborted properly', function() {
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

  ok(requests[1].aborted, 'XHR aborted');
  strictEqual(requests.length, 3, 'opened new XHR');
  notEqual(player.tech_.hls.segmentXhr_.url, requests[1].url, 'a new segment is request that is not the aborted one');
  strictEqual(readystatechanges, 0, 'onreadystatechange was not called');
});

test('segmentXhr is properly nulled out when dispose is called', function() {
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

  ok(requests[1].aborted, 'XHR aborted');
  strictEqual(requests.length, 2, 'did not open a new XHR');
  strictEqual(readystatechanges, 0, 'onreadystatechange was not called');

  Flash.prototype.dispose = oldDispose;
});

test('does not abort segment loading for in-buffer seeking', function() {
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
  equal(requests.length, 1, 'did not abort the outstanding request');
});

test('playlist 404 should end stream with a network error', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.pop().respond(404);

  equal(player.tech_.hls.mediaSource.error_, 'network', 'set a network error');
});

test('segment 404 should trigger blacklisting of media', function () {
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
  ok(media.excludeUntil > 0, 'original media blacklisted for some time');
});

test('playlist 404 should blacklist media', function () {
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

  equal(player.tech_.hls.playlists.media_, undefined, 'no media is initially set');

  requests[1].respond(400); // media

  url = requests[1].url.slice(requests[1].url.lastIndexOf('/') + 1);
  media = player.tech_.hls.playlists.master.playlists[url];

  ok(media.excludeUntil > 0, 'original media blacklisted for some time');
});

test('seeking in an empty playlist is a non-erroring noop', function() {
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

  equal(requests.length, requestsLength, 'made no additional requests');
});

test('sets seekable and duration for live playlists', function() {
  player.src({
    src: 'http://example.com/manifest/missingEndlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  equal(player.tech_.hls.mediaSource.seekable.length,
        1,
        'set one seekable range');
  equal(player.tech_.hls.mediaSource.seekable.start(0),
        player.tech_.hls.seekable().start(0),
        'set seekable start');
  equal(player.tech_.hls.mediaSource.seekable.end(0),
        player.tech_.hls.seekable().end(0),
        'set seekable end');

  strictEqual(player.tech_.hls.mediaSource.duration,
              Infinity,
              'duration on the mediaSource is infinity');
});

test('live playlist starts three target durations before live', function() {
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

  equal(requests.length, 0, 'no outstanding segment request');

  player.tech_.paused = function() { return false; };
  player.tech_.readyState = function(){return 1;};
  player.tech_.trigger('play');
  clock.tick(1);
  mediaPlaylist = player.tech_.hls.playlists.media();
  equal(player.currentTime(), player.tech_.hls.seekable().end(0), 'seeked to the seekable end');

  equal(requests.length, 1, 'begins buffering');
});

test('live playlist starts with correct currentTime value', function() {
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

  strictEqual(player.currentTime(),
              videojs.Hls.Playlist.seekable(player.tech_.hls.playlists.media()).end(0),
              'currentTime is updated at playback');
});

test('adjusts the seekable start based on the amount of expired live content', function() {
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

  equal(player.seekable().start(0),
        29.5 - 29,
        'offset the seekable start');
});

test('estimates seekable ranges for live streams that have been paused for a long time', function() {
  player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests.shift());
  player.tech_.hls.playlists.expired_ = 172;

  equal(player.seekable().start(0),
        player.tech_.hls.playlists.expired_,
        'offset the seekable start');
});

test('resets the time to a seekable position when resuming a live stream ' +
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
  equal(seekTarget, player.seekable().start(0), 'seeked to the start of seekable');
  player.tech_.trigger('seeked');
});

test('reloads out-of-date live playlists when switching variants', function() {
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

  strictEqual(player.mediaIndex, 1, 'mediaIndex points at the next segment');
});

test('if withCredentials global option is used, withCredentials is set on the XHR object', function() {
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
  ok(requests[0].withCredentials,
     'with credentials should be set to true if that option is passed in');
  videojs.options.hls = hlsOptions;
});

test('if withCredentials src option is used, withCredentials is set on the XHR object', function() {
  player.dispose();
  player = createPlayer();
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: true
  });
  openMediaSource(player);
  ok(requests[0].withCredentials,
     'with credentials should be set to true if that option is passed in');
});

test('src level credentials supersede the global options', function() {
  player.dispose();
  player = createPlayer();
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl',
    withCredentials: true
  });
  openMediaSource(player);
  ok(requests[0].withCredentials,
     'with credentials should be set to true if that option is passed in');

});

test('does not break if the playlist has no segments', function() {
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
    ok(false, 'an error was thrown');
    throw e;
  }
  ok(true, 'no error was thrown');
  strictEqual(requests.length, 1, 'no requests for non-existent segments were queued');
});

test('aborts segment processing on seek', function() {
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
  ok(player.tech_.hls.pendingSegment_, 'decrypting the segment');

  // seek back to the beginning
  player.currentTime(0);
  clock.tick(1);
  ok(!player.tech_.hls.pendingSegment_, 'aborted processing');
});

test('can seek before the source buffer opens', function() {
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech_.triggerReady();
  clock.tick(1);
  standardXHRResponse(requests.shift());
  player.triggerReady();

  player.currentTime(1);
  equal(player.currentTime(), 1, 'seeked');
});

test('resets the switching algorithm if a request times out', function() {
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

  strictEqual(player.tech_.hls.playlists.media(),
              player.tech_.hls.playlists.master.playlists[1],
              'reset to the lowest bitrate playlist');
});

test('disposes the playlist loader', function() {
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
  strictEqual(disposes, 1, 'disposed playlist loader');
});

test('remove event handlers on dispose', function() {
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

  ok(unscoped <= 0, 'no unscoped handlers');
});

test('the source handler supports HLS mime types', function() {
  ['html5', 'flash'].forEach(function(techName) {
    ok(videojs.HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/x-MPegUrl'
    }), 'supports x-mpegurl');
    ok(videojs.HlsSourceHandler(techName).canHandleSource({
      type: 'aPplicatiOn/VnD.aPPle.MpEgUrL'
    }), 'supports vnd.apple.mpegurl');
    ok(videojs.HlsSourceHandler(techName).canPlayType('aPplicatiOn/VnD.aPPle.MpEgUrL'), 'supports vnd.apple.mpegurl');
    ok(videojs.HlsSourceHandler(techName).canPlayType('aPplicatiOn/x-MPegUrl'), 'supports x-mpegurl');

    ok(!(videojs.HlsSourceHandler(techName).canHandleSource({
      type: 'video/mp4'
    }) instanceof videojs.HlsHandler), 'does not support mp4');
    ok(!(videojs.HlsSourceHandler(techName).canHandleSource({
      type: 'video/x-flv'
    }) instanceof videojs.HlsHandler), 'does not support flv');
    ok(!(videojs.HlsSourceHandler(techName).canPlayType('video/mp4')), 'does not support mp4');
    ok(!(videojs.HlsSourceHandler(techName).canPlayType('video/x-flv')), 'does not support flv');
  });
});

test('fires loadstart manually if Flash is used', function() {
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
  videojs.HlsSourceHandler('flash').handleSource({
    src: 'movie.m3u8',
    type: 'application/x-mpegURL'
  }, tech);

  equal(loadstarts, 0, 'loadstart is not synchronous');
  clock.tick(1);
  equal(loadstarts, 1, 'fired loadstart');
});

test('has no effect if native HLS is available', function() {
  var player;
  videojs.Hls.supportsNativeHls = true;
  player = createPlayer();
  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  ok(!player.tech_.hls, 'did not load hls tech');
  player.dispose();
});

test('is not supported on browsers without typed arrays', function() {
  var oldArray = window.Uint8Array;
  window.Uint8Array = null;
  ok(!videojs.Hls.isSupported(), 'HLS is not supported');

  // cleanup
  window.Uint8Array = oldArray;
});

test('re-emits mediachange events', function() {
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
  strictEqual(mediaChanges, 1, 'fired mediachange');
});

test('can be disposed before finishing initialization', function() {
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
  ok(readyHandlers.length > 0, 'registered a ready handler');
  try {
    while (readyHandlers.length) {
      readyHandlers.shift().call(player);
      openMediaSource(player);
    }
    ok(true, 'did not throw an exception');
  } catch (e) {
    ok(false, 'threw an exception');
  }
});

test('calls ended() on the media source at the end of a playlist', function() {
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
  strictEqual(endOfStreams, 0, 'waits for the buffer update to finish');

  buffered =[[0, 10]];
  player.tech_.hls.sourceBuffer.trigger('updateend');
  strictEqual(endOfStreams, 1, 'ended media source');
});

test('calling play() at the end of a video replays', function() {
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
  equal(seekTime, 0, 'seeked to the beginning');
});

test('blacklists playlist if key requests fail more than once', function() {
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

  ok(media.excludeUntil > 0,
        'playlist blacklisted');
});

test('treats invalid keys as a key request failure and blacklists playlist', function() {
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

  equal(requests[0].url, 'https://priv.example.com/key.php?r=52', 'retries the key');

  // the retried response is invalid, too
  requests[0].response = new Uint8Array(1);
  requests.shift().respond(200, null, '');
  player.tech_.hls.checkBuffer_();

  // two failed attempts is an error - blacklist this playlist
  ok(media.excludeUntil > 0,
        'blacklisted playlist');
});

test('live stream should not call endOfStream', function(){
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
  equal("open", player.tech_.hls.mediaSource.readyState,
        "media source should be in open state, not ended state for live stream after the last segment in m3u8 downloaded");
});

test('does not download segments if preload option set to none', function() {
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
  equal(requests.length, 0, 'did not download any segments');
});

})(window, window.videojs);

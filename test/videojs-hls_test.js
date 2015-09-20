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


var Flash = videojs.getComponent('Flash'),
    absoluteUrl = window.absoluteUrl;

var
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
    tech.paused_ = !tech.autoplay();
    tech.paused = function() {
      return tech.paused_;
    };

    tech.currentTime_ = tech.currentTime;
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

    return player;
  },
  openMediaSource = function(player) {
    // ensure the Flash tech is ready
    player.tech.triggerReady();
    clock.tick(1);
    mockTech(player.tech);

    // simulate the sourceopen event
    player.tech.hls.mediaSource.readyState = 'open';
    player.tech.hls.mediaSource.dispatchEvent({
      type: 'sourceopen',
      swfId: player.tech.el().id
    });

    // endOfStream triggers an exception if flash isn't available
    player.tech.hls.mediaSource.endOfStream = function(error) {
      this.error_ = error;
    };
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

  mockSegmentParser = function(tags) {
    var MockSegmentParser;

    if (tags === undefined) {
      tags = [{ pts: 0, bytes: new Uint8Array(1) }];
    }
    MockSegmentParser = function() {
      this.getFlvHeader = function() {
        return 'flv';
      };
      this.parseSegmentBinaryData = function() {};
      this.flushTags = function() {};
      this.tagsAvailable = function() {
        return tags.length;
      };
      this.getTags = function() {
        return tags;
      };
      this.getNextTag = function() {
        return tags.shift();
      };
      this.metadataStream = new videojs.Hls.Stream();
      this.metadataStream.init();
      this.metadataStream.descriptor = new Uint8Array([
        1, 2, 3, 0xbb
      ]);

      this.stats = {
        h264Tags: function() {
          return tags.length;
        },
        minVideoPts: function() {
          return tags[0].pts;
        },
        maxVideoPts: function() {
          return tags[tags.length - 1].pts;
        },
        aacTags: function() {
          return tags.length;
        },
        minAudioPts: function() {
          return tags[0].pts;
        },
        maxAudioPts: function() {
          return tags[tags.length - 1].pts;
        },
      };
    };

    MockSegmentParser.STREAM_TYPES = videojs.Hls.SegmentParser.STREAM_TYPES;

    return MockSegmentParser;
  },

  // a no-op MediaSource implementation to allow synchronous testing
  MockMediaSource = videojs.extends(videojs.EventTarget, {
    constructor: function() {},
    addSourceBuffer: function() {
      return new (videojs.extends(videojs.EventTarget, {
        constructor: function() {},
        abort: function() {},
        buffered: videojs.createTimeRange(),
        appendBuffer: function() {}
      }))();
    },
  }),

  // do a shallow copy of the properties of source onto the target object
  merge = function(target, source) {
    var name;
    for (name in source) {
      target[name] = source[name];
    }
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
    oldFlash = {};
    merge(oldFlash, Flash);
    Flash.embed = function(swf, flashVars) {
      var el = document.createElement('div');
      el.id = 'vjs_mock_flash_' + nextId++;
      el.className = 'vjs-tech vjs-mock-flash';
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
  player.tech.triggerReady();
  clock.tick(1);
  // make sure play() is called *after* the media source opens
  player.tech.hls.play = function() {
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
  player.tech.triggerReady();
  clock.tick(1);
  standardXHRResponse(requests.shift());
  openMediaSource(player);
  clock.tick(1);

  notEqual(currentTime, 0, 'seeked on autoplay');
});

test('duration is set when the source opens after the playlist is loaded', function() {
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech.triggerReady();
  clock.tick(1);
  standardXHRResponse(requests.shift());
  openMediaSource(player);

  equal(player.tech.hls.mediaSource.duration , 40, 'set the duration');
});

test('codecs are passed to the source buffer', function() {
  var codecs = [];
  player.src({
    src: 'custom-codecs.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.hls.mediaSource.addSourceBuffer = function(codec) {
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

  player.src({
    src:'manifest/playlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  equal(requests[0].aborted, true, 'aborted previous src');
  standardXHRResponse(requests[1]);
  ok(player.tech.hls.playlists.master, 'set the master playlist');
  ok(player.tech.hls.playlists.media(), 'set the media playlist');
  ok(player.tech.hls.playlists.media().segments, 'the segment entries are parsed');
  strictEqual(player.tech.hls.playlists.master.playlists[0],
              player.tech.hls.playlists.media(),
              'the playlist is selected');
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
  ok(!player.tech.hls.playlists.media(), 'no media playlist');
  equal(player.tech.hls.playlists.state,
        'HAVE_NOTHING',
        'reset the playlist loader state');
  equal(requests[0].aborted, true, 'aborted the segment download');
  requests.shift();
  equal(requests.length, 1, 'requested the new src');

  // buffer check
  player.tech.hls.checkBuffer_();
  equal(requests.length, 1, 'did not request a stale segment');

  // sourceopen
  openMediaSource(player);

  equal(requests.length, 1, 'made one request');
  ok(requests[0].url.indexOf('master.m3u8') >= 0, 'requested only the new playlist');
});

test('sets the duration if one is available on the playlist', function() {
  var events = 0;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.on('durationchange', function() {
    events++;
  });

  standardXHRResponse(requests[0]);
  equal(player.tech.hls.mediaSource.duration, 40, 'set the duration');
  equal(events, 1, 'durationchange is fired');
});

QUnit.skip('calculates the duration if needed', function() {
  var changes = 0;
  player.src({
    src: 'http://example.com/manifest/missingExtinf.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.hls.mediaSource.duration = NaN;
  player.on('durationchange', function() {
    changes++;
  });

  standardXHRResponse(requests[0]);
  strictEqual(player.tech.hls.mediaSource.duration,
              player.tech.hls.playlists.media().segments.length * 10,
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
  firstPlaylists = player.tech.hls.playlists;
  firstMSE = player.tech.hls.mediaSource;
  standardXHRResponse(requests.shift());
  standardXHRResponse(requests.shift());
  player.tech.hls.sourceBuffer.abort = function() {
    aborts++;
  };

  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  secondPlaylists = player.tech.hls.playlists;
  secondMSE = player.tech.hls.mediaSource;

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

  equal(player.tech.hls.mediaSource.error_, 'network', 'a network error is triggered');
});

test('downloads media playlists after loading the master', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  // set bandwidth to an appropriate number so we don't switch
  player.tech.hls.segments.bandwidth = 200000;
  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media.m3u8'),
              'media playlist requested');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media-00001.ts'),
              'first segment requested');
});

test('upshift if initial bandwidth is high', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.tech.hls.playlists.setBandwidth = function() {
    player.tech.hls.segments.bandwidth = 1000000000;
  };

  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  standardXHRResponse(requests[3]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media.m3u8'),
              'media playlist requested');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media3.m3u8'),
              'media playlist requested');
  strictEqual(requests[3].url,
              absoluteUrl('manifest/media3-00001.ts'),
              'first segment requested');
});

test('does not downshift if bandwidth is low', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.tech.hls.playlists.setBandwidth = function() {
    player.tech.hls.playlists.bandwidth = 100;
  };

  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(requests[0].url, 'manifest/master.m3u8', 'master playlist requested');
  strictEqual(requests[1].url,
              absoluteUrl('manifest/media.m3u8'),
              'media playlist requested');
  strictEqual(requests[2].url,
              absoluteUrl('manifest/media-00001.ts'),
              'first segment requested');
});

test('starts draining the buffer on init', function() {
  var player, drains = 0;

  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  // wait long enough for the buffer check interval to expire and
  // trigger drainBuffer
  player.tech.hls.drainBuffer = function() {
    drains++;
  };
  clock.tick(500);
  equal(drains, 1, 'called drainBuffer');

  player.dispose();
  clock.tick(100 * 1000);
  equal(drains, 1, 'did not call drainBuffer again');
});

test('buffer checks are noops until a media playlist is ready', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.hls.checkBuffer_();

  strictEqual(1, requests.length, 'one request was made');
  strictEqual(requests[0].url, 'manifest/media.m3u8', 'media playlist requested');
});

test('buffer checks are noops when only the master is ready', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift());
  standardXHRResponse(requests.shift());
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
  standardXHRResponse(requests.shift());
  // trigger fillBuffer()
  player.tech.hls.checkBuffer_();

  strictEqual(1, requests.length, 'one request was made');
  strictEqual(requests[0].url,
              absoluteUrl('manifest/media.m3u8'),
              'media playlist requested');
});

test('hls.bandwidth is available but deprecated', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech.triggerReady();
  clock.tick(1);
  ok(player.tech.hls.hasOwnProperty('bandwidth'), 'bandwidth is available but deprecated');
});

test('fires a progress event after downloading a segment', function() {
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
  player.tech.hls.selectPlaylist = function() {
    calls++;
    return player.tech.hls.playlists.master.playlists[0];
  };

  standardXHRResponse(requests[0]);

  player.tech.hls.segments.bandwidth = 3000000;
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);

  strictEqual(calls, 2, 'selects after the initial segment');
  player.currentTime = function() {
    return 1;
  };
  player.buffered = function() {
    return videojs.createTimeRange(0, 2);
  };
  player.tech.hls.checkBuffer_();

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
  player.tech.hls.selectPlaylist = function() {
    selectedPlaylist = true;

    // this duraiton should be overwritten by the playlist change
    player.tech.hls.mediaSource.duration = -Infinity;

    return player.tech.hls.playlists.master.playlists[1];
  };

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);
  standardXHRResponse(requests[2]);
  standardXHRResponse(requests[3]);
  ok(selectedPlaylist, 'selected playlist');
  ok(player.tech.hls.mediaSource.duration !== -Infinity, 'updates the duration');
});

test('downloads additional playlists if required', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech.hls.segments.bandwidth = 200;
  requests[0].respond(200, null,
                      '#EXTM3U\n' +
                      '#EXT-X-STREAM-INF:BANDWIDTH=50\n' +
                      'media.m3u8\n' +
                      '#EXT-X-STREAM-INF:BANDWIDTH=50000\n' +
                      'media1.m3u8\n'); // master
  standardXHRResponse(requests[1]); // media

  requests[2].bandwidth = 3000000;
  requests[2].response = new Uint8Array([0]);
  requests[2].respond(200, null, ''); // media, segment 0
  equal(requests.length, 4, 'made a new request');
  equal(requests[3].url,
        absoluteUrl('manifest/media1.m3u8'),
        'made playlist request');

  standardXHRResponse(requests[3]); // media1
  equal(requests.length, 5, 'made a new segment request');
  equal(player.tech.hls.playlists.media().uri,
        'media1.m3u8',
        'a new playlists was selected');
  ok(player.tech.hls.playlists.media().segments, 'segments are now available');
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
  player.tech.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 9e10;
  // playlist 1 has a very low bitrate
  player.tech.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 1;
  // but the detected client bandwidth is really low
  player.tech.hls.segments.bandwidth = 10;

  playlist = player.tech.hls.selectPlaylist();
  strictEqual(playlist,
              player.tech.hls.playlists.master.playlists[1],
              'the low bitrate stream is selected');
});

test('allows initial bandwidth to be provided', function() {
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.hls.segments.bandwidth = 500;

  requests[0].bandwidth = 1;
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-PLAYLIST-TYPE:VOD\n' +
                           '#EXT-X-TARGETDURATION:10\n');
  equal(player.tech.hls.segments.bandwidth, 500, 'prefers user-specified intial bandwidth');
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
  player.tech.hls.playlists.master.playlists[0].attributes.BANDWIDTH = 10;
  player.tech.hls.segments.bandwidth = 11;

  // 9.9 * 1.1 < 11
  player.tech.hls.playlists.master.playlists[1].attributes.BANDWIDTH = 9.9;
  playlist = player.tech.hls.selectPlaylist();

  strictEqual(playlist,
              player.tech.hls.playlists.master.playlists[1],
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
  player.tech.hls.segments.bandwidth = 1;
  playlist = player.tech.hls.selectPlaylist();

  // playlist 1 has the lowest advertised bitrate
  strictEqual(playlist,
              player.tech.hls.playlists.master.playlists[1],
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
  player.tech.hls.segments.bandwidth = 3000000;

  playlist = player.tech.hls.selectPlaylist();

  deepEqual(playlist.attributes.RESOLUTION, {width:960,height:540},'should return the correct resolution by player dimensions');
  equal(playlist.attributes.BANDWIDTH, 1928000, 'should have the expected bandwidth in case of multiple');

  player.width(1920);
  player.height(1080);
  player.tech.hls.segments.bandwidth = 3000000;

  playlist = player.tech.hls.selectPlaylist();

  deepEqual(playlist.attributes.RESOLUTION, {
    width:960,
    height:540
  },'should return the correct resolution by player dimensions');
  equal(playlist.attributes.BANDWIDTH, 1928000, 'should have the expected bandwidth in case of multiple');

  player.width(396);
  player.height(224);
  playlist = player.tech.hls.selectPlaylist();

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
  player.tech.hls.segments.bandwidth = 1e10;

  player.width(1024);
  player.height(768);

  playlist = player.tech.hls.selectPlaylist();

  equal(playlist.attributes.BANDWIDTH,
        1000,
        'selected the highest bandwidth variant');
});

test('only appends one segment at a time', function() {
  var appends = 0;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop()); // media.m3u8
  standardXHRResponse(requests.pop()); // segment 0

  player.tech.hls.sourceBuffer.updating = true;
  player.tech.hls.sourceBuffer.appendBuffer = function() {
    appends++;
  };

  player.tech.hls.checkBuffer_();
  standardXHRResponse(requests.pop()); // segment 1
  player.tech.hls.checkBuffer_(); // should be a no-op
  equal(appends, 0, 'did not append while updating');
});

QUnit.skip('records the min and max PTS values for a segment', function() {
  var tags = [];
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop()); // media.m3u8

  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  tags.push({ pts: 10, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.pop()); // segment 0

  equal(player.tech.hls.playlists.media().segments[0].minVideoPts, 0, 'recorded min video pts');
  equal(player.tech.hls.playlists.media().segments[0].maxVideoPts, 10, 'recorded max video pts');
  equal(player.tech.hls.playlists.media().segments[0].minAudioPts, 0, 'recorded min audio pts');
  equal(player.tech.hls.playlists.media().segments[0].maxAudioPts, 10, 'recorded max audio pts');
});

QUnit.skip('records PTS values for video-only segments', function() {
  var tags = [];
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop()); // media.m3u8

  player.tech.hls.segmentParser_.stats.aacTags = function() {
    return 0;
  };
  player.tech.hls.segmentParser_.stats.minAudioPts = function() {
    throw new Error('No audio tags');
  };
  player.tech.hls.segmentParser_.stats.maxAudioPts = function() {
    throw new Error('No audio tags');
  };
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  tags.push({ pts: 10, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.pop()); // segment 0

  equal(player.tech.hls.playlists.media().segments[0].minVideoPts, 0, 'recorded min video pts');
  equal(player.tech.hls.playlists.media().segments[0].maxVideoPts, 10, 'recorded max video pts');
  strictEqual(player.tech.hls.playlists.media().segments[0].minAudioPts, undefined, 'min audio pts is undefined');
  strictEqual(player.tech.hls.playlists.media().segments[0].maxAudioPts, undefined, 'max audio pts is undefined');
});

QUnit.skip('records PTS values for audio-only segments', function() {
  var tags = [];
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.pop()); // media.m3u8

  player.tech.hls.segmentParser_.stats.h264Tags = function() {
    return 0;
  };
  player.tech.hls.segmentParser_.stats.minVideoPts = function() {
    throw new Error('No video tags');
  };
  player.tech.hls.segmentParser_.stats.maxVideoPts = function() {
    throw new Error('No video tags');
  };
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  tags.push({ pts: 10, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.pop()); // segment 0

  equal(player.tech.hls.playlists.media().segments[0].minAudioPts, 0, 'recorded min audio pts');
  equal(player.tech.hls.playlists.media().segments[0].maxAudioPts, 10, 'recorded max audio pts');
  strictEqual(player.tech.hls.playlists.media().segments[0].minVideoPts, undefined, 'min video pts is undefined');
  strictEqual(player.tech.hls.playlists.media().segments[0].maxVideoPts, undefined, 'max video pts is undefined');
});

test('waits to download new segments until the media playlist is stable', function() {
  var media;
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift()); // master
  player.tech.hls.segments.bandwidth = 1; // make sure we stay on the lowest variant
  standardXHRResponse(requests.shift()); // media

  // mock a playlist switch
  media = player.tech.hls.playlists.media();
  player.tech.hls.playlists.media = function() {
    return media;
  };
  player.tech.hls.playlists.state = 'SWITCHING_MEDIA';

  standardXHRResponse(requests.shift()); // segment 0

  equal(requests.length, 0, 'no requests outstanding');
  player.tech.hls.checkBuffer_();
  equal(requests.length, 0, 'delays segment fetching');

  player.tech.hls.playlists.state = 'LOADED_METADATA';
  player.tech.hls.playlists.trigger('loadedplaylist');
  equal(requests.length, 1, 'resumes segment fetching');
});

test('exposes alternate renditions as media track lists', function() {
  player.src({
    src: 'alternate-audio.m3u8',
    type: 'application/x-mpegURL'
  });

  openMediaSource(player);
  ok(player.tech.hls.audioTracks, 'created an audio track list');
  ok(player.tech.hls.videoTracks, 'created a video track list');

  standardXHRResponse(requests.shift()); // master
  equal(player.tech.hls.audioTracks.length, 0, 'no audio tracks available yet');
  equal(player.tech.hls.videoTracks.length, 0, 'no video tracks available yet');

  standardXHRResponse(requests.shift()); // media without alternative audio
  equal(player.tech.hls.audioTracks.length, 1, 'default audio track available');
  deepEqual(player.tech.hls.audioTracks[0], {
    id: 'default',
    kind: 'main',
    label: '',
    language: '',
    enabled: true
  }, 'created a default audio track');
  equal(player.tech.hls.videoTracks.length, 1, 'default video track available');
  deepEqual(player.tech.hls.videoTracks[0], {
    id: 'default',
    kind: 'main',
    label: '',
    language: '',
    selected: true
  }, 'created a default video track');

  requests.length = 0; // ignore any outstanding requests
  player.tech.hls.playlists.media('hi/media1.m3u8');
  standardXHRResponse(requests.shift()); // media with alternative audio
  equal(player.tech.hls.audioTracks.length, 3, 'found all audio tracks');
  deepEqual(player.tech.hls.audioTracks[0], {
    id: 'English',
    kind: 'main',
    label: 'English',
    language: 'eng',
    enabled: true
  }, 'translated the default track');
  deepEqual(player.tech.hls.audioTracks[1], {
    id: 'Français',
    kind: 'alternative',
    label: 'Français',
    language: 'fre',
    enabled: false
  }, 'translated the french track');
  deepEqual(player.tech.hls.audioTracks[2], {
    id: 'Espanol',
    kind: 'alternative',
    label: 'Espanol',
    language: 'sp',
    enabled: false
  }, 'translated the spanish track');
});

QUnit.skip('exposes in-band metadata events as cues', function() {
  var track;
  videojs.Hls.SegmentParser = mockSegmentParser();
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.tech.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 2000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }, {
        id: 'WXXX',
        url: 'http://example.com'
      }, {
        id: 'PRIV',
        owner: 'owner@example.com',
        privateData: new Uint8Array([1, 2, 3])
      }]
    });
  };

  standardXHRResponse(requests[0]);
  standardXHRResponse(requests[1]);

  equal(player.textTracks().length, 1, 'created a text track');
  track = player.textTracks()[0];
  equal(track.kind, 'metadata', 'kind is metadata');
  equal(track.inBandMetadataTrackDispatchType, '15010203BB', 'set the dispatch type');
  equal(track.cues.length, 3, 'created three cues');
  equal(track.cues[0].startTime, 2, 'cue starts at 2 seconds');
  equal(track.cues[0].endTime, 2, 'cue ends at 2 seconds');
  equal(track.cues[0].pauseOnExit, false, 'cue does not pause on exit');
  equal(track.cues[0].text, 'cue text', 'set cue text');

  equal(track.cues[1].startTime, 2, 'cue starts at 2 seconds');
  equal(track.cues[1].endTime, 2, 'cue ends at 2 seconds');
  equal(track.cues[1].pauseOnExit, false, 'cue does not pause on exit');
  equal(track.cues[1].text, 'http://example.com', 'set cue text');

  equal(track.cues[2].startTime, 2, 'cue starts at 2 seconds');
  equal(track.cues[2].endTime, 2, 'cue ends at 2 seconds');
  equal(track.cues[2].pauseOnExit, false, 'cue does not pause on exit');
  equal(track.cues[2].text, '', 'did not set cue text');
  equal(track.cues[2].frame.owner, 'owner@example.com', 'set the owner');
  deepEqual(track.cues[2].frame.privateData,
            new Uint8Array([1, 2, 3]),
            'set the private data');
});

QUnit.skip('only adds in-band cues the first time they are encountered', function() {
  var tags = [{ pts: 0, bytes: new Uint8Array(1) }], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.tech.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 2000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }]
    });
  };
  standardXHRResponse(requests.shift());
  standardXHRResponse(requests.shift());
  // seek back to the first segment
  player.currentTime(0);
  player.tech.hls.trigger('seeking');
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  standardXHRResponse(requests.shift());

  track = player.textTracks()[0];
  equal(track.cues.length, 1, 'only added the cue once');
});

QUnit.skip('clears in-band cues ahead of current time on seek', function() {
  var
    tags = [],
    events = [],
    track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    while (events.length) {
      player.tech.hls.segmentParser_.metadataStream.trigger('data', events.shift());
    }
  };
  standardXHRResponse(requests.shift()); // media
  tags.push({ pts: 0, bytes: new Uint8Array(1) },
            { pts: 10 * 1000, bytes: new Uint8Array(1) });
  events.push({
      pts: 9.9 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 1'
      }]
  });
  events.push({
      pts: 20 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 3'
      }]
  });
  standardXHRResponse(requests.shift()); // segment 0
  tags.push({ pts: 10 * 1000 + 1, bytes: new Uint8Array(1) },
            { pts: 20 * 1000, bytes: new Uint8Array(1) });
  events.push({
      pts: 19.9 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 2'
      }]
  });
  player.tech.hls.checkBuffer_();
  standardXHRResponse(requests.shift()); // segment 1

  track = player.textTracks()[0];
  equal(track.cues.length, 3, 'added the cues');

  // seek into segment 1
  player.currentTime(11);
  player.trigger('seeking');
  equal(track.cues.length, 1, 'removed later cues');
  equal(track.cues[0].startTime, 9.9, 'retained the earlier cue');
});

QUnit.skip('translates ID3 PTS values to cue media timeline positions', function() {
  var tags = [{ pts: 4 * 1000, bytes: new Uint8Array(1) }], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.tech.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 5 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }]
    });
  };
  standardXHRResponse(requests.shift()); // media
  standardXHRResponse(requests.shift()); // segment 0

  track = player.textTracks()[0];
  equal(track.cues[0].startTime, 1, 'translated startTime');
  equal(track.cues[0].endTime, 1, 'translated startTime');
});

QUnit.skip('translates ID3 PTS values with expired segments', function() {
  var tags = [{ pts: 4 * 1000, bytes: new Uint8Array(1) }], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.play();

  // 20.9 seconds of content have expired
  player.hls.playlists.expiredPostDiscontinuity_ = 20.9;

  player.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 5 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }]
    });
  };
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:2\n' +
                           '#EXTINF:10,\n' +
                           '2.ts\n' +
                           '#EXTINF:10,\n' +
                           '3.ts\n');    // media
  standardXHRResponse(requests.shift()); // segment 0

  track = player.textTracks()[0];
  equal(track.cues[0].startTime, 20.9 + 1, 'translated startTime');
  equal(track.cues[0].endTime, 20.9 + 1, 'translated startTime');
});

QUnit.skip('translates id3 PTS values for audio-only media', function() {
  var tags = [{ pts: 4 * 1000, bytes: new Uint8Array(1) }], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    player.hls.segmentParser_.metadataStream.trigger('data', {
      pts: 5 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue text'
      }]
    });
  };
  player.hls.segmentParser_.stats.h264Tags = function() { return 0; };
  player.hls.segmentParser_.stats.minVideoPts = null;
  standardXHRResponse(requests.shift()); // media
  standardXHRResponse(requests.shift()); // segment 0

  track = player.textTracks()[0];
  equal(track.cues[0].startTime, 1, 'translated startTime');
});

QUnit.skip('translates ID3 PTS values across discontinuities', function() {
  var tags = [], events = [], track;
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  player.src({
    src: 'cues-and-discontinuities.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech.hls.segmentParser_.parseSegmentBinaryData = function() {
    // trigger a metadata event
    if (events.length) {
      player.tech.hls.segmentParser_.metadataStream.trigger('data', events.shift());
    }
  };

  // media playlist
  player.tech.play();
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXT-X-DISCONTINUITY\n' +
                           '#EXTINF:10,\n' +
                           '1.ts\n');

  // segment 0 starts at PTS 14000 and has a cue point at 15000
  tags.push({ pts: 14 * 1000, bytes: new Uint8Array(1) },
            { pts: 24 * 1000, bytes: new Uint8Array(1) });
  events.push({
      pts:  15 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 0'
      }]
  });
  standardXHRResponse(requests.shift()); // segment 0

  // segment 1 is after a discontinuity, starts at PTS 22000
  // and has a cue point at 23000
  tags.push({ pts: 22 * 1000, bytes: new Uint8Array(1) });
  events.push({
      pts:  23 * 1000,
      data: new Uint8Array([]),
      frames: [{
        id: 'TXXX',
        value: 'cue 1'
      }]
  });
  player.tech.hls.checkBuffer_();
  standardXHRResponse(requests.shift());

  track = player.textTracks()[0];
  equal(track.cues.length, 2, 'created cues');
  equal(track.cues[0].startTime, 1, 'first cue started at the correct time');
  equal(track.cues[0].endTime, 1, 'first cue ended at the correct time');
  equal(track.cues[1].startTime, 11, 'second cue started at the correct time');
  equal(track.cues[1].endTime, 11, 'second cue ended at the correct time');
});

QUnit.skip('drops tags before the target timestamp when seeking', function() {
  var i = 10,
      tags = [],
      bytes = [];

  // mock out the parser and source buffer
  videojs.Hls.SegmentParser = mockSegmentParser(tags);
  window.videojs.SourceBuffer = function() {
    this.appendBuffer = function(chunk) {
      bytes.push(chunk);
    };
    this.abort = function() {};
  };

  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests[0]); // media

  // push a tag into the buffer
  tags.push({ pts: 0, bytes: new Uint8Array(1) });
  standardXHRResponse(requests[1]); // segment 0

  // mock out a new segment of FLV tags
  bytes = [];
  while (i--) {
    tags.unshift({
      pts: i * 1000,
      bytes: new Uint8Array([i])
    });
  }
  player.currentTime(7);
  standardXHRResponse(requests[2]);

  deepEqual(bytes, [new Uint8Array([7,8,9])], 'three tags are appended');
});

test('adjusts the segment offsets for out-of-buffer seeking', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift()); // media
  player.tech.hls.sourceBuffer.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };
  equal(player.tech.hls.segments.mediaIndex(), 0, 'starts at zero');

  player.tech.setCurrentTime(35);
  clock.tick(1);
  // drop the aborted segment
  ok(requests[0].aborted, 'aborted the first segment request');
  requests.shift();
  equal(player.tech.hls.segments.mediaIndex(), 3, 'moved the mediaIndex');
  standardXHRResponse(requests.shift());
});

test('seeks between buffered time ranges', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift()); // media
  player.tech.buffered = function() {
    return {
      length: 2,
      ranges_: [[0, 10], [20, 30]],
      start: function(i) {
        return this.ranges_[i][0];
      },
      end: function(i) {
        return this.ranges_[i][1];
      }
    };
  };

  player.tech.setCurrentTime(15);
  clock.tick(1);
  // drop the aborted segment
  requests.shift();
  equal(player.tech.hls.segments.mediaIndex(), 1, 'updated the mediaIndex');
  standardXHRResponse(requests.shift());
});

test('does not modify the media index for in-buffer seeking', function() {
  var mediaIndex;
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift());
  player.tech.buffered = function() {
    return videojs.createTimeRange(0, 20);
  };
  mediaIndex = player.tech.hls.segments.mediaIndex();

  player.tech.setCurrentTime(11);
  clock.tick(1);
  equal(player.tech.hls.segments.mediaIndex(), mediaIndex, 'did not interrupt buffering');
  equal(requests.length, 1, 'did not abort the outstanding request');
});

test('playlist 404 should end stream with a network error', function() {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.pop().respond(404);

  equal(player.tech.hls.mediaSource.error_, 'network', 'set a network error');
});

test('segment 404 should trigger MEDIA_ERR_NETWORK', function () {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(player);

  standardXHRResponse(requests[0]);
  requests[1].respond(404);
  ok(player.tech.hls.error.message, 'an error message is available');
  equal(player.tech.hls.error.code,
        2,
        'error code should be set to MediaError.MEDIA_ERR_NETWORK');
});

test('segment 500 should trigger MEDIA_ERR_ABORTED', function () {
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(player);

  standardXHRResponse(requests[0]);
  requests[1].respond(500);
  ok(player.tech.hls.error.message, 'an error message is available');
  equal(4, player.tech.hls.error.code, 'Player error code should be set to MediaError.MEDIA_ERR_ABORTED');
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
  player.tech.setCurrentTime(183);
  clock.tick(1);

  equal(requests.length, requestsLength, 'made no additional requests');
});

test('duration is Infinity for live playlists', function() {
  player.src({
    src: 'http://example.com/manifest/missingEndlist.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  strictEqual(player.tech.hls.mediaSource.duration,
              Infinity,
              'duration is infinity');
});

test('updates the media index when a playlist reloads', function() {
  player.src({
    src: 'http://example.com/live-updating.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.play();
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXTINF:10,\n' +
                           '1.ts\n' +
                           '#EXTINF:10,\n' +
                           '2.ts\n'); // media
  clock.tick(1);
  standardXHRResponse(requests.shift()); // 0.ts
  // play the stream until 2.ts is playing
  standardXHRResponse(requests.shift()); // 1.ts
  standardXHRResponse(requests.shift()); // 2.ts
  // trigger a playlist refresh
  player.tech.hls.playlists.trigger('mediaupdatetimeout');
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:1\n' +
                           '#EXTINF:10,\n' +
                           '1.ts\n' +
                           '#EXTINF:10,\n' +
                           '2.ts\n' +
                           '#EXTINF:10,\n' +
                           '3.ts\n');

  strictEqual(player.tech.hls.segments.mediaIndex(),
              2,
              'mediaIndex is updated after the reload');
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

  player.tech.play();
  clock.tick(1);
  mediaPlaylist = player.tech.hls.playlists.media();
  equal(player.tech.hls.segments.mediaIndex(), 1, 'mediaIndex is updated at play');
  equal(player.currentTime(), player.tech.hls.seekable().end(0), 'seeked to the seekable end');

  equal(requests.length, 1, 'begins buffering');
});

test('starts three target durations before live when play is called early', function() {
  player.src({
    src: 'live.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.paused = function() { return false; };
  player.tech.play();
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
  clock.tick(1);

  equal(requests.length, 1, 'made a single request');
  equal(player.tech.hls.segments.mediaIndex(), 1, 'media index is correct');
});

test('does not reset live currentTime if mediaIndex is one beyond the last available segment', function() {
  var playlist = {
    mediaSequence: 20,
    targetDuration: 9,
    segments: [{
      duration: 3
    }, {
      duration: 3
    }, {
      duration: 3
    }]
  };

  equal(playlist.segments.length,
        videojs.Hls.translateMediaIndex(playlist.segments.length, playlist, playlist),
        'did not change mediaIndex');
});

test('live playlist starts with correct currentTime value', function() {
  player.src({
    src: 'http://example.com/manifest/liveStart30sBefore.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  standardXHRResponse(requests[0]);

  player.tech.hls.playlists.trigger('loadedmetadata');
  player.tech.play();

  strictEqual(player.currentTime(),
              videojs.Hls.Playlist.seekable(player.tech.hls.playlists.media()).end(0),
              'currentTime is updated at playback');
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
  player.tech.hls.seekable = function() {
    return videojs.createTimeRange(160, 170);
  };
  player.tech.setCurrentTime = function(time) {
    if (time !== undefined) {
      seekTarget = time;
    }
  };
  player.tech.played = function() {
    return videojs.createTimeRange(120, 170);
  };
  player.tech.trigger('playing');

  player.tech.play();
  equal(seekTarget, player.seekable().start(0), 'seeked to the start of seekable');
  player.tech.trigger('seeked');
});

test('mediaIndex returns correctly at playlist boundaries', function() {
  player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });

  openMediaSource(player);
  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media

  strictEqual(player.tech.hls.segments.mediaIndex(), 0, 'mediaIndex is zero at first segment');

  // seek to end
  player.tech.setCurrentTime(40);
  clock.tick(1);

  strictEqual(player.tech.hls.segments.mediaIndex(), 3, 'mediaIndex is 3 at last segment');
});

test('reloads out-of-date live playlists when switching variants', function() {
  player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  player.tech.hls.master = {
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
  player.tech.hls.media = player.tech.hls.master.playlists[0];
  player.mediaIndex = 1;
  window.manifests['variant-update'] = '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:16\n' +
    '#EXTINF:10,\n' +
    '16.ts\n' +
    '#EXTINF:10,\n' +
    '17.ts\n';

  // switch playlists
  player.tech.hls.selectPlaylist = function() {
    return player.tech.hls.master.playlists[1];
  };
  // timeupdate downloads segment 16 then switches playlists
  player.trigger('timeupdate');

  strictEqual(player.mediaIndex, 1, 'mediaIndex points at the next segment');
});

test('if withCredentials global option is used, withCredentials is set on the XHR object', function() {
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

test('can seek before the source buffer opens', function() {
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  player.tech.triggerReady();
  clock.tick(1);
  standardXHRResponse(requests.shift());
  player.triggerReady();

  player.currentTime(1);
  equal(player.currentTime(), 1, 'seeked');
});

// TODO: Decide on proper discontinuity behavior
QUnit.skip('sets the timestampOffset after seeking to discontinuity', function() {
  var bufferEnd;
  player.src({
    src: 'discontinuity.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.buffered = function() {
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
  player.tech.setCurrentTime(10);
  bufferEnd = 9.9;
  clock.tick(1);
  standardXHRResponse(requests.pop()); // 1.ts
  player.tech.hls.checkBuffer_();
  standardXHRResponse(requests.pop()); // 2.ts, again
  equal(player.tech.hls.sourceBuffer.timestampOffset,
        10,
        'set the timestamp offset');
});

QUnit.skip('tracks segment end times as they are buffered', function() {
  var bufferEnd = 0;
  player.src({
    src: 'media.m3u8',
    type: 'application/x-mpegURL'
  });
  openMediaSource(player);

  // as new segments are downloaded, the buffer end is updated
  player.tech.buffered = function() {
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
  equal(player.tech.hls.mediaSource.duration, 20, 'original duration is from the m3u8');

  bufferEnd = 9.5;
  player.tech.hls.sourceBuffer.trigger('update');
  player.tech.hls.sourceBuffer.trigger('updateend');
  equal(player.tech.duration(), 10 + 9.5, 'updated duration');
  equal(player.tech.hls.appendingSegmentInfo_, null, 'cleared the appending segment');
});

QUnit.skip('seeking does not fail when targeted between segments', function() {
  var currentTime, segmentUrl;
  player.src({
    src: 'media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  // mock out the currentTime callbacks
  player.tech.el().vjs_setProperty = function(property, value) {
    if (property === 'currentTime') {
      currentTime = value;
    }
  };
  player.tech.el().vjs_getProperty = function(property) {
    if (property === 'currentTime') {
      return currentTime;
    }
  };

  standardXHRResponse(requests.shift()); // media
  standardXHRResponse(requests.shift()); // segment 0
  player.tech.hls.checkBuffer_();
  segmentUrl = requests[0].url;
  standardXHRResponse(requests.shift()); // segment 1

  // seek to a time that is greater than the last tag in segment 0 but
  // less than the first in segment 1
  // FIXME: it's not possible to seek here without timestamp-based
  // segment durations
  player.tech.setCurrentTime(9.4);
  clock.tick(1);
  equal(requests[0].url, segmentUrl, 'requested the later segment');

  standardXHRResponse(requests.shift()); // segment 1
  player.tech.trigger('seeked');
  equal(player.currentTime(), 9.5, 'seeked to the later time');
});

test('resets the switching algorithm if a request times out', function() {
  player.src({
    src: 'master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.hls.segments.bandwidth = 20000;

  standardXHRResponse(requests.shift()); // master
  standardXHRResponse(requests.shift()); // media.m3u8
  // simulate a segment timeout
  requests[0].timedout = true;
  requests.shift().abort();

  standardXHRResponse(requests.shift());

  strictEqual(player.tech.hls.playlists.media(),
              player.tech.hls.playlists.master.playlists[1],
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
  loaderDispose = player.tech.hls.playlists.dispose;
  player.tech.hls.playlists.dispose = function() {
    disposes++;
    loaderDispose.call(player.tech.hls.playlists);
  };

  player.dispose();
  strictEqual(disposes, 1, 'disposed playlist loader');
});

test('disposes the segment loader', function() {
  var disposes = 0, player, loaderDispose;
  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  loaderDispose = player.tech.hls.segments.dispose;
  player.tech.hls.segments.dispose = function() {
    disposes++;
    loaderDispose.call(player.tech.hls.segments);
  };

  player.dispose();
  strictEqual(disposes, 1, 'disposed segment loader');
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

test('aborts the source buffer on disposal', function() {
  var aborts = 0, player;
  player = createPlayer();
  player.src({
    src: 'manifest/master.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.dispose();
  ok(true, 'disposed before creating the source buffer');
  requests.length = 0;

  player = createPlayer();
  player.src({
    src: 'manifest/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  standardXHRResponse(requests.shift());
  player.tech.hls.sourceBuffer.abort = function() {
    aborts++;
  };

  player.dispose();
  strictEqual(aborts, 1, 'aborted the source buffer');
});

test('the source handler supports HLS mime types', function() {
  ok(videojs.HlsSourceHandler.canHandleSource({
    type: 'aPplicatiOn/x-MPegUrl'
  }), 'supports x-mpegurl');
  ok(videojs.HlsSourceHandler.canHandleSource({
    type: 'aPplicatiOn/VnD.aPPle.MpEgUrL'
  }), 'supports vnd.apple.mpegurl');

  ok(!(videojs.HlsSourceHandler.canHandleSource({
    type: 'video/mp4'
  }) instanceof videojs.Hls), 'does not support mp4');
  ok(!(videojs.HlsSourceHandler.canHandleSource({
    type: 'video/x-flv'
  }) instanceof videojs.Hls), 'does not support flv');
});

test('has no effect if native HLS is available', function() {
  var player;
  videojs.Hls.supportsNativeHls = true;
  player = createPlayer();
  player.src({
    src: 'http://example.com/manifest/master.m3u8',
    type: 'application/x-mpegURL'
  });

  ok(!player.tech.hls, 'did not load hls tech');
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

  player.tech.hls.playlists.trigger('mediachange');
  strictEqual(mediaChanges, 1, 'fired mediachange');
});

test('can be disposed before finishing initialization', function() {
  var player = createPlayer(), readyHandlers = [];
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
    }
    ok(true, 'did not throw an exception');
  } catch (e) {
    ok(false, 'threw an exception');
  }
});

test('calls ended() on the media source at the end of a playlist', function() {
  var endOfStreams = 0;
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.hls.mediaSource.endOfStream = function() {
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

  player.tech.hls.sourceBuffer.trigger('updateend');
  strictEqual(endOfStreams, 1, 'ended media source');
});

test('calling play() at the end of a video resets the media index', function() {
  player.src({
    src: 'http://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXTINF:10,\n' +
                           '0.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.shift());

  strictEqual(player.tech.hls.segments.mediaIndex(),
              1,
              'index is 1 after the first segment');
  player.tech.ended = function() {
    return true;
  };

  player.tech.play();
  strictEqual(player.tech.hls.segments.mediaIndex(),
              0,
              'index is 0 after the first segment');
});

test('drainBuffer will not proceed with empty source buffer', function() {
  var oldMedia, newMedia, compareBuffer;
  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);

  oldMedia = player.tech.hls.playlists.media;
  newMedia = {segments: [{
    key: {
      'retries': 5
    },
    uri: 'http://media.example.com/fileSequence52-A.ts'
  }, {
    key: {
      'method': 'AES-128',
      'uri': 'https://priv.example.com/key.php?r=53'
    },
    uri: 'http://media.example.com/fileSequence53-B.ts'
  }]};
  player.tech.hls.playlists.media = function() {
    return newMedia;
  };

  player.tech.hls.sourceBuffer = undefined;
  compareBuffer = [{mediaIndex: 0, playlist: newMedia, offset: 0, bytes: new Uint8Array(3)}];
  player.tech.hls.segmentBuffer_ = [{mediaIndex: 0, playlist: newMedia, offset: 0, bytes: new Uint8Array(3)}];

  player.tech.hls.drainBuffer();

  /* Normally, drainBuffer() calls segmentBuffer.shift(), removing a segment from the stack.
   * Comparing two buffers to ensure no segment was popped verifies that we returned early
   * from drainBuffer() because sourceBuffer was empty.
   */
  deepEqual(player.tech.hls.segmentBuffer_, compareBuffer, 'playlist remains unchanged');

  player.tech.hls.playlists.media = oldMedia;
});

test('keys are requested when an encrypted segment is loaded', function() {
  player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.play();
  standardXHRResponse(requests.shift()); // playlist
  clock.tick(1);
  standardXHRResponse(requests.shift()); // first segment

  strictEqual(requests.length, 2, 'a key XHR is created');
  strictEqual(requests[0].url,
              player.tech.hls.playlists.media().segments[0].key.uri,
              'a key XHR is created with correct uri');
});

test('keys are resolved relative to the master playlist', function() {
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

  standardXHRResponse(requests.shift());
  equal(requests.length, 1, 'requested the key');
  ok((/video\/playlist\/keys\/key\.php$/).test(requests[0].url),
     'resolves multiple relative paths');
});

test('keys are resolved relative to their containing playlist', function() {
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
  standardXHRResponse(requests.shift());
  equal(requests.length, 1, 'requested a key');
  ok((/video\/keys\/key\.php$/).test(requests[0].url),
     'resolves multiple relative paths');
});

test('a new key XHR is created when a the segment is received', function() {
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
  standardXHRResponse(requests.shift()); // segment 1
  standardXHRResponse(requests.shift()); // key 1
  // "finish" decrypting segment 1
  player.tech.hls.segments.peek().bytes = new Uint8Array(16);
  player.tech.hls.checkBuffer_();

  standardXHRResponse(requests.shift()); // segment 2

  strictEqual(requests.length, 1, 'a key XHR is created');
  strictEqual(requests[0].url,
              'https://example.com/' +
              player.tech.hls.playlists.media().segments[1].key.uri,
              'a key XHR is created with the correct uri');
});

test('seeking should abort an outstanding key request and create a new one', function() {
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
  standardXHRResponse(requests.shift()); // segment 1

  player.currentTime(11);
  clock.tick(1);
  ok(requests[0].aborted, 'the key XHR should be aborted');
  requests.shift(); // aborted key 1
  ok(requests[0].aborted, 'the segment XHR should be aborted');
  requests.shift(); // aborted segment 2

  equal(requests.length, 1, 'requested the new segment');
  standardXHRResponse(requests.shift()); // segment 2
  equal(requests.length, 1, 'requested the new key');
  equal(requests[0].url,
        'https://example.com/' +
        player.tech.hls.playlists.media().segments[1].key.uri,
        'urls should match');
});

test('retries key requests once upon failure', function() {
  player.src({
    src: 'https://example.com/encrypted.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.play();

  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence52-A.ts\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
                           '#EXTINF:15.0,\n' +
                           'http://media.example.com/fileSequence53-A.ts\n' +
                           '#EXT-X-ENDLIST\n');
  standardXHRResponse(requests.shift()); // segment
  requests[0].respond(404);
  equal(requests.length, 3, 'create a new XHR for the same key');
  equal(requests[2].url, requests[0].url, 'should be the same key');

  requests[2].respond(404);
  equal(requests.length, 3, 'gives up after one retry');
});

test('skip segments if key requests fail more than once', function() {
  var bytes = [];

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.play();

  requests.shift().respond(200, null,
                         '#EXTM3U\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=52"\n' +
                         '#EXTINF:2.833,\n' +
                         'http://media.example.com/fileSequence52-A.ts\n' +
                         '#EXT-X-KEY:METHOD=AES-128,URI="htts://priv.example.com/key.php?r=53"\n' +
                         '#EXTINF:15.0,\n' +
                         'http://media.example.com/fileSequence53-A.ts\n');
  clock.tick(1);
  player.tech.hls.sourceBuffer.appendBuffer = function(chunk) {
    bytes.push(chunk);
  };
  standardXHRResponse(requests.shift()); // segment 1
  requests.shift().respond(404); // fail key
  requests.pop().respond(404); // fail key, again

  player.tech.hls.checkBuffer_();
  standardXHRResponse(requests.shift()); // segment 2
  equal(bytes.length, 0, 'did not append encrypted bytes');

  // key for second segment
  requests[0].response = new Uint32Array([0,0,0,0]).buffer;
  requests.shift().respond(200, null, '');
  // "finish" decryption
  player.tech.hls.segments.peek().bytes = new Uint8Array(16);
  player.tech.hls.checkBuffer_();

  equal(bytes.length, 1, 'appended cleartext bytes from the second segment');
  deepEqual(bytes[0], new Uint8Array(16), 'appended bytes from the second segment, not the first');
});

test('the key is supplied to the decrypter in the correct format', function() {
  var keys = [];

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.play();

  requests.pop().respond(200, null,
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
  clock.tick(1);

  standardXHRResponse(requests.shift()); // segment
  requests[0].response = new Uint32Array([0,1,2,3]).buffer;
  requests[0].respond(200, null, '');
  requests.shift(); // key

  equal(keys.length, 1, 'only one Decrypter was constructed');
  deepEqual(keys[0],
            new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
            'passed the specified segment key');

});
test('supplies the media sequence of current segment as the IV by default, if no IV is specified', function() {
  var ivs = [];

  player.src({
    src: 'https://example.com/encrypted-media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.play();

  requests.pop().respond(200, null,
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
  clock.tick(1);

  standardXHRResponse(requests.shift()); // segment 52
  requests[0].response = new Uint32Array([0,0,0,0]).buffer;
  requests.shift().respond(200, null, ''); // key

  equal(ivs.length, 1, 'only one Decrypter was constructed');
  deepEqual(ivs[0],
        new Uint32Array([0, 0, 0, 5]),
        'the IV for the segment is the media sequence');
});

test('switching playlists with an outstanding key request does not stall playback', function() {
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
  player.tech.play();

  // master playlist
  standardXHRResponse(requests.shift());
  // media playlist
  requests.shift().respond(200, null, media);
  clock.tick(1);
  // mock out media switching from this point on
  player.tech.hls.playlists.media = function() {
    return player.tech.hls.playlists.master.playlists[0];
  };
  // first segment of the original media playlist
  standardXHRResponse(requests.shift());
  // don't respond to the initial key request
  requests.shift();

  // "switch" media
  player.tech.hls.playlists.trigger('mediachange');

  player.tech.hls.checkBuffer_();

  ok(requests.length, 'made a request');
  equal(requests[0].url,
        'http://media.example.com/fileSequence52-B.ts',
        'requested the segment');
  equal(requests[1].url,
        'https://priv.example.com/key.php?r=52',
        'requested the key');
});

test('resolves relative key URLs against the playlist', function() {
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
  standardXHRResponse(requests.shift()); // segment

  equal(requests[0].url, 'https://example.com/key.php?r=52', 'resolves the key URL');
});

test('treats invalid keys as a key request failure', function() {
  var bytes = [];
  player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.play();
  requests.shift().respond(200, null,
                           '#EXTM3U\n' +
                           '#EXT-X-MEDIA-SEQUENCE:5\n' +
                           '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n' +
                           '#EXTINF:2.833,\n' +
                           'http://media.example.com/fileSequence52-A.ts\n' +
                           '#EXT-X-KEY:METHOD=NONE\n' +
                           '#EXTINF:15.0,\n' +
                           'http://media.example.com/fileSequence52-B.ts\n');
  player.tech.hls.sourceBuffer.appendBuffer = function(chunk) {
    bytes.push(chunk);
  };
  clock.tick(1);

  // segment request
  standardXHRResponse(requests.shift());
  // keys should be 16 bytes long
  requests[0].response = new Uint8Array(1).buffer;
  requests.shift().respond(200, null, '');

  equal(requests[1].url, 'https://priv.example.com/key.php?r=52', 'retries the key');

  // the retried response is invalid, too
  requests[1].response = new Uint8Array(1);
  requests.pop().respond(200, null, '');

  // the first segment should be dropped and playback moves on
  player.tech.hls.checkBuffer_();
  equal(bytes.length, 0, 'did not append bytes');

  // second segment request
  requests[0].response = new Uint8Array([1, 2]);
  requests.shift().respond(200, null, '');

  equal(bytes.length, 1, 'appended bytes');
  deepEqual(bytes[0], new Uint8Array([1, 2]), 'skipped to the second segment');
});

test('live stream should not call endOfStream', function(){
  player.src({
    src: 'https://example.com/media.m3u8',
    type: 'application/vnd.apple.mpegurl'
  });
  openMediaSource(player);
  player.tech.play();
  requests[0].respond(200, null,
                      '#EXTM3U\n' +
                      '#EXT-X-MEDIA-SEQUENCE:0\n' +
                      '#EXTINF:1\n' +
                      '0.ts\n');
  clock.tick(1);
  requests[1].response = window.bcSegment;
  requests[1].respond(200, null, "");
  equal("open", player.tech.hls.mediaSource.readyState,
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
  player.tech.hls.checkBuffer_();

  requests = requests.filter(function(request) {
    return !/m3u8$/.test(request.uri);
  });
  equal(requests.length, 0, 'did not download any segments');
});

})(window, window.videojs);

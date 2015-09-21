/**
 * Test cases for segment-loader.js
 */
(function(window, videojs, undefined) {
  'use strict';

  var SegmentLoader = videojs.Hls.SegmentLoader,
      SegmentMultiLoader = videojs.Hls.SegmentMultiLoader,
      absoluteUrl = window.absoluteUrl,
      expected = window.expected;

  var segmentLoader, clock, xhr, requests, globalOptions;

  var segmentResponse = function(request) {
    request.response = new Uint8Array(16).buffer;
    request.respond(200,
                    { 'Content-Type': 'video/MP2T' },
                    null);
  };

  var useTestEnvironment = function() {
    globalOptions = videojs.options.hls;
    clock = sinon.useFakeTimers();
    xhr = sinon.useFakeXMLHttpRequest();
    requests = [];
    xhr.onCreate = function(xhr) {
      requests.push(xhr);
    };
  };

  var restoreEnvironment = function() {
    videojs.options.hls = globalOptions;
    clock.restore();
    xhr.restore();
  };

  module('Segment Loader', {
    beforeEach: function() {
      segmentLoader = new SegmentLoader();
      useTestEnvironment();
    },
    afterEach: function() {
      if (segmentLoader) {
        segmentLoader.dispose();
      }
      restoreEnvironment();
    }
  });

  test('can be constructed', function() {
    ok(segmentLoader, 'constructed a segment loader');
  });

  test('downloads segments when a playlist is provided', function() {
    segmentLoader.load({
      segments: [{
        uri: '0.ts'
      }, {
        uri: '1.ts'
      }]
    });
    segmentLoader.fetch();

    equal(requests.length, 1, 'made a request');
    equal(requests[0].url,
          absoluteUrl('0.ts'),
          'the first segment is requested');
  });

  test('emits "progress" when a segment finishes downloading', function() {
    var progress = 0;
    segmentLoader.on('progress', function() {
      progress++;
    });
    segmentLoader.load(expected.media);
    segmentLoader.fetch();

    segmentResponse(requests.shift());
    equal(progress, 1, 'emitted one event');
  });

  test('emits "change" when a segment is removed', function() {
    var changes = 0;
    segmentLoader.load(expected.media);
    segmentLoader.on('change', function() {
      changes++;
    });
    segmentLoader.fetch();
    segmentResponse(requests.shift());

    segmentLoader.shift();
    equal(changes, 1, 'emitted one event');
  });

  test('recognizes absolute URIs and requests them unmodified', function() {
    segmentLoader.load(expected.absoluteUris);
    segmentLoader.fetch();

    equal(requests.length, 1, 'made a request');
    strictEqual(requests[0].url,
                'http://example.com/00001.ts',
                'the URI is requested as-is');
  });

  test('recognizes domain-relative URLs', function() {
    segmentLoader.load(expected.domainUris);
    segmentLoader.fetch();

    equal(requests.length, 1, 'made a request');
    equal(requests[0].url,
          window.location.protocol + '//' + window.location.host +
          '/00001.ts',
          'appended domain to the URI');
  });

  test('resolves relative URLs against a base URL', function() {
    segmentLoader.baseUrl('http://example.com');
    segmentLoader.load(expected.media);

    segmentLoader.fetch();
    equal(requests[0].url,
          'http://example.com/' + expected.media.segments[0].uri,
          'resolved the segment URL');
  });

  test('a variant playlist can be switched to on-the-fly', function() {
    segmentLoader.load({
      segments: [{
        duration: 5,
        uri: 'low/0.ts'
      }, {
        duration: 5,
        uri: 'low/1.ts'
      }, {
        duration: 10,
        uri: 'low/2.ts'
      }]
    });
    // respond to a segment request so the mediaIndex bumps up
    segmentLoader.fetch();
    equal(requests[0].url,
          absoluteUrl('low/0.ts'),
          'requested the first segment of the original playlist');
    segmentResponse(requests[0]);
    segmentLoader.fetch(); // fetch the next segment

    // you can specify an explicit media index if the two variants
    // have differing segmentation
    segmentLoader.load({
      segments: [{
        duration: 10,
        uri: 'high/0.ts'
      }, {
        duration: 10,
        uri: 'high/1.ts'
      }]
    }, 1);
    equal(requests[1].url,
          absoluteUrl('low/1.ts'),
          'requested the second segment of the original playlist');

    segmentResponse(requests[1]);
    segmentLoader.fetch();
    equal(requests[2].url,
          absoluteUrl('high/1.ts'),
          'requested the second segment of the original playlist');
    equal(segmentLoader.mediaIndex(), 1, 'updated the mediaIndex');

    segmentResponse(requests[2]);
    equal(segmentLoader.length(), 3, 'buffered all the segments');
  });

  test('calculates the bandwidth after downloading a segment', function() {
    segmentLoader.load(expected.media);
    segmentLoader.fetch();

    segmentResponse(requests[0]);

    // set the request time to be a bit earlier so our bandwidth
    // calculations are not NaN
    segmentLoader.fetch();
    requests[1].requestTime = (new Date()) - 100;

    segmentResponse(requests[1]);

    ok(segmentLoader.bandwidth, 'bandwidth is calculated');
    ok(segmentLoader.bandwidth > 0,
       'bandwidth is positive: ' + segmentLoader.bandwidth);
    ok(segmentLoader.segmentXhrTime >= 0,
       'saves segment request time: ' + segmentLoader.segmentXhrTime + 's');
  });

  test('fires a progress event after downloading a segment', function() {
    var progressCount = 0;

    segmentLoader.load(expected.media);
    segmentLoader.on('progress', function() {
      progressCount++;
    });
    segmentLoader.fetch();
    segmentResponse(requests.shift());

    equal(progressCount, 1, 'fired a progress event');
  });

  test('moves to the next segment if there is a network error', function() {
    var mediaIndex;
    segmentLoader.load(expected.media);

    segmentLoader.bandwidth = 20000;
    mediaIndex = segmentLoader.mediaIndex();

    segmentLoader.fetch();
    requests.shift().respond(400);
    equal(mediaIndex + 1, segmentLoader.mediaIndex(), 'media index is incremented');
  });

  test('stops downloading once the playlist is finished', function() {
    var i;
    segmentLoader.load(expected.media);

    for (i = 0; i < expected.media.segments.length; i++) {
      // download and drain all the segments
      segmentLoader.fetch();
      segmentResponse(requests.shift());
      segmentLoader.shift();
    }
    equal(segmentLoader.desiredBuffer(), 0, 'no outstanding content to buffer');
  });

  test('the next segment can be viewed without removing it', function() {
    segmentLoader.load(expected.media);
    segmentLoader.fetch();
    strictEqual(segmentLoader.peek(), undefined, 'is undefined with an empty buffer');

    segmentResponse(requests.shift());
    ok(segmentLoader.peek(), 'is available when a segment is ready');
    deepEqual(segmentLoader.peek(), segmentLoader.shift(), 'is the first segment');
  });

  test('cancels outstanding requests when seeking', function() {
    var changes = 0;
    segmentLoader.load(expected.media);
    segmentLoader.on('change', function() {
      changes++;
    });
    segmentLoader.fetch();

    // attempt to seek while the download is in progress
    segmentLoader.mediaIndex(expected.media, 2);

    equal(changes, 1, 'emitted "change"');
    equal(requests[0].aborted, true, 'XHR aborted');
    equal(requests.length, 1, 'waits before continuing');

    segmentLoader.fetch();
    equal(requests.length, 2, 'opened new XHR');
  });

  test('when outstanding XHRs are cancelled, they get aborted properly', function() {
    var readystatechanges = 0;
    segmentLoader.load(expected.media);
    segmentLoader.fetch();

    segmentLoader.xhr_.onreadystatechange = function() {
      readystatechanges++;
    };

    // attempt to seek while the download is in progress
    segmentLoader.mediaIndex(expected.media, 1);
    ok(requests[0].aborted, 'XHR aborted');

    segmentLoader.fetch();
    equal(requests.length, 2, 'opened new XHR');
    notEqual(segmentLoader.xhr_.url, requests[0].url, 'a new segment is request that is not the aborted one');
    equal(readystatechanges, 0, 'onreadystatechange was not called');
  });

  test('an outstanding segment request is properly disposed', function() {
    var readystatechanges = 0;

    segmentLoader.load(expected.media);
    segmentLoader.fetch();
    segmentLoader.xhr_.onreadystatechange = function() {
      readystatechanges++;
    };

    segmentLoader.dispose();
    ok(requests[0].aborted, 'XHR aborted');
    equal(requests.length, 1, 'did not open a new XHR');
    strictEqual(segmentLoader.xhr_, null, 'the segment xhr is nulled out');
    equal(readystatechanges, 0, 'onreadystatechange was not called');
  });

  test('a 404 response should trigger MEDIA_ERR_NETWORK', function () {
    var errors = [];
    segmentLoader.load(expected.media);
    segmentLoader.on('error', function(error) {
      errors.push(error);
    });

    segmentLoader.fetch();
    requests.shift().respond(404);
    equal(errors.length, 1, 'one error triggered');
    ok(segmentLoader.error.message, 'an error message is available');
    equal(segmentLoader.error.code, 2, 'code should be MEDIA_ERR_NETWORK');
  });

  test('a 500 response should trigger MEDIA_ERR_NETWORK', function () {
    var errors = [];
    segmentLoader.load(expected.media);
    segmentLoader.on('error', function(error) {
      errors.push(error);
    });

    segmentLoader.fetch();
    requests.shift().respond(500);
    equal(errors.length, 1, 'one error triggered');
    ok(segmentLoader.error.message, 'an error message is available');
    equal(segmentLoader.error.code, 4, 'code should be MEDIA_ERR_NETWORK');
  });

  test('updates the media index when a playlist is reloaded', function() {
    segmentLoader.load({
      mediaSequence: 100,
      segments: [{
        duration: 10,
        uri: '0.ts'
      }, {
        duration: 10,
        uri: '1.ts'
      }, {
        duration: 10,
        uri: '2.ts'
      }]
    });

    // fetch up to 2.ts
    segmentLoader.fetch();
    segmentResponse(requests.shift());
    segmentLoader.fetch();
    segmentResponse(requests.shift());
    segmentLoader.fetch();
    segmentResponse(requests.shift());
    segmentLoader.fetch();
    equal(segmentLoader.mediaIndex(),
          3,
          'fetched to the end of the initial playlist');

    // refresh the playlist
    segmentLoader.load({
      mediaSequence: 101,
      segments: [{
        duration: 10,
        uri: '1.ts'
      }, {
        duration: 10,
        uri: '2.ts'
      }, {
        duration: 10,
        uri: '3.ts'
      }]
    });
    equal(segmentLoader.mediaIndex(),
          2,
          'mediaIndex is updated after the reload');
  });

  test('mediaIndex is zero before the first segment loads', function() {
    segmentLoader.load({
      segments: [{
        duration: 10,
        uri: '0.ts'
      }]
    });

    equal(segmentLoader.mediaIndex(), 0, 'mediaIndex is zero');
  });

  test('if withCredentials global option is used, withCredentials is set on the XHR object', function() {
    segmentLoader.dispose();
    videojs.options.hls = {
      withCredentials: true
    };
    segmentLoader = new SegmentLoader();
    segmentLoader.load(expected.media);
    segmentLoader.fetch();

    equal(requests[0].withCredentials,
          true,
          'withCredentials should use the global default');
  });

  test('withCredentials can be set on construction', function() {
    segmentLoader.dispose();
    segmentLoader = new SegmentLoader({
      withCredentials: true
    });
    segmentLoader.load(expected.media);

    segmentLoader.fetch();
    equal(requests[0].withCredentials,
          true,
          'withCredentials should be set');
  });

  test('does not error when a playlist has no segments', function() {
    try {
      segmentLoader.load({
        segments: []
      });
    } catch(e) {
      ok(false, 'an error was thrown');
      throw e;
    }
    ok(true, 'no error was thrown');
    equal(requests.length, 0, 'no requests were made');
  });

  test('clears the buffer if mediaIndex is modified', function() {
    segmentLoader.load({
      discontinuityStarts: [1],
      endList: true,
      segments: [{
        duration: 10,
        uri: '1.ts'
      }, {
        discontinuity: true,
        duration: 10,
        uri: '2.ts'
      }]
    });
    segmentLoader.fetch();
    segmentResponse(requests.shift()); // 1.ts
    segmentLoader.fetch();
    segmentResponse(requests.shift()); // 2.ts
    equal(segmentLoader.length(), 2, 'buffered two segments');

    // seek back to the beginning
    segmentLoader.mediaIndex(0);
    equal(segmentLoader.length(), 0, 'cleared the segment buffer');
  });

  test('can change playlists and seek simultaneously', function() {
    var segment;
    segmentLoader.load(expected.media);
    segmentLoader.fetch();
    segmentResponse(requests.shift());
    segmentLoader.fetch();

    // change the playlist and seek
    segmentLoader.mediaIndex(expected.domainUris, 2, 0.5);
    ok(requests.shift().aborted, 'aborted the outstanding request');

    segmentLoader.fetch();
    segmentResponse(requests.shift());
    segment = segmentLoader.shift();
    deepEqual(segment.playlist, expected.domainUris, 'updated the playlist');
    equal(segment.mediaIndex, 2, 'updated media index');
    equal(segment.offset, 0.5, 'tracked the offset');
  });

  test('tracks the bytes downloaded', function() {
    segmentLoader.load(expected.media);
    equal(segmentLoader.bytesReceived, 0, 'no bytes received');

    // respond with some bytes
    segmentLoader.fetch();
    requests[0].response = new ArrayBuffer(17);
    requests.shift().respond(200, null, '');
    equal(segmentLoader.bytesReceived, 17, 'tracked bytes received');

    // respond with some more
    segmentLoader.fetch();
    requests[0].response = new ArrayBuffer(5);
    requests.shift().respond(200, null, '');
    equal(segmentLoader.bytesReceived, 22, 'tracked more bytes');
  });

  test('does not error with falsey playlists', function() {
    segmentLoader.load(null);
    equal(requests.length, 0, 'made no requests');
  });

  var segmentLoaders;

  module('Segment Multi-Loader', {
    beforeEach: function() {
      segmentLoaders = new SegmentMultiLoader();
      useTestEnvironment();
    },
    afterEach: function() {
      if (segmentLoaders) {
        segmentLoaders.dispose();
      }
      restoreEnvironment();
    }
  });

  test('can load from a single playlist', function() {
    segmentLoaders.addLoader();
    segmentLoaders.loader(0).load(expected.media);

    equal(requests.length, 1, 'began loading');
    segmentResponse(requests.shift());
    equal(segmentLoaders.loader(0).length(),
          1,
          'buffered a segment');
    ok(segmentLoaders.loader(0).shift(), 'the segment is available');

    segmentResponse(requests.shift());
    equal(segmentLoaders.loader(0).length(),
          1,
          'continued buffering');
    ok(segmentLoaders.loader(0).shift(), 'the segment is available');
  });

  test('can load from multiple playlists', function() {
    segmentLoaders.addLoader();
    segmentLoaders.addLoader();
    segmentLoaders.loader(0).load(expected.media);
    segmentLoaders.loader(1).load(expected.domainUris);

    equal(requests.length, 1, 'began loading');
    equal(requests[0].url,
          absoluteUrl(expected.media.segments[0].uri),
          'started on the first playlist');

    segmentResponse(requests.shift());
    equal(segmentLoaders.loader(0).length(),
          1,
          'buffered the first segment of the first playlist');

    equal(requests.length, 1, 'continued loading');
    equal(requests[0].url,
          window.location.protocol + '//' + window.location.host +
          expected.domainUris.segments[0].uri,
          'continued with the second playlist');

    segmentResponse(requests.shift());
    equal(segmentLoaders.loader(1).length(),
          1,
          'buffered the first segment of the second playlist');
  });

  test('pauses after one target duration is buffered', function() {
    segmentLoaders.addLoader();
    segmentLoaders.addLoader();
    segmentLoaders.loader(0).load(expected.media);
    segmentLoaders.loader(1).load(expected.domainUris);

    segmentResponse(requests.shift()); // media segment 0
    segmentResponse(requests.shift()); // domainUris segment 0

    equal(requests.length, 0, 'no outstanding requests');
  });

  test('resumes buffering when segments are shifted', function() {
    segmentLoaders.addLoader();
    segmentLoaders.addLoader();
    segmentLoaders.loader(0).load(expected.media);
    segmentLoaders.loader(1).load(expected.domainUris);

    segmentResponse(requests.shift()); // media segment 0
    segmentResponse(requests.shift()); // domainUris segment 0

    segmentLoaders.loader(1).shift(); // domainUris segment 0
    equal(requests.length, 1, 'restarted buffering');
    equal(requests[0].url,
          window.location.protocol + '//' + window.location.host +
          expected.domainUris.segments[1].uri,
          'resumed the second loader');

    segmentResponse(requests.shift()); // domainUris segment 1
    equal(requests.length, 0, 'paused buffering again');

    segmentLoaders.loader(0).shift(); // media segment 0
    equal(requests.length, 1, 'restarted buffering');
    equal(requests[0].url,
          absoluteUrl(expected.media.segments[1].uri),
          'resumed the first loader');
  });

  test('continues buffering after errors', function() {
    segmentLoaders.addLoader();
    segmentLoaders.loader(0).load(expected.media);

    requests.shift().respond(500);
    equal(requests.length, 1, 'issued a new request');

    requests[0].timedout = true;
    requests.shift().respond(0);
    equal(requests.length, 1, 'issued a new request');
  });

  test('passes along offsets when seeking', function() {
    segmentLoaders.addLoader();
    segmentLoaders.addLoader();
    segmentLoaders.loader(0).load(expected.media);
    segmentLoaders.loader(1).load(expected.domainUris);

    segmentLoaders.loader(0).mediaIndex(expected.media, 2, 7.5);
    segmentLoaders.loader(1).mediaIndex(expected.domainUris, 2, 5);
    equal(requests[0].aborted, true, 'aborted the first request');
    requests.shift();

    segmentResponse(requests.shift()); // media segment 2
    segmentResponse(requests.shift()); // domainUris segment 2

    equal(segmentLoaders.loader(0).shift().offset, 7.5, 'tracked first offset');
    equal(segmentLoaders.loader(1).shift().offset, 5, 'tracked second offset');
  });

  test('disposes all managed loaders', function() {
    var disposed = {};
    segmentLoaders.addLoader();
    segmentLoaders.addLoader();
    segmentLoaders.loader(0).dispose = function() {
      disposed[0] = true;
    };
    segmentLoaders.loader(1).dispose = function() {
      disposed[1] = true;
    };
    segmentLoaders.dispose();

    ok(disposed[0], 'disposed the first loader');
    ok(disposed[1], 'disposed the second loader');
  });

})(window, window.videojs);

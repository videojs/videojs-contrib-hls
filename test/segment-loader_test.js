/**
 * Test cases for segment-loader.js
 */
(function(window, videojs, undefined) {
  'use strict';

  var SegmentLoader = videojs.Hls.SegmentLoader,
      absoluteUrl = window.absoluteUrl,
      expected = window.expected;

  var segmentLoader, clock, xhr, requests, globalOptions;

  var segmentResponse = function(request) {
    request.response = new Uint8Array(16).buffer;
    request.respond(200,
                    { 'Content-Type': 'video/MP2T' },
                    null);
  };

  module('Segment Loader', {
    beforeEach: function() {
      segmentLoader = new SegmentLoader();

      globalOptions = videojs.options.hls;
      clock = sinon.useFakeTimers();
      xhr = sinon.useFakeXMLHttpRequest();
      requests = [];
      xhr.onCreate = function(xhr) {
        requests.push(xhr);
      };
    },
    afterEach: function() {
      if (segmentLoader) {
        segmentLoader.dispose();
      }
      videojs.options.hls = globalOptions;
      clock.restore();
      xhr.restore();
    }
  });

  test('can be constructed', function() {
    ok(segmentLoader, 'constructed a segment loader');
  });

  test('starts downloading segments when a playlist is provided', function() {
    segmentLoader.load({
      segments: [{
        uri: '0.ts'
      }, {
        uri: '1.ts'
      }]
    });

    equal(requests.length, 1, 'made a request');
    equal(requests[0].url,
          absoluteUrl('0.ts'),
          'the first segment is requested');
  });

  test('emits an event when a new segment finishes downloading', function() {
    var progress = 0;
    segmentLoader.on('progress', function() {
      progress++;
    });
    segmentLoader.load(expected.media);

    segmentResponse(requests.shift());
    equal(progress, 1, 'emitted one event');
  });

  test('recognizes absolute URIs and requests them unmodified', function() {
    segmentLoader.load(expected.absoluteUris);

    equal(requests.length, 1, 'made a request');
    strictEqual(requests[0].url,
                'http://example.com/00001.ts',
                'the URI is requested as-is');
  });

  test('recognizes domain-relative URLs', function() {
    segmentLoader.load(expected.domainUris);

    equal(requests.length, 1, 'made a request');
    equal(requests[0].url,
          window.location.protocol + '//' + window.location.host +
          '/00001.ts',
          'appended domain to the URI');
  });

  test('resolves relative URLs against a base URL', function() {
    segmentLoader.baseUrl('http://example.com');
    segmentLoader.load(expected.media);
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
    equal(requests[0].url,
          absoluteUrl('low/0.ts'),
          'requested the first segment of the original playlist');
    segmentResponse(requests[0]);

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
    equal(requests[2].url,
          absoluteUrl('high/1.ts'),
          'requested the second segment of the original playlist');
    equal(segmentLoader.mediaIndex(), 1, 'updated the mediaIndex');

    segmentResponse(requests[2]);
    equal(segmentLoader.length(), 3, 'buffered all the segments');
  });

  test('periodically fills the buffer', function() {
    segmentLoader.load(expected.media);
    equal(requests.length, 1, 'requested the first segment');
    segmentResponse(requests.shift());

    clock.tick(500);
    equal(requests.length, 1, 'requested the second segment');
    segmentResponse(requests.shift());

    clock.tick(500);
    equal(requests.length, 1, 'requested the third segment');
    segmentResponse(requests.shift());

    segmentLoader.dispose();
    clock.tick(100 * 1000);
    equal(requests.length, 0, 'did not make additional requests');
  });

  test('calculates the bandwidth after downloading a segment', function() {
    segmentLoader.load(expected.media);

    segmentResponse(requests[0]);

    // set the request time to be a bit earlier so our bandwidth
    // calculations are not NaN
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
    segmentResponse(requests.shift());

    equal(progressCount, 1, 'fired a progress event');
  });

  test('moves to the next segment if there is a network error', function() {
    var mediaIndex;
    segmentLoader.load(expected.media);

    segmentLoader.bandwidth = 20000;
    mediaIndex = segmentLoader.mediaIndex();

    requests.shift().respond(400);
    equal(mediaIndex + 1, segmentLoader.mediaIndex(), 'media index is incremented');
  });

  test('does not download the next segment if the buffer is full', function() {
    segmentLoader.load(expected.media);
    while (segmentLoader.bufferedSeconds() < videojs.Hls.GOAL_BUFFER_LENGTH) {
      segmentResponse(requests.shift());
    }

    equal(requests.length, 0, 'no outstanding requests');
    clock.tick(10 * 1000);
    equal(requests.length, 0, 'no outstanding requests');
  });

  test('downloads the next segment if the buffer is getting low', function() {
    segmentLoader.load(expected.media);

    // fill the buffer
    while (segmentLoader.bufferedSeconds() < videojs.Hls.GOAL_BUFFER_LENGTH) {
      segmentResponse(requests.shift());
    }

    // remove a segment so the buffer is no longer full
    segmentLoader.shift();
    equal(requests.length, 1, 'made a request');
  });

  test('stops downloading once the playlist is finished', function() {
    var i;
    segmentLoader.load(expected.media);

    for (i = 0; i < expected.media.segments.length; i++) {
      // download and drain all the segments
      segmentResponse(requests.shift());
      segmentLoader.shift();
    }
    equal(requests.length, 0, 'no outstanding requests');
    clock.tick(10 * 1000);
    equal(requests.length, 0, 'no outstanding requests');
  });

  test('only makes one segment request at a time', function() {
    segmentLoader.load(expected.media);

    equal(requests.length, 1, 'made a request');
    clock.tick(10 * 1000);
    equal(requests.length, 1, 'did not make additional requests');
  });

  test('the next segment can be viewed without removing it', function() {
    segmentLoader.load(expected.media);
    strictEqual(segmentLoader.peek(), undefined, 'is undefined with an empty buffer');

    segmentResponse(requests.shift());
    ok(segmentLoader.peek(), 'is available when a segment is ready');
    deepEqual(segmentLoader.peek(), segmentLoader.shift(), 'is the first segment');
  });

  test('cancels outstanding requests when seeking', function() {
    segmentLoader.load(expected.media);

    // attempt to seek while the download is in progress
    segmentLoader.mediaIndex(expected.media, 2);

    equal(requests[0].aborted, true, 'XHR aborted');
    equal(requests.length, 2, 'opened new XHR');
  });

  test('when outstanding XHRs are cancelled, they get aborted properly', function() {
    var readystatechanges = 0;
    segmentLoader.load(expected.media);

    segmentLoader.xhr_.onreadystatechange = function() {
      readystatechanges++;
    };

    // attempt to seek while the download is in progress
    segmentLoader.mediaIndex(expected.media, 1);

    ok(requests[0].aborted, 'XHR aborted');
    equal(requests.length, 2, 'opened new XHR');
    notEqual(segmentLoader.xhr_.url, requests[0].url, 'a new segment is request that is not the aborted one');
    equal(readystatechanges, 0, 'onreadystatechange was not called');
  });

  test('an outstanding segment request is properly disposed', function() {
    var readystatechanges = 0;

    segmentLoader.load(expected.media);
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
    segmentResponse(requests.shift());
    segmentResponse(requests.shift());
    segmentResponse(requests.shift());
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
    segmentResponse(requests.shift()); // 1.ts
    segmentResponse(requests.shift()); // 2.ts
    equal(segmentLoader.length(), 2, 'buffered two segments');

    // seek back to the beginning
    segmentLoader.mediaIndex(0);
    equal(segmentLoader.length(), 0, 'cleared the segment buffer');
  });

  test('can change playlists and seek simultaneously', function() {
    var segment;
    segmentLoader.load(expected.media);
    segmentResponse(requests.shift());

    // change the playlist and seek
    segmentLoader.mediaIndex(expected.domainUris, 2, 0.5);
    ok(requests.shift().aborted, 'aborted the outstanding request');

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
    requests[0].response = new ArrayBuffer(17);
    requests.shift().respond(200, null, '');
    equal(segmentLoader.bytesReceived, 17, 'tracked bytes received');

    // respond with some more
    requests[0].response = new ArrayBuffer(5);
    requests.shift().respond(200, null, '');
    equal(segmentLoader.bytesReceived, 22, 'tracked more bytes');
  });

  test('does not error with falsey playlists', function() {
    segmentLoader.load(null);
    equal(requests.length, 0, 'made no requests');
  });

})(window, window.videojs);

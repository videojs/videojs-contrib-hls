import QUnit from 'qunit';
import {mediaSegmentRequest, REQUEST_ERRORS} from '../src/media-segment-request';
import xhrFactory from '../src/xhr';
import {useFakeEnvironment} from './test-helpers';
import Decrypter from '../src/decrypter-worker';
import worker from 'webworkify';

QUnit.module('Media Segment Request', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.xhr = xhrFactory();
    this.realDecrypter = worker(Decrypter);
    this.mockDecrypter = {
      listeners: [],
      postMessage(message) {
        const newMessage = Object.create(message);

        newMessage.decrypted = message.encrypted;
        this.listeners.forEach((fn)=>fn({
          data: newMessage
        }));
      },
      addEventListener(event, listener) {
        this.listeners.push(listener);
      },
      removeEventListener(event, listener) {
        this.listeners = this.listeners.filter((fn)=>fn !== listener);
      }
    };
    this.xhrOptions = {
      timeout: 1000
    };
    this.noop = () => {};
  },
  afterEach(assert) {
    this.realDecrypter.terminate();
    this.env.restore();
  }
});

QUnit.test('cancels outstanding segment request on abort', function(assert) {
  const done = assert.async();

  assert.expect(7);

  const abort = mediaSegmentRequest(
    this.xhr,
    this.xhrOptions,
    this.noop,
    { resolvedUri: '0-test.ts' },
    this.noop,
    (errors, segmentData) => {
      assert.equal(this.requests.length, 1, 'there is only one request');
      assert.equal(this.requests[0].uri, '0-test.ts', 'the request is for a segment');
      assert.ok(this.requests[0].aborted, 'aborted the first request');
      assert.equal(errors.length, 1, 'there is one error');
      assert.equal(errors[0].code, REQUEST_ERRORS.ABORTED, 'request was aborted');

      done();
    });

  abort();
});

QUnit.test('cancels outstanding key requests on abort', function(assert) {
  let keyReq;
  const done = assert.async();

  assert.expect(8);

  const abort = mediaSegmentRequest(
    this.xhr,
    this.xhrOptions,
    this.noop,
    {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php'
      }
    },
    this.noop,
    (errors, segmentData) => {
      assert.ok(keyReq.aborted, 'aborted the key request');
      assert.equal(errors.length, 1, 'there is one error');
      assert.equal(errors[0].code, REQUEST_ERRORS.ABORTED, 'key request was aborted');

      done();
    });

  assert.equal(this.requests.length, 2, 'there are two requests');

  keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  // Fulfill the segment request
  segmentReq.response = new Uint8Array(10).buffer;
  segmentReq.respond(200, null, '');

  abort();
});

QUnit.test('cancels outstanding key requests on failure', function(assert) {
  let keyReq;
  const done = assert.async();

  assert.expect(9);
  mediaSegmentRequest(
    this.xhr,
    this.xhrOptions,
    this.noop,
    {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php'
      }
    },
    this.noop,
    (errors, segmentData) => {
      assert.ok(keyReq.aborted, 'aborted the key request');
      assert.equal(errors.length, 2, 'there are two errors');
      assert.equal(errors[0].code, REQUEST_ERRORS.FAILURE, 'segment request failed');
      assert.equal(errors[1].code, REQUEST_ERRORS.ABORTED, 'key request was aborted');

      done();
    });

  assert.equal(this.requests.length, 2, 'there are two requests');

  keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  // Fulfill the segment request
  segmentReq.respond(500, null, '');
});

QUnit.test('cancels outstanding key requests on timeout', function(assert) {
  let keyReq;
  const done = assert.async();

  assert.expect(9);
  mediaSegmentRequest(
    this.xhr,
    this.xhrOptions,
    this.noop,
    {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php'
      }
    },
    this.noop,
    (errors, segmentData) => {
      assert.ok(keyReq.aborted, 'aborted the key request');
      assert.equal(errors.length, 2, 'there are two errors');
      assert.equal(errors[0].code, REQUEST_ERRORS.TIMEOUT, 'key request failed');
      assert.equal(errors[1].code, REQUEST_ERRORS.ABORTED, 'segment request was aborted');

      done();
    });
  assert.equal(this.requests.length, 2, 'there are two requests');

  keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  keyReq.timedout = true;
  // Timeout request
  this.clock.tick(2000);
});

QUnit.test('the key response is converted to the correct format', function(assert) {
  let keyReq;
  const done = assert.async();
  const postMessage = this.mockDecrypter.postMessage;

  assert.expect(9);
  this.mockDecrypter.postMessage = (message) => {
    const key = new Uint32Array(message.key.bytes,
      message.key.byteOffset,
      message.key.byteLength / 4);

    assert.deepEqual(key,
                     new Uint32Array([0, 0x01000000, 0x02000000, 0x03000000]),
                     'passed the specified segment key');
    postMessage.call(this.mockDecrypter, message);
  };

  mediaSegmentRequest(
    this.xhr,
    this.xhrOptions,
    this.mockDecrypter,
    {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php',
        IV: [0, 0, 0, 1]
      }
    },
    this.noop,
    (errors, segmentData) => {
      assert.equal(errors, null, 'there are no errors');
      assert.equal(this.mockDecrypter.listeners.length, 0, 'all decryption webworker listeners are unbound');
      // verify stats
      assert.equal(segmentData.stats.bytesReceived, 10, '10 bytes');
      done();
    });

  assert.equal(this.requests.length, 2, 'there are two requests');

  keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  segmentReq.response = new Uint8Array(10).buffer;
  segmentReq.respond(200, null, '');
  keyReq.response = new Uint32Array([0, 1, 2, 3]).buffer;
  keyReq.respond(200, null, '');
});

QUnit.test('segment with key has bytes decrypted', function(assert) {
  const done = assert.async();

  assert.expect(8);
  mediaSegmentRequest(
    this.xhr,
    this.xhrOptions,
    this.realDecrypter,
    {
      resolvedUri: '0-test.ts',
      key: {
        resolvedUri: '0-key.php',
        iv: {
          bytes: new Uint32Array([0, 0, 0, 1])
        }
      }
    },
    this.noop,
    (errors, segmentData) => {
      assert.equal(errors, null, 'there are no errors');

      assert.ok(segmentData.bytes, 'decrypted bytes in segment');

      // verify stats
      assert.equal(segmentData.stats.bytesReceived, 8, '8 bytes');
      done();
    });

  assert.equal(this.requests.length, 2, 'there are two requests');

  const keyReq = this.requests.shift();
  const segmentReq = this.requests.shift();

  assert.equal(keyReq.uri, '0-key.php', 'the first request is for a key');
  assert.equal(segmentReq.uri, '0-test.ts', 'the second request is for a segment');

  segmentReq.response = new Uint8Array(8).buffer;
  segmentReq.respond(200, null, '');
  keyReq.response = new Uint32Array([0, 1, 2, 3]).buffer;
  keyReq.respond(200, null, '');

  // Allow the decrypter to decrypt
  this.clock.tick(1);
  // Allow the decrypter's async stream to run the callback
  this.clock.tick(1);
});

(function(window, videojs) {
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
  mp4 = videojs.mp4,
  inspectMp4 = videojs.inspectMp4;

module('MP4 Generator');

test('generates a BSMFF ftyp', function() {
  var data = mp4.ftyp(), boxes;

  ok(data, 'box is not null');

  boxes = inspectMp4(data);
  equal(1, boxes.length, 'generated a single box');
  equal(boxes[0].type, 'ftyp', 'generated ftyp type');
  equal(boxes[0].size, data.byteLength, 'generated size');
  equal(boxes[0].majorBrand, 'isom', 'major version is "isom"');
  equal(boxes[0].minorVersion, 1, 'minor version is one');
});

test('generates a moov', function() {
  var boxes, mvhd, tkhd, mdhd, hdlr, minf, mvex,
    data = mp4.moov(100, 600, 300);

  ok(data, 'box is not null');

  boxes = inspectMp4(data);
  equal(boxes.length, 1, 'generated a single box');
  equal(boxes[0].type, 'moov', 'generated a moov type');
  equal(boxes[0].size, data.byteLength, 'generated size');
  equal(boxes[0].boxes.length, 3, 'generated three sub boxes');

  mvhd = boxes[0].boxes[0];
  equal(mvhd.type, 'mvhd', 'generated a mvhd');
  equal(mvhd.duration, 100, 'wrote the movie header duration');

  equal(boxes[0].boxes[1].type, 'trak', 'generated a trak');
  equal(boxes[0].boxes[1].boxes.length, 2, 'generated two track sub boxes');
  tkhd = boxes[0].boxes[1].boxes[0];
  equal(tkhd.type, 'tkhd', 'generated a tkhd');
  equal(tkhd.duration, 100, 'wrote duration into the track header');
  equal(tkhd.width, 600, 'wrote width into the track header');
  equal(tkhd.height, 300, 'wrote height into the track header');

  equal(boxes[0].boxes[1].boxes[1].type, 'mdia', 'generated an mdia type');
  equal(boxes[0].boxes[1].boxes[1].boxes.length, 3, 'generated three track media sub boxes');

  mdhd = boxes[0].boxes[1].boxes[1].boxes[0];
  equal(mdhd.type, 'mdhd', 'generate an mdhd type');
  equal(mdhd.language, 'und', 'wrote undetermined language');
  equal(mdhd.duration, 100, 'wrote duraiton into the media header');

  hdlr = boxes[0].boxes[1].boxes[1].boxes[1];
  equal(hdlr.type, 'hdlr', 'generate an hdlr type');
  equal(hdlr.handlerType, 'vide', 'wrote a video handler');
  equal(hdlr.name, 'VideoHandler', 'wrote the handler name');

  minf = boxes[0].boxes[1].boxes[1].boxes[2];
  equal(minf.type, 'minf', 'generate an minf type');
  equal(minf.boxes.length, 2, 'generates two minf sub boxes');
  deepEqual({
    type: 'dinf',
    size: 24,
    boxes: [{
      type: 'dref',
      size: 16,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      dataReferences: []
    }]
  }, minf.boxes[0], 'generates a dinf');

  equal(minf.boxes[1].type, 'stbl', 'generates an stbl type');
  deepEqual({
    type: 'stbl',
    size: 134,
    boxes: [{
      type: 'stsd',
      size: 102,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      sampleDescriptions: [{
        dataReferenceIndex: 1,
        width: 600,
        height: 300,
        horizresolution: 72,
        vertresolution: 72,
        frameCount: 1,
        depth: 24,
        size: 86,
        type: 'avc1'
      }]
    }, {
      type: 'stts',
      size: 8,
      timeToSamples: []
    }, {
      type: 'stsc',
      size: 8,
      sampleToChunks: []
    }, {
      type: 'stco',
      size: 8,
      chunkOffsets: []
    }]
  }, minf.boxes[1], 'generates a stbl');


  mvex = boxes[0].boxes[2];
  equal(mvex.type, 'mvex', 'generates an mvex type');
  deepEqual({
    type: 'mvex',
    size: 40,
    boxes: [{
      type: 'trex',
      size: 32,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      trackId: 1,
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 0,
      defaultSampleSize: 0,
      sampleDependsOn: 0,
      sampleIsDependedOn: 0,
      sampleHasRedundancy: 0,
      samplePaddingValue: 0,
      sampleIsDifferenceSample: true,
      sampleDegradationPriority: 1
    }]
  }, mvex, 'writes a movie extends box');
});

test('generates an initialization segment', function() {
  var
    data = mp4.initSegment(),
    init;

  init = videojs.inspectMp4(data);
  equal(init.length, 2, 'generated two boxes');
  equal(init[0].type, 'ftyp', 'generated a ftyp box');
  equal(init[1].type, 'moov', 'generated a moov box');
});


})(window, window.videojs);

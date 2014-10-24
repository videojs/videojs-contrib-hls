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
    data = mp4.moov([{
      id: 7,
      duration: 100,
      width: 600,
      height: 300,
      type: 'video'
    }]);

  ok(data, 'box is not null');

  boxes = inspectMp4(data);
  equal(boxes.length, 1, 'generated a single box');
  equal(boxes[0].type, 'moov', 'generated a moov type');
  equal(boxes[0].size, data.byteLength, 'generated size');
  equal(boxes[0].boxes.length, 3, 'generated three sub boxes');

  mvhd = boxes[0].boxes[0];
  equal(mvhd.type, 'mvhd', 'generated a mvhd');
  equal(mvhd.duration, 0xffffffff, 'wrote the maximum movie header duration');

  equal(boxes[0].boxes[1].type, 'trak', 'generated a trak');
  equal(boxes[0].boxes[1].boxes.length, 2, 'generated two track sub boxes');
  tkhd = boxes[0].boxes[1].boxes[0];
  equal(tkhd.type, 'tkhd', 'generated a tkhd');
  equal(tkhd.trackId, 7, 'wrote the track id');
  equal(tkhd.duration, 100, 'wrote duration into the track header');
  equal(tkhd.width, 600, 'wrote width into the track header');
  equal(tkhd.height, 300, 'wrote height into the track header');

  equal(boxes[0].boxes[1].boxes[1].type, 'mdia', 'generated an mdia type');
  equal(boxes[0].boxes[1].boxes[1].boxes.length, 3, 'generated three track media sub boxes');

  mdhd = boxes[0].boxes[1].boxes[1].boxes[0];
  equal(mdhd.type, 'mdhd', 'generate an mdhd type');
  equal(mdhd.language, 'und', 'wrote undetermined language');
  equal(mdhd.duration, 100, 'wrote duration into the media header');

  hdlr = boxes[0].boxes[1].boxes[1].boxes[1];
  equal(hdlr.type, 'hdlr', 'generate an hdlr type');
  equal(hdlr.handlerType, 'vide', 'wrote a video handler');
  equal(hdlr.name, 'VideoHandler', 'wrote the handler name');

  minf = boxes[0].boxes[1].boxes[1].boxes[2];
  equal(minf.type, 'minf', 'generate an minf type');
  equal(minf.boxes.length, 3, 'generates three minf sub boxes');

  equal(minf.boxes[0].type, 'vmhd', 'generates a vmhd type');
  deepEqual({
    type: 'vmhd',
    size: 20,
    version: 0,
    flags: new Uint8Array([0, 0, 1]),
    graphicsmode: 0,
    opcolor: new Uint16Array([0, 0, 0])
  }, minf.boxes[0], 'generates a vhmd');

  equal(minf.boxes[1].type, 'dinf', 'generates a dinf type');
  deepEqual({
    type: 'dinf',
    size: 36,
    boxes: [{
      type: 'dref',
      size: 28,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      dataReferences: [{
        type: 'url ',
        size: 12,
        version: 0,
        flags: new Uint8Array([0, 0, 1])
      }]
    }]
  }, minf.boxes[1], 'generates a dinf');

  equal(minf.boxes[2].type, 'stbl', 'generates an stbl type');
  deepEqual({
    type: 'stbl',
    size: 233,
    boxes: [{
      type: 'stsd',
      size: 157,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      sampleDescriptions: [{
        type: 'avc1',
        size: 141,
        dataReferenceIndex: 1,
        width: 600,
        height: 300,
        horizresolution: 72,
        vertresolution: 72,
        frameCount: 1,
        depth: 24,
        config: [{
          type: 'avcC',
          size: 35,
          configurationVersion: 1,
          avcProfileIndication: 0x4d,
          profileCompatibility: 0x40,
          avcLevelIndication: 0x20,
          lengthSizeMinusOne: 3,
          sps: [new Uint8Array([
            0x67, 0x4d, 0x40, 0x20,
            0x96, 0x52, 0x80, 0xa0,
            0x0b, 0x76, 0x02, 0x05
          ])],
          pps: [new Uint8Array([
            0x68, 0xef, 0x38, 0x80
          ])]
        }, {
          type: 'btrt',
          size: 20,
          bufferSizeDB: 1875072,
          maxBitrate: 3000000,
          avgBitrate: 3000000
        }]
      }]
    }, {
      type: 'stts',
      size: 16,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      timeToSamples: []
    }, {
      type: 'stsc',
      size: 16,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      sampleToChunks: []
    }, {
      type: 'stsz',
      version: 0,
      size: 20,
      flags: new Uint8Array([0, 0, 0]),
      sampleSize: 0,
      entries: []
    }, {
      type: 'stco',
      size: 16,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      chunkOffsets: []
    }]
  }, minf.boxes[2], 'generates a stbl');


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

test('generates a sound hdlr', function() {
  var boxes, hdlr,
    data = mp4.moov([{
      duration:100,
      width: 600,
      height: 300,
      type: 'audio'
    }]);

  ok(data, 'box is not null');

  boxes = inspectMp4(data);

  hdlr = boxes[0].boxes[1].boxes[1].boxes[1];
  equal(hdlr.type, 'hdlr', 'generate an hdlr type');
  equal(hdlr.handlerType, 'soun', 'wrote a sound handler');
  equal(hdlr.name, 'SoundHandler', 'wrote the handler name');
});

test('generates a video hdlr', function() {
  var boxes, hdlr,
    data = mp4.moov([{
      duration: 100,
      width: 600,
      height: 300,
      type: 'video'
    }]);

  ok(data, 'box is not null');

  boxes = inspectMp4(data);

  hdlr = boxes[0].boxes[1].boxes[1].boxes[1];
  equal(hdlr.type, 'hdlr', 'generate an hdlr type');
  equal(hdlr.handlerType, 'vide', 'wrote a video handler');
  equal(hdlr.name, 'VideoHandler', 'wrote the handler name');
});

test('generates an initialization segment', function() {
  var
    data = mp4.initSegment([{
      id: 1,
      width: 600,
      height: 300,
      type: 'video'
    }, {
      id: 2,
      type: 'audio'
    }]),
    init, mvhd, trak1, trak2, mvex;

  init = videojs.inspectMp4(data);
  equal(init.length, 2, 'generated two boxes');
  equal(init[0].type, 'ftyp', 'generated a ftyp box');
  equal(init[1].type, 'moov', 'generated a moov box');
  equal(init[1].boxes[0].duration, 0xffffffff, 'wrote a maximum duration');

  mvhd = init[1].boxes[0];
  equal(mvhd.type, 'mvhd', 'wrote an mvhd');

  trak1 = init[1].boxes[1];
  equal(trak1.type, 'trak', 'wrote a trak');
  equal(trak1.boxes[0].trackId, 1, 'wrote the first track id');
  equal(trak1.boxes[0].width, 600, 'wrote the first track width');
  equal(trak1.boxes[0].height, 300, 'wrote the first track height');
  equal(trak1.boxes[1].boxes[1].handlerType, 'vide', 'wrote the first track type');

  trak2 = init[1].boxes[2];
  equal(trak2.type, 'trak', 'wrote a trak');
  equal(trak2.boxes[0].trackId, 2, 'wrote the second track id');
  equal(trak2.boxes[1].boxes[1].handlerType, 'soun', 'wrote the second track type');

  mvex = init[1].boxes[3];
  equal(mvex.type, 'mvex', 'wrote an mvex');
});

test('generates a minimal moof', function() {
  var
    data = mp4.moof(7, [{
      trackId: 1
    }, {
      trackId: 2
    }]),
    moof = videojs.inspectMp4(data);

  equal(moof.length, 1, 'generated one box');
  equal(moof[0].type, 'moof', 'generated a moof box');
  equal(moof[0].boxes.length, 2, 'generated two child boxes');
  equal(moof[0].boxes[0].type, 'mfhd', 'generated an mfhd box');
  equal(moof[0].boxes[0].sequenceNumber, 7, 'included the sequence_number');
  equal(moof[0].boxes[1].type, 'traf', 'generated a traf box');
  equal(moof[0].boxes[1].boxes.length, 2, 'generated two fragment headers');
  equal(moof[0].boxes[1].boxes[0].type, 'tfhd', 'generated a tfhd box');
  equal(moof[0].boxes[1].boxes[0].trackId, 1, 'wrote the first track id');
  equal(moof[0].boxes[1].boxes[1].trackId, 2, 'wrote the second track id');
});

test('generates an mdat', function() {
  var
    data = mp4.mdat(new Uint8Array([1, 2, 3, 4])),
    mdat = videojs.inspectMp4(data);

  equal(mdat.length, 1, 'generated one box');
  equal(mdat[0].type, 'mdat', 'generated an mdat box');
  deepEqual(mdat[0].byteLength, 4, 'encapsulated the data');
});

})(window, window.videojs);

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
  Uint8Array = window.Uint8Array,
  typeBytes = function(type) {
    return [
      type.charCodeAt(0),
      type.charCodeAt(1),
      type.charCodeAt(2),
      type.charCodeAt(3)
    ];
  },
  box = function(type) {
    var
      array = Array.prototype.slice.call(arguments, 1),
      result = [],
      size,
      i;

    // "unwrap" any arrays that were passed as arguments
    // e.g. box('etc', 1, [2, 3], 4) -> box('etc', 1, 2, 3, 4)
    for (i = 0; i < array.length; i++) {
      if (array[i] instanceof Array) {
        array.splice.apply(array, [i, 1].concat(array[i]));
      }
    }

    size = 8 + array.length;

    result[0] = (size & 0xFF000000) >> 24;
    result[1] = (size & 0x00FF0000) >> 16;
    result[2] = (size & 0x0000FF00) >> 8;
    result[3] = size & 0xFF;
    result = result.concat(typeBytes(type));
    result = result.concat(array);
    return result;
  },
  unityMatrix = [
    0, 0, 0x10, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,

    0, 0, 0, 0,
    0, 0, 0x10, 0,
    0, 0, 0, 0,

    0, 0, 0, 0,
    0, 0, 0, 0,
    0x40, 0, 0, 0
  ],

  mvhd0 = box('mvhd',
             0x00, // version 0
             0x00, 0x00, 0x00, // flags
             0x00, 0x00, 0x00, 0x01, // creation_time
             0x00, 0x00, 0x00, 0x02, // modification_time
             0x00, 0x00, 0x00, 0x3c, // timescale
             0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
             0x00, 0x01, 0x00, 0x00, // 1.0 rate
             0x01, 0x00, // 1.0 volume
             0x00, 0x00, // reserved
             0x00, 0x00, 0x00, 0x00, // reserved
             0x00, 0x00, 0x00, 0x00, // reserved
             unityMatrix,
             0x00, 0x00, 0x00, 0x00,
             0x00, 0x00, 0x00, 0x00,
             0x00, 0x00, 0x00, 0x00,
             0x00, 0x00, 0x00, 0x00,
             0x00, 0x00, 0x00, 0x00,
             0x00, 0x00, 0x00, 0x00, // pre_defined
             0x00, 0x00, 0x00, 0x02),

  tkhd0 = box('tkhd',
              0x00, // version 0
              0x00, 0x00, 0x00, // flags
              0x00, 0x00, 0x00, 0x02, // creation_time
              0x00, 0x00, 0x00, 0x03, // modification_time
              0x00, 0x00, 0x00, 0x01, // track_ID
              0x00, 0x00, 0x00, 0x00, // reserved
              0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
              0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00, // reserved
              0x00, 0x00, // layer
              0x00, 0x00, // alternate_group
              0x00, 0x00, // non-audio track volume
              0x00, 0x00, // reserved
              unityMatrix,
              0x01, 0x2c, 0x00, 0x00, // 300 in 16.16 fixed point
              0x00, 0x96, 0x00, 0x00), // 150 in 16.16 fixed point
  mdhd0 = box('mdhd',
              0x00, // version 0
              0x00, 0x00, 0x00, // flags
              0x00, 0x00, 0x00, 0x02, // creation_time
              0x00, 0x00, 0x00, 0x03, // modification_time
              0x00, 0x00, 0x00, 0x3c, // timescale
              0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
              0x15, 0xc7, // 'eng' language
              0x00, 0x00);

module('MP4 Inspector');

test('produces an empty array for empty input', function() {
  strictEqual(videojs.inspectMp4(new Uint8Array([])).length, 0, 'returned an empty array');
});

test('can parse a Box', function() {
  var box = new Uint8Array([
    0x00, 0x00, 0x00, 0x00, // size 0
    0x00, 0x00, 0x00, 0x00 // boxtype 0
  ]);
  deepEqual(videojs.inspectMp4(box), [{
    type: '\u0000\u0000\u0000\u0000',
    size: 0,
    data: box.subarray(box.byteLength)
  }], 'parsed a Box');
});

test('can parse an ftyp', function() {
  deepEqual(videojs.inspectMp4(new Uint8Array(box('ftyp',
    0x61, 0x76, 0x63, 0x31, // major brand
    0x00, 0x00, 0x00, 0x02, // minor version
    0x00, 0x00, 0x00, 0x03, // compatible brands
    0x00, 0x00, 0x00, 0x04 // compatible brands
  ))), [{
    type: 'ftyp',
    size: 4 * 6,
    majorBrand: 'avc1',
    minorVersion: 2,
    compatibleBrands: [3, 4]
  }], 'parsed an ftyp');
});

test('can parse a pdin', function() {
  deepEqual(videojs.inspectMp4(new Uint8Array(box('pdin',
    0x01, // version 1
    0x01, 0x02, 0x03, // flags
    0x00, 0x00, 0x04, 0x00, // 1024 = 0x400 bytes/second rate
    0x00, 0x00, 0x00, 0x01 // initial delay
  ))), [{
    size: 20,
    type: 'pdin',
    version: 1,
    flags: new Uint8Array([1, 2, 3]),
    rate: 1024,
    initialDelay: 1
  }], 'parsed a pdin');
});

test('can parse an mdat', function() {
  var mdat = new Uint8Array(box('mdat',
      0x01, 0x02, 0x03, 0x04 // data
    ));
  deepEqual(videojs.inspectMp4(mdat), [{
      size: 12,
      type: 'mdat',
      byteLength: 4
    }], 'parsed an mdat');
});

test('can parse a free or skip', function() {
  var
    free = new Uint8Array(box('free',
                              0x01, 0x02, 0x03, 0x04)), // data
    skip = new Uint8Array(box('skip',
                              0x01, 0x02, 0x03, 0x04)); // data

  deepEqual(videojs.inspectMp4(free), [{
      size: 12,
      type: 'free',
      data: free.subarray(free.byteLength - 4)
    }], 'parsed a free');
  deepEqual(videojs.inspectMp4(skip), [{
      size: 12,
      type: 'skip',
      data: skip.subarray(skip.byteLength - 4)
    }], 'parsed a skip');
});

test('can parse a version 0 mvhd', function() {
  deepEqual(videojs.inspectMp4(new Uint8Array(mvhd0)), [{
    type: 'mvhd',
    version: 0,
    flags: new Uint8Array([0, 0, 0]),
    creationTime: new Date(1000 - 2082844800000),
    modificationTime: new Date(2000 - 2082844800000),
    timescale: 60,
    duration: 600,
    rate: 1,
    volume: 1,
    matrix: new Uint32Array(unityMatrix),
    size: 108,
    nextTrackId: 2
  }]);
});

test('can parse a version 0 tkhd', function() {
  deepEqual(videojs.inspectMp4(new Uint8Array(tkhd0)), [{
    type: 'tkhd',
    version: 0,
    flags: new Uint8Array([0, 0, 0]),
    creationTime: new Date(2000 - 2082844800000),
    modificationTime: new Date(3000 - 2082844800000),
    size: 92,
    trackId: 1,
    duration: 600,
    layer: 0,
    alternateGroup: 0,
    volume: 0,
    matrix: new Uint32Array(unityMatrix),
    width: 300,
    height: 150
  }]);
});

test('can parse a version 0 mdhd', function() {
  deepEqual(videojs.inspectMp4(new Uint8Array(mdhd0)), [{
    type: 'mdhd',
    version: 0,
    flags: new Uint8Array([0, 0, 0]),
    creationTime: new Date(2000 - 2082844800000),
    modificationTime: new Date(3000 - 2082844800000),
    size: 32,
    timescale: 60,
    duration: 600,
    language: 'eng'
  }]);
});

test('can parse a moov', function() {
  var data =
    box('moov',
        box('mvhd',
            0x01, // version 1
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x01, // creation_time
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x02, // modification_time
            0x00, 0x00, 0x00, 0x3c, // timescale
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
            0x00, 0x01, 0x00, 0x00, // 1.0 rate
            0x01, 0x00, // 1.0 volume
            0x00, 0x00, // reserved
            0x00, 0x00, 0x00, 0x00, // reserved
            0x00, 0x00, 0x00, 0x00, // reserved
            unityMatrix,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, // pre_defined
            0x00, 0x00, 0x00, 0x02), // next_track_ID
        box('trak',
            box('tkhd',
                0x01, // version 1
                0x00, 0x00, 0x00, // flags
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x02, // creation_time
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x03, // modification_time
                0x00, 0x00, 0x00, 0x01, // track_ID
                0x00, 0x00, 0x00, 0x00, // reserved
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, // reserved
                0x00, 0x00, // layer
                0x00, 0x00, // alternate_group
                0x00, 0x00, // non-audio track volume
                0x00, 0x00, // reserved
                unityMatrix,
                0x01, 0x2c, 0x00, 0x00, // 300 in 16.16 fixed-point
                0x00, 0x96, 0x00, 0x00), // 150 in 16.16 fixed-point
            box('mdia',
                box('mdhd',
                    0x01, // version 1
                    0x00, 0x00, 0x00, // flags
                    0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x02, // creation_time
                    0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x03, // modification_time
                    0x00, 0x00, 0x00, 0x3c, // timescale
                    0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
                    0x15, 0xc7, // 'eng' language
                    0x00, 0x00),
                box('hdlr',
                    0x01, // version 1
                    0x00, 0x00, 0x00, // flags
                    0x00, 0x00, 0x00, 0x00, // pre_defined
                    typeBytes('vide'), // handler_type
                    0x00, 0x00, 0x00, 0x00, // reserved
                    0x00, 0x00, 0x00, 0x00, // reserved
                    0x00, 0x00, 0x00, 0x00, // reserved
                    typeBytes('one'), 0x00), // name
                box('minf',
                    box('dinf',
                        box('dref',
                            0x01, // version 1
                            0x00, 0x00, 0x00, // flags
                            0x00, 0x00, 0x00, 0x01, // entry_count
                            box('url ',
                            0x00, // version
                            0x00, 0x00, 0x01))), // flags
                    box('stbl',
                        box('stsd',
                            0x01, // version 1
                            0x00, 0x00, 0x00, // flags
                            0x00, 0x00, 0x00, 0x00), // entry_count
                        box('stts',
                            0x01, // version 1
                            0x00, 0x00, 0x00, // flags
                            0x00, 0x00, 0x00, 0x01, // entry_count
                            0x00, 0x00, 0x00, 0x01, // sample_count
                            0x00, 0x00, 0x00, 0x01), // sample_delta
                        box('stsc',
                            0x01, // version 1
                            0x00, 0x00, 0x00, // flags
                            0x00, 0x00, 0x00, 0x01, // entry_count
                            0x00, 0x00, 0x00, 0x02, // first_chunk
                            0x00, 0x00, 0x00, 0x03, // samples_per_chunk
                            0x00, 0x00, 0x00, 0x01), // sample_description_index
                        box('stco',
                            0x01, // version 1
                            0x00, 0x00, 0x00, // flags
                            0x00, 0x00, 0x00, 0x01, // entry_count
                            0x00, 0x00, 0x00, 0x01)))))); // chunk_offset


  deepEqual(videojs.inspectMp4(new Uint8Array(data)), [{
    type: 'moov',
    size: 469,
    boxes: [{
      type: 'mvhd',
      version: 1,
      flags: new Uint8Array([0, 0, 0]),
      creationTime: new Date(1000 - 2082844800000),
      modificationTime: new Date(2000 - 2082844800000),
      timescale: 60,
      duration: 600,
      rate: 1,
      size: 120,
      volume: 1,
      matrix: new Uint32Array(unityMatrix),
      nextTrackId: 2
    }, {
      type: 'trak',
      size: 341,
      boxes: [{
        type: 'tkhd',
        flags: new Uint8Array([0, 0, 0]),
        version: 1,
        creationTime: new Date(2000 - 2082844800000),
        modificationTime: new Date(3000 - 2082844800000),
        size: 104,
        trackId: 1,
        duration: 600,
        layer: 0,
        alternateGroup: 0,
        volume: 0,
        matrix: new Uint32Array(unityMatrix),
        width: 300,
        height: 150
      }, {
        type: 'mdia',
        size: 229,
        boxes: [{
          type: 'mdhd',
          version: 1,
          flags: new Uint8Array([0, 0, 0]),
          creationTime: new Date(2000 - 2082844800000),
          modificationTime: new Date(3000 - 2082844800000),
          timescale: 60,
          duration: 600,
          language: 'eng',
          size: 44
        }, {
          type: 'hdlr',
          version: 1,
          flags: new Uint8Array([0, 0, 0]),
          handlerType: 'vide',
          name: 'one',
          size: 37
        }, {
          type: 'minf',
          size: 140,
          boxes: [{
            type: 'dinf',
            size: 36,
            boxes: [{
              type: 'dref',
              size: 28,
              version: 1,
              flags: new Uint8Array([0, 0, 0]),
              dataReferences: [{
                type: 'url ',
                size: 12,
                version: 0,
                flags: new Uint8Array([0, 0, 1])
              }],
            }]
          }, {
            type: 'stbl',
            size: 96,
            boxes: [{
              type: 'stsd',
              size: 16,
              version: 1,
              flags: new Uint8Array([0, 0, 0]),
              sampleDescriptions: [],
            }, {
              type: 'stts',
              size: 24,
              version: 1,
              flags: new Uint8Array([0, 0, 0]),
              timeToSamples: [{
                sampleCount: 1,
                sampleDelta: 1
              }]
            }, {
              type: 'stsc',
              version: 1,
              flags: new Uint8Array([0, 0, 0]),
              sampleToChunks: [{
                firstChunk: 2,
                samplesPerChunk: 3,
                sampleDescriptionIndex: 1
              }],
              size: 28
            }, {
              type: 'stco',
              size: 20,
              version: 1,
              flags: new Uint8Array([0, 0, 0]),
              chunkOffsets: [1]
            }]
          }]
        }]
      }]
    }]
  }], 'parsed a moov');
});

test('can parse an mvex', function() {
  var mvex =
    box('mvex',
        box('trex',
            0x00, // version
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x01, // track_ID
            0x00, 0x00, 0x00, 0x01, // default_sample_description_index
            0x00, 0x00, 0x00, 0x02, // default_sample_duration
            0x00, 0x00, 0x00, 0x03, // default_sample_size
            0x00, 0x61, 0x00, 0x01)); // default_sample_flags
  deepEqual(videojs.inspectMp4(new Uint8Array(mvex)), [{
    type: 'mvex',
    size: 40,
    boxes: [{
      type: 'trex',
      size: 32,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      trackId: 1,
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 2,
      defaultSampleSize: 3,
      sampleDependsOn: 0,
      sampleIsDependedOn: 1,
      sampleHasRedundancy: 2,
      samplePaddingValue: 0,
      sampleIsDifferenceSample: true,
      sampleDegradationPriority: 1
    }]
  }], 'parsed an mvex');
});

test('can parse a video stsd', function() {
  var data = box('stsd',
                 0x00, // version 0
                 0x00, 0x00, 0x00, // flags
                 0x00, 0x00, 0x00, 0x01,
                 box('avc1',
                     0x00, 0x00, 0x00,
                     0x00, 0x00, 0x00, // reserved
                     0x00, 0x01, // data_reference_index
                     0x00, 0x00, // pre_defined
                     0x00, 0x00, // reserved
                     0x00, 0x00, 0x00, 0x00,
                     0x00, 0x00, 0x00, 0x00,
                     0x00, 0x00, 0x00, 0x00, // pre_defined
                     0x01, 0x2c, // width = 300
                     0x00, 0x96, // height = 150
                     0x00, 0x48, 0x00, 0x00, // horizresolution
                     0x00, 0x48, 0x00, 0x00, // vertresolution
                     0x00, 0x00, 0x00, 0x00, // reserved
                     0x00, 0x01, // frame_count
                     0x04,
                     typeBytes('avc1'),
                     0x00, 0x00, 0x00, 0x00,
                     0x00, 0x00, 0x00, 0x00,
                     0x00, 0x00, 0x00, 0x00,
                     0x00, 0x00, 0x00, 0x00,
                     0x00, 0x00, 0x00, 0x00,
                     0x00, 0x00, 0x00, 0x00,
                     0x00, 0x00, 0x00, // compressorname
                     0x00, 0x18, // depth = 24
                     0x11, 0x11, // pre_defined
                     box('avcC',
                        0x01, // configurationVersion
                        0x00, // AVCProfileIndication??
                        0x00, // profile_compatibility
                        0x00, // AVCLevelIndication
                        0x1c, // lengthSizeMinusOne
                        0xe1, // numOfSequenceParameterSets
                        0x00, 0x01, // sequenceParameterSetLength
                        0x00, // "SPS"
                        0x02, // numOfPictureParameterSets
                        0x00, 0x02, // pictureParameterSetLength
                        0x01, 0x02, // "PPS"
                        0x00, 0x01, // pictureParameterSetLength
                        0xff), // "PPS"
                     box('btrt',
                        0x00, 0x00, 0x00, 0x00, // bufferSizeDB
                        0x00, 0x00, 0x00, 0x01, // maxBitrate
                        0x00, 0x00, 0x00, 0x01))); // avgBitrate
  deepEqual(videojs.inspectMp4(new Uint8Array(data)), [{
    type: 'stsd',
    size: 147,
    version: 0,
    flags: new Uint8Array([0, 0, 0]),
    sampleDescriptions: [{
      type: 'avc1',
      size: 131,
      dataReferenceIndex: 1,
      width: 300,
      height: 150,
      horizresolution: 72,
      vertresolution: 72,
      frameCount: 1,
      depth: 24,
      config: [{
        type: 'avcC',
        size: 25,
        configurationVersion: 1,
        avcProfileIndication: 0,
        profileCompatibility: 0,
        avcLevelIndication: 0,
        lengthSizeMinusOne: 0,
        sps: [new Uint8Array(1)],
        pps: [new Uint8Array([1, 2]),
              new Uint8Array([0xff])]
      }, {
        type: 'btrt',
        size: 20,
        bufferSizeDB: 0,
        maxBitrate: 1,
        avgBitrate: 1
      }]
    }]
  }]);
});

test('can parse a vmhd', function() {
  var data = box('vmhd',
                 0x00, // version
                 0x00, 0x00, 0x00, // flags
                 0x00, 0x00, // graphicsmode
                 0x00, 0x00,
                 0x00, 0x00,
                 0x00, 0x00); // opcolor

  deepEqual(videojs.inspectMp4(new Uint8Array(data)),
            [{
              type: 'vmhd',
              size: 20,
              version: 0,
              flags: new Uint8Array([0, 0, 0]),
              graphicsmode: 0,
              opcolor: new Uint16Array([0, 0, 0])
            }]);
});

test('can parse an stsz', function() {
  var data = box('stsz',
                 0x00, // version
                 0x00, 0x00, 0x00, // flags
                 0x00, 0x00, 0x00, 0x00, // sample_size
                 0x00, 0x00, 0x00, 0x03, // sample_count
                 0x00, 0x00, 0x00, 0x01, // entry_size
                 0x00, 0x00, 0x00, 0x02, // entry_size
                 0x00, 0x00, 0x00, 0x03); // entry_size
  deepEqual(videojs.inspectMp4(new Uint8Array(data)),
            [{
              type: 'stsz',
              size: 32,
              version: 0,
              flags: new Uint8Array([0, 0, 0]),
              sampleSize: 0,
              entries: [1, 2, 3]
            }]);
});

test('can parse a moof', function() {
  var data = box('moof',
                 box('mfhd',
                     0x00, // version
                     0x00, 0x00, 0x00, // flags
                     0x00, 0x00, 0x00, 0x04), // sequence_number
                 box('traf',
                     box('tfhd',
                        0x00, // version
                        0x00, 0x00, 0x3b, // flags
                        0x00, 0x00, 0x00, 0x01, // track_ID
                        0x00, 0x00, 0x00, 0x00,
                        0x00, 0x00, 0x00, 0x01, // base_data_offset
                        0x00, 0x00, 0x00, 0x02, // sample_description_index
                        0x00, 0x00, 0x00, 0x03, // default_sample_duration,
                        0x00, 0x00, 0x00, 0x04, // default_sample_size
                        0x00, 0x00, 0x00, 0x05))); // default_sample_flags
  deepEqual(videojs.inspectMp4(new Uint8Array(data)),
            [{
              type: 'moof',
              size: 72,
              boxes: [{
                type: 'mfhd',
                size: 16,
                version: 0,
                flags: new Uint8Array([0, 0, 0]),
                sequenceNumber: 4
              },
              {
                type: 'traf',
                size: 48,
                boxes: [{
                  type: 'tfhd',
                  version: 0,
                  size: 40,
                  flags: new Uint8Array([0, 0, 0x3b]),
                  trackId: 1,
                  baseDataOffset: 1,
                  sampleDescriptionIndex: 2,
                  defaultSampleDuration: 3,
                  defaultSampleSize: 4,
                  defaultSampleFlags: 5
                }]
              }]
            }]);
});

test('can parse a series of boxes', function() {
  var ftyp = [
    0x00, 0x00, 0x00, 0x18 // size 4 * 6 = 24
  ].concat(typeBytes('ftyp')).concat([
    0x69, 0x73, 0x6f, 0x6d, // major brand
    0x00, 0x00, 0x00, 0x02, // minor version
    0x00, 0x00, 0x00, 0x03, // compatible brands
    0x00, 0x00, 0x00, 0x04, // compatible brands
  ]);

  deepEqual(videojs.inspectMp4(new Uint8Array(ftyp.concat(ftyp))),
            [{
              type: 'ftyp',
              size: 4 * 6,
              majorBrand: 'isom',
              minorVersion: 2,
              compatibleBrands: [3, 4]
            },{
              type: 'ftyp',
              size: 4 * 6,
              majorBrand: 'isom',
              minorVersion: 2,
              compatibleBrands: [3, 4]
            }],
            'parsed two boxes in series');

});

})(window, window.videojs);

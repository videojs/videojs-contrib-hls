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
  ];

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
    0x00, 0x00, 0x00, 0x01, // major brand
    0x00, 0x00, 0x00, 0x02, // minor version
    0x00, 0x00, 0x00, 0x03, // compatible brands
    0x00, 0x00, 0x00, 0x04 // compatible brands
  ))), [{
    type: 'ftyp',
    size: 4 * 6,
    majorBrand: 1,
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
      data: mdat.subarray(mdat.byteLength - 4)
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
                0x00, 0x00, 0x01, 0x2c, // 300 = 0x12c width
                0x00, 0x00, 0x00, 0x96), // 150 = 0x96 height
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
                            0x00, 0x00, 0x00, 0x00)), // entry_count
                    box('stbl',
                        box('stsd',
                            0x01, // version 1
                            0x00, 0x00, 0x00, // flags
                            0x00, 0x00, 0x00, 0x00), // entry_count
                        box('stts',
                            0x01, // version 1
                            0x00, 0x00, 0x00, // flags
                            0x00, 0x00, 0x00, 0x00), // entry_count
                        box('stsc',
                            0x01, // version 1
                            0x00, 0x00, 0x00, // flags
                            0x00, 0x00, 0x00, 0x00), // entry_count
                        box('stco',
                            0x01, // version 1
                            0x00, 0x00, 0x00, // flags
                            0x00, 0x00, 0x00, 0x00)))))); // entry_count;

  deepEqual(videojs.inspectMp4(new Uint8Array(data)), [{
    size: 433,
    type: 'moov',
    boxes: [{
      type: 'mvhd',
      version: 1,
      flags: new Uint8Array([0, 0, 0]),
      creationTime: 1,
      modificationTime: 2,
      timescale: 60,
      duration: 600,
      rate: 1,
      size: 120,
      volume: 1,
      matrix: new Uint32Array(unityMatrix),
      nextTrackId: 2
    }, {
      type: 'trak',
      size: 305,
      boxes: [{
        type: 'tkhd',
        flags: new Uint8Array([0, 0, 0]),
        version: 1,
        creationTime: 2,
        modificationTime: 3,
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
        size: 193,
        boxes: [{
          type: 'mdhd',
          version: 1,
          flags: new Uint8Array([0, 0, 0]),
          creationTime: 2,
          modificationTime: 3,
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
          size: 104,
          boxes: [{
            type: 'dinf',
            size: 24,
            boxes: [{
              type: 'dref',
              dataReferences: [],
              size: 16
            }]}, {
              type: 'stbl',
              size: 72,
              boxes: [{
                type: 'stsd',
                sampleDescriptions: [],
                size: 16
              }, {
                type: 'stts',
                timeToSamples: [],
                size: 16
              }, {
                type: 'stsc',
                sampleToChunks: [],
                size: 16
              }, {
                type: 'stco',
                chunkOffsets: [],
                size: 16
              }]
            }]
          }]
        }]
      }]
    }], 'parsed a moov');
});

test('can parse a series of boxes', function() {
  var ftyp = [
    0x00, 0x00, 0x00, 0x18 // size 4 * 6 = 24
  ].concat(typeBytes('ftyp')).concat([
    0x00, 0x00, 0x00, 0x01, // major brand
    0x00, 0x00, 0x00, 0x02, // minor version
    0x00, 0x00, 0x00, 0x03, // compatible brands
    0x00, 0x00, 0x00, 0x04, // compatible brands
  ]);

  deepEqual(videojs.inspectMp4(new Uint8Array(ftyp.concat(ftyp))),
            [{
              type: 'ftyp',
              size: 4 * 6,
              majorBrand: 1,
              minorVersion: 2,
              compatibleBrands: [3, 4]
            },{
              type: 'ftyp',
              size: 4 * 6,
              majorBrand: 1,
              minorVersion: 2,
              compatibleBrands: [3, 4]
            }],
            'parsed two boxes in series');

});

})(window, window.videojs);

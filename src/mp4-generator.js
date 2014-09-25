(function(window, videojs, undefined) {
'use strict';

var box, dinf, ftyp, minf, moof, moov, mvex, mvhd, trak, tkhd, mdia, mdhd, hdlr, stbl,
    stsd, styp, types, MAJOR_BRAND, MINOR_VERSION, VIDEO_HDLR, AUDIO_HDLR, HDLR_TYPES, VMHD, DREF, STCO, STSC, STSZ, STTS, TREX,
    Uint8Array, DataView;

Uint8Array = window.Uint8Array;
DataView = window.DataView;

// pre-calculate constants
(function() {
  var i;
  types = {
    avc1: [], // codingname
    avcC: [],
    btrt: [],
    dinf: [],
    dref: [],
    ftyp: [],
    hdlr: [],
    mdhd: [],
    mdia: [],
    mfhd: [],
    minf: [],
    moof: [],
    moov: [],
    mvex: [],
    mvhd: [],
    stbl: [],
    stco: [],
    stsc: [],
    stsd: [],
    stsz: [],
    stts: [],
    styp: [],
    tfhd: [],
    traf: [],
    trak: [],
    trex: [],
    tkhd: [],
    vmhd: []
  };

  for (i in types) {
    if (types.hasOwnProperty(i)) {
      types[i] = [
        i.charCodeAt(0),
        i.charCodeAt(1),
        i.charCodeAt(2),
        i.charCodeAt(3)
      ];
    }
  }

  MAJOR_BRAND = new Uint8Array([
    'i'.charCodeAt(0),
    's'.charCodeAt(0),
    'o'.charCodeAt(0),
    'm'.charCodeAt(0)
  ]);
  MINOR_VERSION = new Uint8Array([0, 0, 0, 1]);
  VIDEO_HDLR = new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // pre_defined
    0x76, 0x69, 0x64, 0x65, // handler_type: 'vide'
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x56, 0x69, 0x64, 0x65,
    0x6f, 0x48, 0x61, 0x6e,
    0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'VideoHandler'
  ]);
  AUDIO_HDLR = new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // pre_defined
    0x73, 0x6f, 0x75, 0x6e, // handler_type: 'soun'
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x53, 0x6f, 0x75, 0x6e,
    0x64, 0x48, 0x61, 0x6e,
    0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'SoundHandler'
  ]);
  HDLR_TYPES = {
    "video":VIDEO_HDLR,
    "audio": AUDIO_HDLR
  };
  DREF = new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x01, // entry_count
    0x00, 0x00, 0x00, 0x0c, // entry_size
    0x75, 0x72, 0x6c, 0x20, // 'url' type
    0x00, // version 0
    0x00, 0x00, 0x01 // entry_flags
  ]);
  TREX = new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x01, // track_ID
    0x00, 0x00, 0x00, 0x01, // default_sample_description_index
    0x00, 0x00, 0x00, 0x00, // default_sample_duration
    0x00, 0x00, 0x00, 0x00, // default_sample_size
    0x00, 0x01, 0x00, 0x01 // default_sample_flags
  ]);
  STCO = new Uint8Array([
    0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00 // entry_count
  ]);
  STSC = STCO;
  STSZ = new Uint8Array([
    0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // sample_size
    0x00, 0x00, 0x00, 0x00, // sample_count
  ]);
  STTS = STCO;
  VMHD = new Uint8Array([
    0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, // graphicsmode
    0x00, 0x00,
    0x00, 0x00,
    0x00, 0x00 // opcolor
  ]);
})();

box = function(type) {
  var
    payload = Array.prototype.slice.call(arguments, 1),
    size = 0,
    i = payload.length,
    result,
    view;

  // calculate the total size we need to allocate
  while (i--) {
    size += payload[i].byteLength;
  }
  result = new Uint8Array(size + 8);
  view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  view.setUint32(0, result.byteLength);
  result.set(type, 4);

  // copy the payload into the result
  for (i = 0, size = 8; i < payload.length; i++) {
    result.set(payload[i], size);
    size += payload[i].byteLength;
  }
  return result;
};

dinf = function() {
  return box(types.dinf, box(types.dref, DREF));
};

ftyp = function() {
  return box(types.ftyp, MAJOR_BRAND, MINOR_VERSION, MAJOR_BRAND);
};

hdlr = function(type) {
  return box(types.hdlr, HDLR_TYPES[type]);
};
mdhd = function(duration) {
  return box(types.mdhd, new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x02, // creation_time
    0x00, 0x00, 0x00, 0x03, // modification_time
    0x00, 0x01, 0x5f, 0x90, // timescale, 90,000 "ticks" per second

    (duration & 0xFF000000) >> 24,
    (duration & 0xFF0000) >> 16,
    (duration & 0xFF00) >> 8,
    duration & 0xFF, // duration
    0x55, 0xc4, // 'und' language (undetermined)
    0x00, 0x00
  ]));
};
mdia = function(duration, width, height, type) {
  return box(types.mdia, mdhd(duration), hdlr(type), minf(width, height));
};
minf = function(width, height) {
  return box(types.minf, box(types.vmhd, VMHD), dinf(), stbl(width, height));
};
moof = function(tracks) {
  var
    trafCall = [],
    i = tracks.length;
  // build tfhd boxes for each track fragment
  while (i--) {
    trafCall[i] = box(types.tfhd, new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x00, // flags
      (tracks[i].trackId & 0xFF000000) >> 24,
      (tracks[i].trackId & 0xFF0000) >> 16,
      (tracks[i].trackId & 0xFF00) >> 8,
      (tracks[i].trackId & 0xFF),
    ]));
  }
  trafCall.unshift(types.traf);
  return box(types.moof,
             box(types.mfhd),
             box.apply(null, trafCall));
};
moov = function(duration, width, height, type) {
  return box(types.moov, mvhd(duration), trak(duration, width, height, type), mvex());
};
mvex = function() {
  return box(types.mvex, box(types.trex, TREX));
};
mvhd = function(duration) {
  var
    bytes = new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x00, // flags
      0x00, 0x00, 0x00, 0x01, // creation_time
      0x00, 0x00, 0x00, 0x02, // modification_time
      0x00, 0x01, 0x5f, 0x90, // timescale, 90,000 "ticks" per second
      (duration & 0xFF000000) >> 24,
      (duration & 0xFF0000) >> 16,
      (duration & 0xFF00) >> 8,
      duration & 0xFF, // duration
      0x00, 0x01, 0x00, 0x00, // 1.0 rate
      0x01, 0x00, // 1.0 volume
      0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // pre_defined
      0x00, 0x00, 0x00, 0x01 // next_track_ID
    ]);
  return box(types.mvhd, bytes);
};

stbl = function(width, height) {
  return box(types.stbl,
             stsd(width, height),
             box(types.stts, STTS),
             box(types.stsc, STSC),
             box(types.stsz, STSZ),
             box(types.stco, STCO));
};

stsd = function(width, height) {
  return box(types.stsd, new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x01]),
    box(types.avc1, new Uint8Array([
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // data_reference_index
      0x00, 0x00, // pre_defined
      0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // pre_defined
      (width & 0xff00) >> 8,
      width & 0xff, // width
      (height & 0xff00) >> 8,
      height & 0xff, // height
      0x00, 0x48, 0x00, 0x00, // horizresolution
      0x00, 0x48, 0x00, 0x00, // vertresolution
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x01, // frame_count
      0x13,
      0x76, 0x69, 0x64, 0x65,
      0x6f, 0x6a, 0x73, 0x2d,
      0x63, 0x6f, 0x6e, 0x74,
      0x72, 0x69, 0x62, 0x2d,
      0x68, 0x6c, 0x73, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, // compressorname
      0x00, 0x18, // depth = 24
      0x11, 0x11]), // pre_defined = -1
        box(types.avcC, new Uint8Array([
          0x01, // configurationVersion
          0x4d, // AVCProfileIndication??
          0x40, // profile_compatibility
          0x20, // AVCLevelIndication
          0xff, // lengthSizeMinusOne
          0xe1, // numOfSequenceParameterSets
          0x00, 0x0c, // sequenceParameterSetLength
          0x67, 0x4d, 0x40, 0x20,
          0x96, 0x52, 0x80, 0xa0,
          0x0b, 0x76, 0x02, 0x05, // SPS
          0x01, // numOfPictureParameterSets
          0x00, 0x04, // pictureParameterSetLength
          0x68, 0xef, 0x38, 0x80])), // "PPS"
        box(types.btrt, new Uint8Array([
          0x00, 0x1c, 0x9c, 0x80, // bufferSizeDB
          0x00, 0x2d, 0xc6, 0xc0, // maxBitrate
          0x00, 0x2d, 0xc6, 0xc0])) // avgBitrate
        ));
};

styp = function() {
  return box(types.styp, MAJOR_BRAND, MINOR_VERSION, MAJOR_BRAND);
};

tkhd = function(duration, width, height) {
  return box(types.tkhd, new Uint8Array([
    0x00, // version 0
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // creation_time
    0x00, 0x00, 0x00, 0x00, // modification_time
    0x00, 0x00, 0x00, 0x01, // track_ID
    0x00, 0x00, 0x00, 0x00, // reserved
    (duration & 0xFF000000) >> 24,
    (duration & 0xFF0000) >> 16,
    (duration & 0xFF00) >> 8,
    duration & 0xFF, // duration
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, // layer
    0x00, 0x00, // alternate_group
    0x00, 0x00, // non-audio track volume
    0x00, 0x00, // reserved
    0x00, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
    (width & 0xFF00) >> 8,
    width & 0xFF,
    0x00, 0x00, // width
    (height & 0xFF00) >> 8,
    height & 0xFF,
    0x00, 0x00 // height
  ]));
};

trak = function(duration, width, height, type) {
  return box(types.trak, tkhd(duration, width, height), mdia(duration, width, height, type));
};

window.videojs.mp4 = {
  ftyp: ftyp,
  moof: moof,
  moov: moov,
  initSegment: function() {
    var
      fileType = ftyp(),
      movie = moov(0xffffffff, 1280, 720, "video"),
      result = new Uint8Array(fileType.byteLength + movie.byteLength);

    result.set(fileType);
    result.set(movie, fileType.byteLength);
    return result;
  }
};

})(window, window.videojs);

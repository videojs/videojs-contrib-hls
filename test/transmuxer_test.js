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
  PacketStream = videojs.mp2t.PacketStream,
  packetStream,
  ParseStream = videojs.mp2t.ParseStream,
  parseStream,
  ProgramStream = videojs.mp2t.ProgramStream,
  programStream,
  H264Stream = videojs.mp2t.H264Stream,
  h264Stream,
  Transmuxer = videojs.mp2t.Transmuxer,
  transmuxer,

  MP2T_PACKET_LENGTH = videojs.mp2t.MP2T_PACKET_LENGTH,
  H264_STREAM_TYPE = videojs.mp2t.H264_STREAM_TYPE,
  ADTS_STREAM_TYPE = videojs.mp2t.ADTS_STREAM_TYPE,
  packetize,

  PAT,
  PMT,
  standalonePes,
  validateTrack,
  validateTrackFragment,

  videoPes;

module('MP2T Packet Stream', {
  setup: function() {
    packetStream = new PacketStream();
  }
});

test('empty input does not error', function() {
  packetStream.push(new Uint8Array([]));
  ok(true, 'did not throw');
});
test('parses a generic packet', function() {
  var datas = [];
  packetStream.on('data', function(event) {
    datas.push(event);
  });
  packetStream.push(new Uint8Array(188));

  equal(1, datas.length, 'fired one event');
  equal(datas[0].byteLength, 188, 'delivered the packet');
});

test('buffers partial packets', function() {
  var datas = [];
  packetStream.on('data', function(event) {
    datas.push(event);
  });
  packetStream.push(new Uint8Array(187));

  equal(0, datas.length, 'did not fire an event');

  packetStream.push(new Uint8Array(189));
  equal(2, datas.length, 'fired events');
  equal(188, datas[0].byteLength, 'parsed the first packet');
  equal(188, datas[1].byteLength, 'parsed the second packet');
});

test('parses multiple packets delivered at once', function() {
  var datas = [];
  packetStream.on('data', function(event) {
    datas.push(event);
  });

  packetStream.push(new Uint8Array(188 * 3));
  equal(3, datas.length, 'fired three events');
  equal(188, datas[0].byteLength, 'parsed the first packet');
  equal(188, datas[1].byteLength, 'parsed the second packet');
  equal(188, datas[2].byteLength, 'parsed the third packet');
});

test('buffers extra after multiple packets', function() {
  var datas = [];
  packetStream.on('data', function(event) {
    datas.push(event);
  });

  packetStream.push(new Uint8Array(188 * 2 + 10));
  equal(2, datas.length, 'fired two events');
  equal(188, datas[0].byteLength, 'parsed the first packet');
  equal(188, datas[1].byteLength, 'parsed the second packet');

  packetStream.push(new Uint8Array(178));
  equal(3, datas.length, 'fired a final event');
  equal(188, datas[2].length, 'parsed the finel packet');
});

module('MP2T ParseStream', {
  setup: function() {
    packetStream = new PacketStream();
    parseStream = new ParseStream();

    packetStream.pipe(parseStream);
  }
});

test('emits an error on an invalid packet', function() {
  var errors = [];
  parseStream.on('error', function(error) {
    errors.push(error);
  });
  parseStream.push(new Uint8Array(188));

  equal(1, errors.length, 'emitted an error');
});

test('parses generic packet properties', function() {
  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });

  parseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0001 tsc:01 afc:10 cc:11 padding: 00
    0x40, 0x01, 0x6c
  ]));
  ok(packet.payloadUnitStartIndicator, 'parsed payload_unit_start_indicator');
  ok(packet.pid, 'parsed PID');
});

test('parses piped data events', function() {
  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });

  parseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0001 tsc:01 afc:10 cc:11 padding: 00
    0x40, 0x01, 0x6c
  ]));

  ok(packet, 'parsed a packet');
});

test('parses a data packet with adaptation fields', function() {
  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });

  parseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0000 tsc:01 afc:10 cc:11 afl:00 0000 00 stuffing:00 0000 00 pscp:00 0001 padding:0000
    0x40, 0x00, 0x6c, 0x00, 0x00, 0x10
  ]));
  strictEqual(packet.type, 'pat', 'parsed the packet type');
});

test('parses a PES packet', function() {
  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });

  // setup a program map table
  parseStream.programMapTable = {
    0x0010: videojs.mp2t.H264_STREAM_TYPE
  };

  parseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0010 tsc:01 afc:01 cc:11 padding:00
    0x40, 0x02, 0x5c
  ]));
  strictEqual(packet.type, 'pes', 'parsed a PES packet');
});

test('parses packets with variable length adaptation fields and a payload', function() {
  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });

  // setup a program map table
  parseStream.programMapTable = {
    0x0010: videojs.mp2t.H264_STREAM_TYPE
  };

  parseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0010 tsc:01 afc:11 cc:11 afl:00 0000 11 stuffing:00 0000 0000 00 pscp:00 0001
    0x40, 0x02, 0x7c, 0x0c, 0x00, 0x01
  ]));
  strictEqual(packet.type, 'pes', 'parsed a PES packet');
});

/*
 Packet Header:
 | sb | tei pusi tp pid:5 | pid | tsc afc cc |
 with af:
 | afl | ... | <data> |
 without af:
 | <data> |

PAT:
 | pf? | ... |
 | tid | ssi '0' r sl:4 | sl | tsi:8 |
 | tsi | r vn cni | sn | lsn |

with program_number == '0':
 | pn | pn | r np:5 | np |
otherwise:
 | pn | pn | r pmp:5 | pmp |
*/

PAT = [
  0x47, // sync byte
  // tei:0 pusi:1 tp:0 pid:0 0000 0000 0000
  0x40, 0x00,
  // tsc:01 afc:01 cc:0000 pointer_field:0000 0000
  0x50, 0x00,
  // tid:0000 0000 ssi:0 0:0 r:00 sl:0000 0000 0000
  0x00, 0x00, 0x00,
  // tsi:0000 0000 0000 0000
  0x00, 0x00,
  // r:00 vn:00 000 cni:1 sn:0000 0000 lsn:0000 0000
  0x01, 0x00, 0x00,
  // pn:0000 0000 0000 0001
  0x00, 0x01,
  // r:000 pmp:0 0000 0010 0000
  0x00, 0x10,
  // crc32:0000 0000 0000 0000 0000 0000 0000 0000
  0x00, 0x00, 0x00, 0x00
];

test('parses the program map table pid from the program association table (PAT)', function() {
  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });

  parseStream.push(new Uint8Array(PAT));
  ok(packet, 'parsed a packet');
  strictEqual(0x0010, parseStream.pmtPid, 'parsed PMT pid');
});

PMT = [
  0x47, // sync byte
  // tei:0 pusi:1 tp:0 pid:0 0000 0010 0000
  0x40, 0x10,
  // tsc:01 afc:01 cc:0000 pointer_field:0000 0000
  0x50, 0x00,
  // tid:0000 0010 ssi:0 0:0 r:00 sl:0000 0001 0111
  0x02, 0x00, 0x17,
  // pn:0000 0000 0000 0001
  0x00, 0x01,
  // r:00 vn:00 000 cni:1 sn:0000 0000 lsn:0000 0000
  0x01, 0x00, 0x00,
  // r:000 ppid:0 0011 1111 1111
  0x03, 0xff,
  // r:0000 pil:0000 0000 0000
  0x00, 0x00,
  // h264
  // st:0001 1010 r:000 epid:0 0000 0001 0001
  0x1b, 0x00, 0x11,
  // r:0000 esil:0000 0000 0000
  0x00, 0x00,
  // adts
  // st:0000 1111 r:000 epid:0 0000 0001 0010
  0x0f, 0x00, 0x12,
  // r:0000 esil:0000 0000 0000
  0x00, 0x00,
  // crc
  0x00, 0x00, 0x00, 0x00
];

test('parse the elementary streams from a program map table', function() {
  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });
  parseStream.pmtPid = 0x0010;

  parseStream.push(new Uint8Array(PMT.concat(0, 0, 0, 0, 0)));

  ok(packet, 'parsed a packet');
  ok(parseStream.programMapTable, 'parsed a program map');
  strictEqual(0x1b, parseStream.programMapTable[0x11], 'associated h264 with pid 0x11');
  strictEqual(0x0f, parseStream.programMapTable[0x12], 'associated adts with pid 0x12');
  strictEqual(parseStream.programMapTable[0], undefined, 'ignored trailing stuffing bytes');
  deepEqual(parseStream.programMapTable, packet.programMapTable, 'recorded the PMT');
});

test('parses an elementary stream packet with just a pts', function() {
  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });

  parseStream.programMapTable = {
    0x11: 0x1b // pid 0x11 is h264 data
  };

  parseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0001 0001
    0x40, 0x11,
    // tsc:01 afc:01 cc:0000
    0x50,
    // pscp:0000 0000 0000 0000 0000 0001
    0x00, 0x00, 0x01,
    // sid:0000 0000 ppl:0000 0000 0000 1001
    0x00, 0x00, 0x09,
    // 10 psc:00 pp:0 dai:1 c:0 ooc:0
    0x84,
    // pdf:10 ef:1 erf:0 dtmf:0 acif:0 pcf:0 pef:0
    0xc0,
    // phdl:0000 0101 '0010' pts:000 mb:1 pts:0000 0000
    0x05, 0x21, 0x00,
    // pts:0000 000 mb:1 pts:0000 0000 pts:0000 000 mb:1
    0x01, 0x00, 0x01,
    // "data":0101
    0x11
  ]));

  ok(packet, 'parsed a packet');
  equal('pes', packet.type, 'recognized a PES packet');
  equal(0x1b, packet.streamType, 'tracked the stream_type');
  equal(1, packet.data.byteLength, 'parsed a single data byte');
  equal(0x11, packet.data[0], 'parsed the data');
  equal(0, packet.pts, 'parsed the pts');
});

test('parses an elementary stream packet with a pts and dts', function() {
  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });

  parseStream.programMapTable = {
    0x11: 0x1b // pid 0x11 is h264 data
  };

  parseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0001 0001
    0x40, 0x11,
    // tsc:01 afc:01 cc:0000
    0x50,
    // pscp:0000 0000 0000 0000 0000 0001
    0x00, 0x00, 0x01,
    // sid:0000 0000 ppl:0000 0000 0000 1110
    0x00, 0x00, 0x0e,
    // 10 psc:00 pp:0 dai:1 c:0 ooc:0
    0x84,
    // pdf:11 ef:1 erf:0 dtmf:0 acif:0 pcf:0 pef:0
    0xe0,
    // phdl:0000 1010 '0011' pts:000 mb:1 pts:0000 0000
    0x0a, 0x21, 0x00,
    // pts:0000 000 mb:1 pts:0000 0000 pts:0000 100 mb:1
    0x01, 0x00, 0x09,
    // '0001' dts:000 mb:1 dts:0000 0000 dts:0000 000 mb:1
    0x11, 0x00, 0x01,
    // dts:0000 0000 dts:0000 010 mb:1
    0x00, 0x05,
    // "data":0101
    0x11
  ]));

  ok(packet, 'parsed a packet');
  equal('pes', packet.type, 'recognized a PES packet');
  equal(0x1b, packet.streamType, 'tracked the stream_type');
  equal(1, packet.data.byteLength, 'parsed a single data byte');
  equal(0x11, packet.data[0], 'parsed the data');
  equal(4 / 90, packet.pts, 'parsed the pts');
  equal(2 / 90, packet.dts, 'parsed the dts');
});

// helper function to create video PES packets
videoPes = function(data, first) {
  var
    adaptationFieldLength = 188 - data.length - (first ? 18 : 17),
    result = [
      // sync byte
      0x47,
      // tei:0 pusi:1 tp:0 pid:0 0000 0001 0001
      0x40, 0x11,
      // tsc:01 afc:11 cc:0000
      0x70
    ].concat([
      // afl
      adaptationFieldLength & 0xff,
      // di:0 rai:0 espi:0 pf:0 of:0 spf:0 tpdf:0 afef:0
      0x00
    ]),
    i;

  i = adaptationFieldLength - 1;
  while (i--) {
    // stuffing_bytes
    result.push(0xff);
  }

  result = result.concat([
    // pscp:0000 0000 0000 0000 0000 0001
    0x00, 0x00, 0x01,
    // sid:0000 0000 ppl:0000 0000 0000 0101
    0x00, 0x00, 0x05,
    // 10 psc:00 pp:0 dai:1 c:0 ooc:0
    0x84,
    // pdf:00 ef:1 erf:0 dtmf:0 acif:0 pcf:0 pef:0
    0x20,
    // phdl:0000 0000
    0x00
  ]);
  if (first) {
    result.push(0x00);
  }
  result = result.concat([
    // NAL unit start code
    0x00, 0x00, 0x01
  ].concat(data));
  return result;
};
standalonePes = videoPes([0xaf, 0x01], true);

test('parses an elementary stream packet without a pts or dts', function() {

  var packet;
  parseStream.on('data', function(data) {
    packet = data;
  });

  // pid 0x11 is h264 data
  parseStream.programMapTable = {
    0x11: H264_STREAM_TYPE
  };

  parseStream.push(new Uint8Array(standalonePes));

  ok(packet, 'parsed a packet');
  equal('pes', packet.type, 'recognized a PES packet');
  equal(0x1b, packet.streamType, 'tracked the stream_type');
  equal(2 + 4, packet.data.byteLength, 'parsed two data bytes');
  equal(0xaf, packet.data[packet.data.length - 2], 'parsed the first data byte');
  equal(0x01, packet.data[packet.data.length - 1], 'parsed the second data byte');
  ok(!packet.pts, 'did not parse a pts');
  ok(!packet.dts, 'did not parse a dts');
});

module('MP2T ProgramStream', {
  setup: function() {
    programStream = new ProgramStream();
  }
});

packetize = function(data) {
  var packet = new Uint8Array(MP2T_PACKET_LENGTH);
  packet.set(data);
  return packet;
};

test('parses metadata events from PSI packets', function() {
  var
    metadatas = [],
    datas = 0,
    sortById = function(left, right) {
      return left.id - right.id;
    };
  programStream.on('data', function(data) {
    if (data.type === 'metadata') {
      metadatas.push(data);
    }
    datas++;
  });
  programStream.push({
    type: 'pat'
  });
  programStream.push({
    type: 'pmt',
    programMapTable: {
      1: 0x1b,
      2: 0x0f
    }
  });

  equal(1, datas, 'data fired');
  equal(1, metadatas.length, 'metadata generated');
  metadatas[0].tracks.sort(sortById);
  deepEqual(metadatas[0].tracks, [{
    id: 1,
    codec: 'avc',
    type: 'video'
  }, {
    id: 2,
    codec: 'adts',
    type: 'audio'
  }], 'identified two tracks');
});

test('parses standalone program stream packets', function() {
  var packets = [];
  programStream.on('data', function(packet) {
    packets.push(packet);
  });
  programStream.push({
    type: 'pes',
    data: new Uint8Array(19)
  });
  programStream.end();

  equal(1, packets.length, 'built one packet');
  equal('audio', packets[0].type, 'identified audio data');
  equal(19, packets[0].data.byteLength, 'parsed the correct payload size');
});

test('aggregates program stream packets from the transport stream', function() {
  var events = [];
  programStream.on('data', function(event) {
    events.push(event);
  });

  programStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    pts: 7,
    dts: 8,
    data: new Uint8Array(7)
  });
  equal(0, events.length, 'buffers partial packets');

  programStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(13)
  });
  programStream.end();
  equal(1, events.length, 'built one packet');
  equal('video', events[0].type, 'identified video data');
  equal(events[0].pts, 7, 'passed along the pts');
  equal(events[0].dts, 8, 'passed along the dts');
  equal(20, events[0].data.byteLength, 'concatenated transport packets');
});

test('buffers audio and video program streams individually', function() {
  var events = [];
  programStream.on('data', function(event) {
    events.push(event);
  });

  programStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  programStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: ADTS_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  equal(0, events.length, 'buffers partial packets');

  programStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  programStream.push({
    type: 'pes',
    streamType: ADTS_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  programStream.end();
  equal(2, events.length, 'parsed a complete packet');
  equal('video', events[0].type, 'identified video data');
  equal('audio', events[1].type, 'identified audio data');
});

test('flushes the buffered packets when a new one of that type is started', function() {
  var packets = [];
  programStream.on('data', function(packet) {
    packets.push(packet);
  });
  programStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  programStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: ADTS_STREAM_TYPE,
    data: new Uint8Array(7)
  });
  programStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  equal(0, packets.length, 'buffers packets by type');

  programStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  equal(1, packets.length, 'built one packet');
  equal('video', packets[0].type, 'identified video data');
  equal(2, packets[0].data.byteLength, 'concatenated packets');

  programStream.end();
  equal(3, packets.length, 'built tow more packets');
  equal('video', packets[1].type, 'identified video data');
  equal(1, packets[1].data.byteLength, 'parsed the video payload');
  equal('audio', packets[2].type, 'identified audio data');
  equal(7, packets[2].data.byteLength, 'parsed the audio payload');
});

module('H264 Stream', {
  setup: function() {
    h264Stream = new H264Stream();
  }
});

test('unpacks nal units from simple byte stream framing', function() {
  var data;
  h264Stream.on('data', function(event) {
    data = event;
  });

  // the simplest byte stream framing:
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09, 0x07,
      0x00, 0x00, 0x01
    ])
  });

  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  equal(data.data.length, 2, 'calculated nal unit length');
  equal(data.data[1], 7, 'read a payload byte');
});

test('unpacks nal units from byte streams split across pushes', function() {
  var data;
  h264Stream.on('data', function(event) {
    data = event;
  });

  // handles byte streams split across pushes
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09])
  });
  ok(!data, 'buffers NAL units across events');

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x07,
      0x00, 0x00, 0x01
    ])
  });
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  equal(data.data.length, 2, 'calculated nal unit length');
  equal(data.data[1], 7, 'read a payload byte');
});

test('unpacks nal units from byte streams with split sync points', function() {
  var data;
  h264Stream.on('data', function(event) {
    data = event;
  });

  // handles sync points split across pushes
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09, 0x07,
      0x00])
  });
  ok(!data, 'buffers NAL units across events');

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x01
    ])
  });
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  equal(data.data.length, 2, 'calculated nal unit length');
  equal(data.data[1], 7, 'read a payload byte');
});

test('parses nal unit types', function() {
  var data;
  h264Stream.on('data', function(event) {
    data = event;
  });

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09
    ])
  });
  h264Stream.end();

  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x07,
      0x27, 0x42, 0xe0, 0x0b,
      0xa9, 0x18, 0x60, 0x9d,
      0x80, 0x35, 0x06, 0x01,
      0x06, 0xb6, 0xc2, 0xb5,
      0xef, 0x7c, 0x04
    ])
  });
  h264Stream.end();
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'seq_parameter_set_rbsp', 'identified a sequence parameter set');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x08, 0x01
    ])
  });
  h264Stream.end();
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'pic_parameter_set_rbsp', 'identified a picture parameter set');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x05, 0x01
    ])
  });
  h264Stream.end();
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'slice_layer_without_partitioning_rbsp_idr', 'identified a key frame');
});

module('Transmuxer', {
  setup: function() {
    transmuxer = new Transmuxer();
  }
});

test('generates an init segment', function() {
  var segments = [];
  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(PMT));
  transmuxer.push(packetize(videoPes([
    0x07,
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], true)));
  transmuxer.end();

  equal(segments.length, 1, 'has an init segment');
});

test('buffers video samples until ended', function() {
  var samples = [], boxes;
  transmuxer.on('data', function(data) {
    samples.push(data);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(PMT));

  // buffer a NAL
  transmuxer.push(packetize(videoPes([0x09, 0x01], true)));
  transmuxer.push(packetize(videoPes([0x00, 0x02])));

  // add an access_unit_delimiter_rbsp
  transmuxer.push(packetize(videoPes([0x09, 0x03])));
  transmuxer.push(packetize(videoPes([0x00, 0x04])));
  transmuxer.push(packetize(videoPes([0x00, 0x05])));

  // flush everything
  transmuxer.end();
  equal(samples.length, 1, 'emitted one event');
  boxes = videojs.inspectMp4(samples[0].data);
  equal(boxes.length, 2, 'generated two boxes');
  equal(boxes[0].type, 'moof', 'the first box is a moof');
  equal(boxes[1].type, 'mdat', 'the second box is a mdat');
  deepEqual(new Uint8Array(samples[0].data.subarray(samples[0].data.length - 10)),
            new Uint8Array([
              0x09, 0x01,
              0x00, 0x02,
              0x09, 0x03,
              0x00, 0x04,
              0x00, 0x05]),
            'concatenated NALs into an mdat');
});

validateTrack = function(track, metadata) {
  var mdia, handlerType;
  equal(track.type, 'trak', 'wrote the track type');
  equal(track.boxes.length, 2, 'wrote track children');
  equal(track.boxes[0].type, 'tkhd', 'wrote the track header');
  if (metadata) {
    if (metadata.trackId) {
      equal(track.boxes[0].trackId, metadata.trackId, 'wrote the track id');
    }
    if (metadata.width) {
      equal(track.boxes[0].width, metadata.width, 'wrote the width');
    }
    if (metadata.height) {
      equal(track.boxes[0].height, metadata.height, 'wrote the height');
    }
  }

  mdia = track.boxes[1];
  equal(mdia.type, 'mdia', 'wrote the media');
  equal(mdia.boxes.length, 3, 'wrote the mdia children');

  equal(mdia.boxes[0].type, 'mdhd', 'wrote the media header');
  equal(mdia.boxes[0].language, 'und', 'the language is undefined');
  equal(mdia.boxes[0].duration, 0xffffffff, 'the duration is at maximum');

  equal(mdia.boxes[1].type, 'hdlr', 'wrote the media handler');
  handlerType = mdia.boxes[1].handlerType;

  equal(mdia.boxes[2].type, 'minf', 'wrote the media info');
};

validateTrackFragment = function(track, metadata) {
  var tfhd, trun, sdtp, i, sample;
  equal(track.type, 'traf', 'wrote a track fragment');
  equal(track.boxes.length, 4, 'wrote four track fragment children');
  tfhd = track.boxes[0];
  equal(tfhd.type, 'tfhd', 'wrote a track fragment header');
  equal(tfhd.trackId, metadata.trackId, 'wrote the track id');

  equal(track.boxes[1].type,
        'tfdt',
        'wrote a track fragment decode time box');
  ok(track.boxes[1].baseMediaDecodeTime >= 0, 'base decode time is valid');

  trun = track.boxes[2];
  ok(trun.dataOffset >= 0, 'set data offset');
  ok(trun.samples.length > 0, 'generated media samples');
  for (i = 0; i < trun.samples.length; i++) {
    sample = trun.samples[i];
    ok(sample.duration > 0, 'wrote a positive duration for sample ' + i);
    ok(sample.size > 0, 'wrote a positive size for sample ' + i);
    ok(sample.compositionTimeOffset >= 0,
       'wrote a positive composition time offset for sample ' + i);
    ok(sample.flags, 'wrote sample flags');
    equal(sample.flags.isLeading, 0, 'the leading nature is unknown');
    notEqual(sample.flags.dependsOn, 0, 'sample dependency is not unknown');
    notEqual(sample.flags.dependsOn, 4, 'sample dependency is valid');
    equal(sample.flags.isDependedOn, 0, 'dependency of other samples is unknown');
    equal(sample.flags.hasRedundancy, 0, 'sample redundancy is unknown');
    equal(sample.flags.degradationPriority, 0, 'sample degradation priority is zero');
  }

  sdtp = track.boxes[3];
  equal(trun.samples.length,
        sdtp.samples.length,
        'wrote an equal number of trun and sdtp samples');
  for (i = 0; i < sdtp.samples.length; i++) {
    sample = sdtp.samples[i];
    notEqual(sample.dependsOn, 0, 'sample dependency is not unknown');
    equal(trun.samples[i].flags.dependsOn,
          sample.dependsOn,
          'wrote a consistent dependsOn');
    equal(trun.samples[i].flags.isDependedOn,
          sample.isDependedOn,
          'wrote a consistent isDependedOn');
    equal(trun.samples[i].flags.hasRedundancy,
          sample.hasRedundancy,
          'wrote a consistent hasRedundancy');
  }
};

test('parses an example mp2t file and generates media segments', function() {
  var
    segments = [],
    sequenceNumber = window.Infinity,
    i, boxes, mfhd;

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.push(window.bcSegment);
  transmuxer.end();

  equal(segments.length, 2, 'generated two segments');

  boxes = videojs.inspectMp4(segments[0].data);
  equal(boxes.length, 2, 'init segments are composed of two boxes');
  equal(boxes[0].type, 'ftyp', 'the first box is an ftyp');
  equal(boxes[1].type, 'moov', 'the second box is a moov');
  equal(boxes[1].boxes[0].type, 'mvhd', 'generated an mvhd');
  validateTrack(boxes[1].boxes[1], {
    trackId: 256,
    width: 388,
    height: 300
  });
  // validateTrack(boxes[1].boxes[2], {
  //   trackId: 257
  // });
  // equal(boxes[1].boxes[3].type, 'mvex', 'generated an mvex');

  boxes = videojs.inspectMp4(segments[1].data);
  ok(boxes.length > 0, 'media segments are not empty');
  ok(boxes.length % 2 === 0, 'media segments are composed of pairs of boxes');
  for (i = 0; i < boxes.length; i += 2) {
    equal(boxes[i].type, 'moof', 'first box is a moof');
    equal(boxes[i].boxes.length, 2, 'the moof has two children');

    mfhd = boxes[i].boxes[0];
    equal(mfhd.type, 'mfhd', 'mfhd is a child of the moof');
    ok(mfhd.sequenceNumber < sequenceNumber, 'sequence numbers are increasing');
    sequenceNumber = mfhd.sequenceNumber;

    validateTrackFragment(boxes[i].boxes[1], {
      trackId: 256,
      width: 388,
      height: 300
    });
    equal(boxes[i + 1].type, 'mdat', 'second box is an mdat');
  }
});

})(window, window.videojs);

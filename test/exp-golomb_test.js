(function(window) {
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
  buffer,
  ExpGolomb = window.videojs.Hls.ExpGolomb,
  expGolomb;

module('Exponential Golomb coding');

test('small numbers are coded correctly', function() {
  var
    expected = [
      [0xF8, 0],
      [0x5F, 1],
      [0x7F, 2],
      [0x27, 3],
      [0x2F, 4],
      [0x37, 5],
      [0x3F, 6],
      [0x11, 7],
      [0x13, 8],
      [0x15, 9]
    ],
    i = expected.length,
    result;

  while (i--) {
    buffer = new Uint8Array([expected[i][0]]);
    expGolomb = new ExpGolomb(buffer);
    result = expGolomb.readUnsignedExpGolomb();
    equal(expected[i][1], result, expected[i][0] + ' is decoded to ' + expected[i][1]);
  }
});

test('drops working data as it is parsed', function() {
  var expGolomb = new ExpGolomb(new Uint8Array([0x00, 0xFF]));
  expGolomb.skipBits(8);
  equal(8, expGolomb.bitsAvailable(), '8 bits remain');
  equal(0xFF, expGolomb.readBits(8), 'the second byte is read');
});

test('drops working data when skipping leading zeros', function() {
  var expGolomb = new ExpGolomb(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0xFF]));
  equal(32, expGolomb.skipLeadingZeros(), '32 leading zeros are dropped');
  equal(8, expGolomb.bitsAvailable(), '8 bits remain');
  equal(0xFF, expGolomb.readBits(8), 'the second byte is read');
});

test('drops working data when skipping leading zeros', function() {
  var expGolomb = new ExpGolomb(new Uint8Array([0x15, 0xab, 0x40, 0xc8, 0xFF]));
  equal(3, expGolomb.skipLeadingZeros(), '3 leading zeros are dropped');
  equal((8 * 4) + 5, expGolomb.bitsAvailable(), '37 bits remain');
  expGolomb.skipBits(1);
  equal(0x5a, expGolomb.readBits(8), 'the next bits are read');
});

test('parses a sequence parameter set', function() {
  var
    sps = new Uint8Array([
      0x27, 0x42, 0xe0, 0x0b,
      0xa9, 0x18, 0x60, 0x9d,
      0x80, 0x35, 0x06, 0x01,
      0x06, 0xb6, 0xc2, 0xb5,
      0xef, 0x7c, 0x04
    ]),
    expGolomb = new ExpGolomb(sps);

  strictEqual(expGolomb.readBits(8), 0x27, 'the NAL type specifies an SPS');
  strictEqual(expGolomb.readBits(8), 66, 'profile_idc is 66');
  strictEqual(expGolomb.readBits(4), 0x0E, 'constraints 0-3 are correct');

  expGolomb.skipBits(4);
  strictEqual(expGolomb.readBits(8), 11, 'level_idc is 11');
  strictEqual(expGolomb.readUnsignedExpGolomb(), 0, 'seq_parameter_set_id is 0');
  strictEqual(expGolomb.readUnsignedExpGolomb(), 1, 'log2_max_frame_num_minus4 is 1');
  strictEqual(expGolomb.readUnsignedExpGolomb(), 0, 'pic_order_cnt_type is 0');
  strictEqual(expGolomb.readUnsignedExpGolomb(), 3, 'log2_max_pic_order_cnt_lsb_minus4 is 3');
  strictEqual(expGolomb.readUnsignedExpGolomb(), 2, 'max_num_ref_frames is 2');
  strictEqual(expGolomb.readBits(1), 0, 'gaps_in_frame_num_value_allowed_flag is false');
  strictEqual(expGolomb.readUnsignedExpGolomb(), 11, 'pic_width_in_mbs_minus1 is 11');
  strictEqual(expGolomb.readUnsignedExpGolomb(), 8, 'pic_height_in_map_units_minus1 is 8');
  strictEqual(expGolomb.readBits(1), 1, 'frame_mbs_only_flag is true');
  strictEqual(expGolomb.readBits(1), 1, 'direct_8x8_inference_flag is true');
  strictEqual(expGolomb.readBits(1), 0, 'frame_cropping_flag is false');
});

})(this);

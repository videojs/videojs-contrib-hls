(function(videojs) {
module('H264 Stream');

var
  nalUnitTypes = window.videojs.Hls.NALUnitType,
  FlvTag = window.videojs.Hls.FlvTag;

test('metadata is generated for IDRs after a full NAL unit is written', function() {
  var
    h264Stream = new videojs.Hls.H264Stream(),
    accessUnitDelimiter = new Uint8Array([
      0x00,
      0x00,
      0x01,
      nalUnitTypes.access_unit_delimiter_rbsp
    ]),
    seqParamSet = new Uint8Array([
      0x00,
      0x00,
      0x01,
      0x60 | nalUnitTypes.seq_parameter_set_rbsp,
      0x00, // profile_idc
      0x00, // constraint_set flags
      0x00, // level_idc
      // seq_parameter_set_id ue(v) 0 => 1
      // log2_max_frame_num_minus4 ue(v) 1 => 010
      // pic_order_cnt_type ue(v) 0 => 1
      // log2_max_pic_order_cnt_lsb_minus4 ue(v) 1 => 010
      // max_num_ref_frames ue(v) 1 => 010
      // gaps_in_frame_num_value_allowed u(1) 0
      // pic_width_in_mbs_minus1 ue(v) 0 => 1
      // pic_height_in_map_units_minus1 ue(v) 0 => 1
      // frame_mbs_only_flag u(1) 1
      // direct_8x8_inference_flag u(1) 0
      // frame_cropping_flag u(1) 0
      // vui_parameters_present_flag u(1) 0
      // 1010 1010 0100 1110 00(00 0000)
      0xAA,
      0x4E,
      0x00
    ]),
    idr = new Uint8Array([
      0x00,
      0x00,
      0x01,
      nalUnitTypes.slice_layer_without_partitioning_rbsp_idr
    ]);

  h264Stream.setNextTimeStamp(0, 0, true);
  h264Stream.writeBytes(accessUnitDelimiter, 0, accessUnitDelimiter.byteLength);
  h264Stream.writeBytes(seqParamSet, 0, seqParamSet.byteLength);
  h264Stream.writeBytes(idr, 0, idr.byteLength);
  h264Stream.setNextTimeStamp(1, 1, true);

  strictEqual(h264Stream.tags.length, 3, 'three tags are written');
  ok(FlvTag.isMetaData(h264Stream.tags[0].bytes),
     'metadata is written');
  ok(FlvTag.isVideoFrame(h264Stream.tags[1].bytes),
     'picture parameter set is written');
  ok(h264Stream.tags[2].keyFrame, 'key frame is written');
});

test('starting PTS values can be negative', function() {
  var
    h264Stream = new videojs.Hls.H264Stream(),
    accessUnitDelimiter = new Uint8Array([
      0x00,
      0x00,
      0x01,
      nalUnitTypes.access_unit_delimiter_rbsp
    ]);

  h264Stream.setNextTimeStamp(-100, -100, true);
  h264Stream.writeBytes(accessUnitDelimiter, 0, accessUnitDelimiter.byteLength);
  h264Stream.setNextTimeStamp(-99, -99, true);
  h264Stream.writeBytes(accessUnitDelimiter, 0, accessUnitDelimiter.byteLength);
  h264Stream.setNextTimeStamp(0, 0, true);
  h264Stream.writeBytes(accessUnitDelimiter, 0, accessUnitDelimiter.byteLength);
  // flush out the last tag
  h264Stream.writeBytes(accessUnitDelimiter, 0, accessUnitDelimiter.byteLength);

  strictEqual(h264Stream.tags.length, 3, 'three tags are ready');
  strictEqual(h264Stream.tags[0].pts, 0, 'the first PTS is zero');
  strictEqual(h264Stream.tags[0].dts, 0, 'the first DTS is zero');
  strictEqual(h264Stream.tags[1].pts, 1, 'the second PTS is one');
  strictEqual(h264Stream.tags[1].dts, 1, 'the second DTS is one');

  strictEqual(h264Stream.tags[2].pts, 100, 'the third PTS is 100');
  strictEqual(h264Stream.tags[2].dts, 100, 'the third DTS is 100');
});

})(window.videojs);

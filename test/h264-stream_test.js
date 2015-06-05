(function(videojs) {
module('H264 Stream');

var
  nalUnitTypes = window.videojs.Hls.NALUnitType,
  FlvTag = window.videojs.Hls.FlvTag,

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
  ]);

test('metadata is generated for IDRs after a full NAL unit is written', function() {
  var
    h264Stream = new videojs.Hls.H264Stream(),
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

test('make sure we add metadata and extra data at the beginning of a stream', function() {
  var
    H264ExtraData = videojs.Hls.H264ExtraData,
    oldExtraData = H264ExtraData.prototype.extraDataTag,
    oldMetadata = H264ExtraData.prototype.metaDataTag,
    h264Stream;

  H264ExtraData.prototype.extraDataTag = function() {
    return 'extraDataTag';
  };
  H264ExtraData.prototype.metaDataTag = function() {
    return 'metaDataTag';
  };

  h264Stream = new videojs.Hls.H264Stream();

  h264Stream.setTimeStampOffset(0);
  h264Stream.setNextTimeStamp(0, 0, true);
  // the sps provides the metadata for the stream
  h264Stream.writeBytes(seqParamSet, 0, seqParamSet.byteLength);
  h264Stream.writeBytes(accessUnitDelimiter, 0, accessUnitDelimiter.byteLength);

  // make sure that keyFrame is set to false but that we don't have any tags currently written out
  h264Stream._h264Frame.keyFrame = false;
  h264Stream.tags = [];

  h264Stream.setNextTimeStamp(5, 5, true);
  h264Stream.writeBytes(accessUnitDelimiter, 0, accessUnitDelimiter.byteLength);
  // flush out the last tag
  h264Stream.writeBytes(accessUnitDelimiter, 0, accessUnitDelimiter.byteLength);

  strictEqual(h264Stream.tags.length, 4, 'three tags are ready');
  strictEqual(h264Stream.tags[0], 'metaDataTag', 'the first tag is the metaDataTag');
  strictEqual(h264Stream.tags[1], 'extraDataTag', 'the second tag is the extraDataTag');

  H264ExtraData.prototype.extraDataTag = oldExtraData;
  H264ExtraData.prototype.metaDataTag = oldMetadata;
});

})(window.videojs);

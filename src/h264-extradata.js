(function() {
  var
    H264ExtraData,
    ExpGolomb = window.videojs.Hls.ExpGolomb,
    FlvTag = window.videojs.Hls.FlvTag;

  window.videojs.Hls.H264ExtraData = H264ExtraData = function() {
    this.sps = []; // :Array
    this.pps = []; // :Array
  };

  H264ExtraData.prototype.extraDataExists = function() { // :Boolean
    return this.sps.length > 0;
  };

  // (sizeOfScalingList:int, expGolomb:ExpGolomb):void
  H264ExtraData.prototype.scaling_list = function(sizeOfScalingList, expGolomb) {
    var
      lastScale = 8, // :int
      nextScale = 8, // :int
      j,
      delta_scale; // :int

    for (j = 0; j < sizeOfScalingList; ++j) {
      if (0 !== nextScale) {
        delta_scale = expGolomb.readExpGolomb();
        nextScale = (lastScale + delta_scale + 256) % 256;
        //useDefaultScalingMatrixFlag = ( j = = 0 && nextScale = = 0 )
      }

      lastScale = (nextScale === 0) ? lastScale : nextScale;
      // scalingList[ j ] = ( nextScale == 0 ) ? lastScale : nextScale;
      // lastScale = scalingList[ j ]
    }
  };

  /**
   * RBSP: raw bit-stream payload. The actual encoded video data.
   *
   * SPS: sequence parameter set. Part of the RBSP. Metadata to be applied
   * to a complete video sequence, like width and height.
   */
  H264ExtraData.prototype.getSps0Rbsp = function() { // :ByteArray
    var
      sps = this.sps[0],
      offset = 1,
      start = 1,
      written = 0,
      end = sps.byteLength - 2,
      result = new Uint8Array(sps.byteLength);

    // In order to prevent 0x0000 01 from being interpreted as a
    // NAL start code, occurences of that byte sequence in the
    // RBSP are escaped with an "emulation byte". That turns
    // sequences of 0x0000 01 into 0x0000 0301. When interpreting
    // a NAL payload, they must be filtered back out.
    while (offset < end) {
      if (sps[offset]     === 0x00 &&
          sps[offset + 1] === 0x00 &&
          sps[offset + 2] === 0x03) {
        result.set(sps.subarray(start, offset + 1), written);
        written += offset + 1 - start;
        start = offset + 3;
      }
      offset++;
    }
    result.set(sps.subarray(start), written);
    return result.subarray(0, written + (sps.byteLength - start));
  };

  // (pts:uint):FlvTag
  H264ExtraData.prototype.metaDataTag = function(pts) {
    var
      tag = new FlvTag(FlvTag.METADATA_TAG), // :FlvTag
      expGolomb, // :ExpGolomb
      profile_idc, // :int
      chroma_format_idc, // :int
      imax, // :int
      i, // :int

      pic_order_cnt_type, // :int
      num_ref_frames_in_pic_order_cnt_cycle, // :uint

      pic_width_in_mbs_minus1, // :int
      pic_height_in_map_units_minus1, // :int

      frame_mbs_only_flag, // :int
      frame_cropping_flag, // :Boolean

      frame_crop_left_offset = 0, // :int
      frame_crop_right_offset = 0, // :int
      frame_crop_top_offset = 0, // :int
      frame_crop_bottom_offset = 0, // :int

      width,
      height;

      tag.dts = pts;
      tag.pts = pts;
      expGolomb = new ExpGolomb(this.getSps0Rbsp());

    // :int = expGolomb.readUnsignedByte(); // profile_idc u(8)
    profile_idc = expGolomb.readUnsignedByte();

    // constraint_set[0-5]_flag, u(1), reserved_zero_2bits u(2), level_idc u(8)
    expGolomb.skipBits(16);

    // seq_parameter_set_id
    expGolomb.skipUnsignedExpGolomb();

    if (profile_idc === 100 ||
        profile_idc === 110 ||
        profile_idc === 122 ||
        profile_idc === 244 ||
        profile_idc === 44 ||
        profile_idc === 83 ||
        profile_idc === 86 ||
        profile_idc === 118 ||
        profile_idc === 128) {
      chroma_format_idc = expGolomb.readUnsignedExpGolomb();
      if (3 === chroma_format_idc) {
        expGolomb.skipBits(1); // separate_colour_plane_flag
      }
      expGolomb.skipUnsignedExpGolomb(); // bit_depth_luma_minus8
      expGolomb.skipUnsignedExpGolomb(); // bit_depth_chroma_minus8
      expGolomb.skipBits(1); // qpprime_y_zero_transform_bypass_flag
      if (expGolomb.readBoolean()) { // seq_scaling_matrix_present_flag
        imax = (chroma_format_idc !== 3) ? 8 : 12;
        for (i = 0 ; i < imax ; ++i) {
          if (expGolomb.readBoolean()) { // seq_scaling_list_present_flag[ i ]
            if (i < 6) {
              this.scaling_list(16, expGolomb);
            } else {
              this.scaling_list(64, expGolomb);
            }
          }
        }
      }
    }

    expGolomb.skipUnsignedExpGolomb(); // log2_max_frame_num_minus4
    pic_order_cnt_type = expGolomb.readUnsignedExpGolomb();

    if ( 0 === pic_order_cnt_type ) {
      expGolomb.readUnsignedExpGolomb(); //log2_max_pic_order_cnt_lsb_minus4
    } else if ( 1 === pic_order_cnt_type ) {
      expGolomb.skipBits(1); // delta_pic_order_always_zero_flag
      expGolomb.skipExpGolomb(); // offset_for_non_ref_pic
      expGolomb.skipExpGolomb(); // offset_for_top_to_bottom_field
      num_ref_frames_in_pic_order_cnt_cycle = expGolomb.readUnsignedExpGolomb();
      for(i = 0 ; i < num_ref_frames_in_pic_order_cnt_cycle ; ++i) {
        expGolomb.skipExpGolomb(); // offset_for_ref_frame[ i ]
      }
    }

    expGolomb.skipUnsignedExpGolomb(); // max_num_ref_frames
    expGolomb.skipBits(1); // gaps_in_frame_num_value_allowed_flag
    pic_width_in_mbs_minus1 = expGolomb.readUnsignedExpGolomb();
    pic_height_in_map_units_minus1 = expGolomb.readUnsignedExpGolomb();

    frame_mbs_only_flag = expGolomb.readBits(1);
    if (0 === frame_mbs_only_flag) {
      expGolomb.skipBits(1); // mb_adaptive_frame_field_flag
    }

    expGolomb.skipBits(1); // direct_8x8_inference_flag
    frame_cropping_flag = expGolomb.readBoolean();
    if (frame_cropping_flag) {
      frame_crop_left_offset = expGolomb.readUnsignedExpGolomb();
      frame_crop_right_offset = expGolomb.readUnsignedExpGolomb();
      frame_crop_top_offset = expGolomb.readUnsignedExpGolomb();
      frame_crop_bottom_offset = expGolomb.readUnsignedExpGolomb();
    }

    width = ((pic_width_in_mbs_minus1 + 1) * 16) - frame_crop_left_offset * 2 - frame_crop_right_offset * 2;
    height = ((2 - frame_mbs_only_flag) * (pic_height_in_map_units_minus1 + 1) * 16) - (frame_crop_top_offset * 2) - (frame_crop_bottom_offset * 2);

    tag.writeMetaDataDouble("videocodecid", 7);
    tag.writeMetaDataDouble("width", width);
    tag.writeMetaDataDouble("height", height);
    // tag.writeMetaDataDouble("videodatarate", 0 );
    // tag.writeMetaDataDouble("framerate", 0);

    return tag;
  };

  // (pts:uint):FlvTag
  H264ExtraData.prototype.extraDataTag = function(pts) {
    var
      i,
      tag = new FlvTag(FlvTag.VIDEO_TAG, true);

    tag.dts = pts;
    tag.pts = pts;

    tag.writeByte(0x01);// version
    tag.writeByte(this.sps[0][1]);// profile
    tag.writeByte(this.sps[0][2]);// compatibility
    tag.writeByte(this.sps[0][3]);// level
    tag.writeByte(0xFC | 0x03); // reserved (6 bits), NULA length size - 1 (2 bits)
    tag.writeByte(0xE0 | 0x01 ); // reserved (3 bits), num of SPS (5 bits)
    tag.writeShort( this.sps[0].length ); // data of SPS
    tag.writeBytes( this.sps[0] ); // SPS

    tag.writeByte( this.pps.length ); // num of PPS (will there ever be more that 1 PPS?)
    for (i = 0 ; i < this.pps.length ; ++i) {
      tag.writeShort(this.pps[i].length); // 2 bytes for length of PPS
      tag.writeBytes(this.pps[i]); // data of PPS
    }

    return tag;
  };
})();

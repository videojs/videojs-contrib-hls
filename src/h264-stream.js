(function(window) {
  var
    ExpGolomb = window.videojs.Hls.ExpGolomb,
    FlvTag = window.videojs.Hls.FlvTag,

    H264ExtraData = function() {
      this.sps = []; // :Array
      this.pps = []; // :Array

      this.extraDataExists = function() { // :Boolean
        return this.sps.length > 0;
      };

      // (sizeOfScalingList:int, expGolomb:ExpGolomb):void
      this.scaling_list = function(sizeOfScalingList, expGolomb) {
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
      this.getSps0Rbsp = function() { // :ByteArray
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
      this.metaDataTag = function(pts) {
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
      this.extraDataTag = function(pts) {
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
    },

    NALUnitType;

  /**
   * Network Abstraction Layer (NAL) units are the packets of an H264
   * stream. NAL units are divided into types based on their payload
   * data. Each type has a unique numeric identifier.
   *
   *              NAL unit
   * |- NAL header -|------ RBSP ------|
   *
   * NAL unit: Network abstraction layer unit. The combination of a NAL
   * header and an RBSP.
   * NAL header: the encapsulation unit for transport-specific metadata in
   * an h264 stream. Exactly one byte.
   */
  // incomplete, see Table 7.1 of ITU-T H.264 for 12-32
  window.videojs.Hls.NALUnitType = NALUnitType = {
    unspecified: 0,
    slice_layer_without_partitioning_rbsp_non_idr: 1,
    slice_data_partition_a_layer_rbsp: 2,
    slice_data_partition_b_layer_rbsp: 3,
    slice_data_partition_c_layer_rbsp: 4,
    slice_layer_without_partitioning_rbsp_idr: 5,
    sei_rbsp: 6,
    seq_parameter_set_rbsp: 7,
    pic_parameter_set_rbsp: 8,
    access_unit_delimiter_rbsp: 9,
    end_of_seq_rbsp: 10,
    end_of_stream_rbsp: 11
  };

  window.videojs.Hls.H264Stream = function() {
    var
      next_pts, // :uint;
      next_dts, // :uint;
      pts_offset, // :int

      h264Frame, // :FlvTag

      oldExtraData = new H264ExtraData(), // :H264ExtraData
      newExtraData = new H264ExtraData(), // :H264ExtraData

      nalUnitType = -1, // :int

      state; // :uint;

    this.tags = [];

    //(pts:uint, dts:uint, dataAligned:Boolean):void
    this.setNextTimeStamp = function(pts, dts, dataAligned) {
      // on the first invocation, capture the starting PTS value
      pts_offset = pts;

      // on subsequent invocations, calculate the PTS based on the starting offset
      this.setNextTimeStamp = function(pts, dts, dataAligned) {
        // We could end up with a DTS less than 0 here. We need to deal with that!
        next_pts = pts - pts_offset;
        next_dts = dts - pts_offset;

        // If data is aligned, flush all internal buffers
        if (dataAligned) {
          this.finishFrame();
        }
      };

      this.setNextTimeStamp(pts, dts, dataAligned);
    };

    this.finishFrame = function() {
      if (h264Frame) {
        // Push SPS before EVERY IDR frame for seeking
        if (newExtraData.extraDataExists()) {
          oldExtraData = newExtraData;
          newExtraData = new H264ExtraData();
        }

        if (h264Frame.keyFrame) {
          // Push extra data on every IDR frame in case we did a stream change + seek
          this.tags.push(oldExtraData.metaDataTag(h264Frame.pts));
          this.tags.push(oldExtraData.extraDataTag(h264Frame.pts));
        }

        h264Frame.endNalUnit();
        this.tags.push(h264Frame);

      }

      h264Frame = null;
      nalUnitType = -1;
      state = 0;
    };

    // (data:ByteArray, o:int, l:int):void
    this.writeBytes = function(data, offset, length) {
      var
        nalUnitSize, // :uint
        start, // :uint
        end, // :uint
        t; // :int

      // default argument values
      offset = offset || 0;
      length = length || 0;

      if (length <= 0) {
        // data is empty so there's nothing to write
        return;
      }

      // scan through the bytes until we find the start code (0x000001) for a
      // NAL unit and then begin writing it out
      // strip NAL start codes as we go
      switch (state) {
      default:
        /* falls through */
      case 0:
        state = 1;
        /* falls through */
      case 1:
        // A NAL unit may be split across two TS packets. Look back a bit to
        // make sure the prefix of the start code wasn't already written out.
        if (data[offset] <= 1) {
          nalUnitSize = h264Frame ? h264Frame.nalUnitSize() : 0;
          if (nalUnitSize >= 1 && h264Frame.negIndex(1) === 0) {
            // ?? ?? 00 | O[01] ?? ??
            if (data[offset] === 1 &&
                nalUnitSize >= 2 &&
                h264Frame.negIndex(2) === 0) {
              // ?? 00 00 : 01
              if (3 <= nalUnitSize && 0 === h264Frame.negIndex(3)) {
                h264Frame.length -= 3; // 00 00 00 : 01
              } else {
                h264Frame.length -= 2; // 00 00 : 01
              }

              state = 3;
              return this.writeBytes(data, offset + 1, length - 1);
            }

            if (length > 1 && data[offset] === 0 && data[offset + 1] === 1) {
              // ?? 00 | 00 01
              if (nalUnitSize >= 2 && h264Frame.negIndex(2) === 0) {
                h264Frame.length -= 2; // 00 00 : 00 01
              } else {
                h264Frame.length -= 1; // 00 : 00 01
              }

              state = 3;
              return this.writeBytes(data, offset + 2, length - 2);
            }

            if (length > 2 &&
                data[offset] === 0 &&
                data[offset + 1] === 0 &&
                data[offset + 2] === 1) {
              // 00 : 00 00 01
              // h264Frame.length -= 1;
              state = 3;
              return this.writeBytes(data, offset + 3, length - 3);
            }
          }
        }
        // allow fall through if the above fails, we may end up checking a few
        // bytes a second time. But that case will be VERY rare
        state = 2;
        /* falls through */
      case 2:
        // Look for start codes in the data from the current offset forward
        start = offset;
        end = start + length;
        for (t = end - 3; offset < t;) {
          if (data[offset + 2] > 1) {
            // if data[offset + 2] is greater than 1, there is no way a start
            // code can begin before offset + 3
            offset += 3;
          } else if (data[offset + 1] !== 0) {
              offset += 2;
          } else if (data[offset] !== 0) {
              offset += 1;
          } else {
            // If we get here we have 00 00 00 or 00 00 01
            if (data[offset + 2] === 1) {
              if (offset > start) {
                h264Frame.writeBytes(data, start, offset - start);
              }
              state = 3;
              offset += 3;
              return this.writeBytes(data, offset, end - offset);
            }

            if (end - offset >= 4 &&
                data[offset + 2] === 0 &&
                data[offset + 3] === 1) {
              if (offset > start) {
                h264Frame.writeBytes(data, start, offset - start);
              }
              state = 3;
              offset += 4;
              return this.writeBytes(data, offset, end - offset);
            }

            // We are at the end of the buffer, or we have 3 NULLS followed by
            // something that is not a 1, either way we can step forward by at
            // least 3
            offset += 3;
          }
        }

        // We did not find any start codes. Try again next packet
        state = 1;
        if (h264Frame) {
          h264Frame.writeBytes(data, start, length);
        }
        return;
      case 3:
        // The next byte is the first byte of a NAL Unit

        if (h264Frame) {
          // we've come to a new NAL unit so finish up the one we've been
          // working on

          switch (nalUnitType) {
          case NALUnitType.seq_parameter_set_rbsp:
            h264Frame.endNalUnit(newExtraData.sps);
            break;
          case NALUnitType.pic_parameter_set_rbsp:
            h264Frame.endNalUnit(newExtraData.pps);
            break;
          case NALUnitType.slice_layer_without_partitioning_rbsp_idr:
            h264Frame.endNalUnit();
            break;
          default:
            h264Frame.endNalUnit();
            break;
          }
        }

        // setup to begin processing the new NAL unit
        nalUnitType = data[offset] & 0x1F;
        if (h264Frame) {
            if (nalUnitType === NALUnitType.access_unit_delimiter_rbsp) {
              // starting a new access unit, flush the previous one
              this.finishFrame();
            } else if (nalUnitType === NALUnitType.slice_layer_without_partitioning_rbsp_idr) {
              h264Frame.keyFrame = true;
            }
        }

        // finishFrame may render h264Frame null, so we must test again
        if (!h264Frame) {
          h264Frame = new FlvTag(FlvTag.VIDEO_TAG);
          h264Frame.pts = next_pts;
          h264Frame.dts = next_dts;
        }

        h264Frame.startNalUnit();
        // We know there will not be an overlapping start code, so we can skip
        // that test
        state = 2;
        return this.writeBytes(data, offset, length);
      } // switch
    };
  };
})(this);

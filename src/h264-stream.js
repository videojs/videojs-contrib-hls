/*
 * h264-stream
 * 
 *
 * Copyright (c) 2013 Brightcove
 * All rights reserved.
 */

(function(window) {
  var
    ExpGolomb = window.videojs.hls.ExpGolomb,
    FlvTag = window.videojs.hls.FlvTag,
    H264ExtraData = function() {
      var
        sps = [], // :Array
        pps = []; // :Array

      this.addSPS = function() { // :ByteArray
        var tmp = new Uint8Array(); // :ByteArray
        sps.push(tmp);
        return tmp;
      };

      this.addPPS = function() { // :ByteArray
        var tmp = new Uint8Array(); // :ByteArray
        pps.push(tmp);
        return tmp;
      };

      this.extraDataExists = function() { // :Boolean
        return 0 < sps.length;
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

      this.getSps0Rbsp = function() { // :ByteArray
        // remove emulation bytes. Is this nesessary? is there ever emulation bytes in the SPS?
        var
          sps0 = sps[0],// :ByteArray = sps[0];
          s, // :uint
          e, // :uint
          rbsp, // :ByteArray
          o; // :uint

        sps0.position      = 1;
        s = sps0.position;
        e = sps0.bytesAvailable - 2;
        rbsp = new Uint8Array(); // new ByteArray();

        for (o = s ; o < e ;) {
          if (3 !== sps0[o + 2]) {
            o += 3;
          } else if (0 !== sps0[o + 1]) {
            o += 2;
          } else if (0 !== sps0[o + 0]) {
            o += 1;
          } else { // found emulation bytess
            rbsp.writeShort(0x0000);

            if ( o > s ) {
              // If there are bytes to write, write them
              sps0.readBytes( rbsp, rbsp.length, o-s );
            }

            // skip the emulation bytes
            sps0.position += 3;
            o = s = sps0.position;
          }
        }

        // copy any remaining bytes
        sps0.readBytes(rbsp, rbsp.length);
        sps0.position = 0;
        return rbsp;
      };

      //(pts:uint):FlvTag
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

          frame_crop_left_offset, // :int
          frame_crop_right_offset, // :int
          frame_crop_top_offset, // :int
          frame_crop_bottom_offset, // :int

          width,
          height;

          tag.dts = pts;
          tag.pts = pts;
          expGolomb = new ExpGolomb(this.getSps0Rbsp());

        profile_idc = expGolomb.readUnsignedByte(); // :int = expGolomb.readUnsignedByte(); // profile_idc u(8)
        expGolomb.skipBits(16);// constraint_set[0-5]_flag, u(1), reserved_zero_2bits u(2), level_idc u(8)
        expGolomb.skipUnsignedExpGolomb(); // seq_parameter_set_id

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
          if ( expGolomb.readBoolean() ) { // seq_scaling_matrix_present_flag
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

        width = ((pic_width_in_mbs_minus1 +1)*16) - frame_crop_left_offset*2 - frame_crop_right_offset*2;
        height = ((2 - frame_mbs_only_flag)* (pic_height_in_map_units_minus1 +1) * 16) - (frame_crop_top_offset * 2) - (frame_crop_bottom_offset * 2);

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
          tag = new FlvTag(FlvTag.VIDEO_TAG,true);

        tag.dts = pts;
        tag.pts = pts;

        tag.writeByte(0x01);// version
        tag.writeByte(sps[0][1]);// profile
        tag.writeByte(sps[0][2]);// compatibility
        tag.writeByte(sps[0][3]);// level
        tag.writeByte(0xFC | 0x03); // reserved (6 bits), NULA length size - 1 (2 bits)
        tag.writeByte(0xE0 | 0x01 ); // reserved (3 bits), num of SPS (5 bits)
        tag.writeShort( sps[0].length ); // data of SPS
        tag.writeBytes( sps[0] ); // SPS

        tag.writeByte( pps.length ); // num of PPS (will there ever be more that 1 PPS?)
        for (i = 0 ; i < pps.length ; ++i) {
          tag.writeShort(pps[i].length); // 2 bytes for length of PPS
          tag.writeBytes(pps[i]); // data of PPS
        }

        return tag;
      };
    };

  window.videojs.hls.H264Stream = function() {
    var
      tags = [],

      next_pts, // :uint;
      next_dts, // :uint;
      pts_delta = -1, // :int

      h264Frame, // :FlvTag

      oldExtraData = new H264ExtraData(), // :H264ExtraData
      newExtraData = new H264ExtraData(), // :H264ExtraData
  
      nalUnitType = -1, // :int

      state; // :uint;
  
    this.tags = [];

    //(pts:uint, dts:uint, dataAligned:Boolean):void
    this.setNextTimeStamp = function(pts, dts, dataAligned) {
      if (0>pts_delta) {
        // We assume the very first pts is less than 0x8FFFFFFF (max signed 
        // int32)
        pts_delta = pts;
      }

      // We could end up with a DTS less than 0 here. We need to deal with that!
      next_pts = pts - pts_delta;
      next_dts = dts - pts_delta;

      // If data is aligned, flush all internal buffers
      if (dataAligned) {
        this.finishFrame();
      }
    };

    this.finishFrame = function() {
      if (null !== h264Frame) {
        // Push SPS before EVERY IDR frame fo seeking
        if (newExtraData.extraDataExists()) {
          oldExtraData = newExtraData;
          newExtraData = new H264ExtraData();
        }

        if(true === h264Frame.keyFrame) {
          // Push extra data on every IDR frame in case we did a stream change + seek
          tags.push( oldExtraData.metaDataTag (h264Frame.pts) );
          tags.push( oldExtraData.extraDataTag(h264Frame.pts) );
        }

        h264Frame.endNalUnit();
        tags.push(h264Frame);
      }

      h264Frame = null;
      nalUnitType = -1;
      state = 0;
    };

    // (pData:ByteArray, o:int, l:int):void
    this.writeBytes = function(pData, o, l) {
      var
        nalUnitSize, // :uint
        s, // :uint
        e, // :uint
        t; // :int

      if (0 >= l) {
        return;
      }
      switch (state) {
      default:
        state = 1;
        break;
      case 0:
        state = 1;
        break;
        /*--------------------------------------------------------------------------------------------------------------------*/
      case 1: // We are looking for overlaping start codes
        if (1 >= pData[o]) {
          nalUnitSize = (null === h264Frame) ? 0 : h264Frame.nalUnitSize();
          if (1 <= nalUnitSize && 0 === h264Frame.negIndex(1)) {
            // ?? ?? 00 | O[01] ?? ??
            if (1 === pData[o] && 2 <= nalUnitSize && 0 === h264Frame.negIndex(2) ) {
              // ?? 00 00 : 01
              if (3 <= nalUnitSize && 0 === h264Frame.negIndex(3)) {
                h264Frame.length -= 3; // 00 00 00 : 01
              } else {
                h264Frame.length -= 2; // 00 00 : 01
              }
              
              state = 3;
              return this.writeBytes(pData, o + 1, l - 1);
            }

            if (1 < l && 0 === pData[o] && 1 === pData[o + 1]) {
              // ?? 00 | 00 01
              if (2 <= nalUnitSize && 0 === h264Frame.negIndex(2)) {
                h264Frame.length -= 2; // 00 00 : 00 01
              } else {
                h264Frame.length -= 1; // 00 : 00 01
              }
              
              state = 3;
              return this.writeBytes(pData, o + 2, l - 2);
            }

            if (2 < l && 0 === pData[o] && 0 === pData[o + 1]  && 1 === pData[o + 2]) {
              // 00 | 00 00 01
              h264Frame.length -= 1;
              state = 3;
              return this.writeBytes(pData, o + 3, l - 3);
            }
          }
        }
        // allow fall through if the above fails, we may end up checking a few
        // bytes a second time. But that case will be VERY rare
        state = 2;
        break;
      case 2: // Look for start codes in pData
        s = o; // s = Start
        e = s + l; // e = End
        for (t = e - 3 ; o < t ;) {
          if (1 < pData[o + 2]) {
            o += 3; // if pData[o+2] is greater than 1, there is no way a start code can begin before o+3
          } else if (0 !== pData[o + 1]) {
              o += 2;
          } else if (0 !== pData[o]) {
              o += 1;
          } else {
            // If we get here we have 00 00 00 or 00 00 01
            if (1 === pData[o + 2]) {
              if (o > s) {
                h264Frame.writeBytes(pData, s, o - s);
              }
              state = 3; o += 3;
              return this.writeBytes(pData, o, e - o);
            }

            if (4 <= e-o && 0 === pData[o + 2] && 1 === pData[o + 3]) {
              if (o > s) {
                h264Frame.writeBytes(pData, s, o - s);
              }
              state = 3;
              o += 4;
              return this.writeBytes(pData, o, e - o);
            }

            // We are at the end of the buffer, or we have 3 NULLS followed by something that is not a 1, eaither way we can step forward by at least 3
            o += 3;
          }
        }

        // We did not find any start codes. Try again next packet
        state = 1;
        h264Frame.writeBytes( pData, s, l );
        return;
        /*--------------------------------------------------------------------------------------------------------------------*/
      case 3: // The next byte is the first byte of a NAL Unit
        if (null !== h264Frame) {
          switch (nalUnitType) {
            // We are still operating on the previous NAL Unit
          case  7:
            h264Frame.endNalUnit(newExtraData.addSPS());
            break;
          case  8:
            h264Frame.endNalUnit(newExtraData.addPPS());
            break;
          case  5:
            h264Frame.keyFrame = true;
            h264Frame.endNalUnit();
            break;
          default:
            h264Frame.endNalUnit();
            break;
          }
        }

        nalUnitType = pData[o] & 0x1F;
        if ( null != h264Frame && 9 === nalUnitType ) {
          this.finishFrame(); // We are starting a new access unit. Flush the previous one
        }

        // finishFrame may render h264Frame null, so we must test again
        if ( null === h264Frame )
        {
          h264Frame = new FlvTag(FlvTag.VIDEO_TAG);
          h264Frame.pts = next_pts;
          h264Frame.dts = next_dts;
        }

        h264Frame.startNalUnit();
        state = 2; // We know there will not be an overlapping start code, so we can skip that test
        return this.writeBytes(pData, o, l);
        /*--------------------------------------------------------------------------------------------------------------------*/
      } // switch
    };
  };
})(this);

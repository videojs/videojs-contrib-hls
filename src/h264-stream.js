(function(window) {
  var
    FlvTag = window.videojs.Hls.FlvTag,
    H264ExtraData = window.videojs.Hls.H264ExtraData,
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

    //(pts:uint):void
    this.setTimeStampOffset = function(pts) {
      pts_offset = pts;
    };

    //(pts:uint, dts:uint, dataAligned:Boolean):void
    this.setNextTimeStamp = function(pts, dts, dataAligned) {
      // We could end up with a DTS less than 0 here. We need to deal with that!
      next_pts = pts - pts_offset;
      next_dts = dts - pts_offset;

      // If data is aligned, flush all internal buffers
      if (dataAligned) {
        this.finishFrame();
      }
    };

    this.finishFrame = function() {
      if (h264Frame) {
        // Push SPS before EVERY IDR frame for seeking
        if (newExtraData.extraDataExists()) {
          oldExtraData = newExtraData;
          newExtraData = new H264ExtraData();
        }

        // Check if keyframe and the length of tags.
        // This makes sure we write metadata on the first frame of a segment.
        if (h264Frame.keyFrame || this.tags.length === 0) {
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

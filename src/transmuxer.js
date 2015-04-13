/**
 * video-js-hls
 *
 * Copyright (c) 2014 Brightcove
 * All rights reserved.
 */

/**
 * A stream-based mp2t to mp4 converter. This utility is used to
 * deliver mp4s to a SourceBuffer on platforms that support native
 * Media Source Extensions. The equivalent process for Flash-based
 * platforms can be found in segment-parser.js
 */
(function(window, videojs, undefined) {
'use strict';

var
  TransportPacketStream, TransportParseStream, ElementaryStream, VideoSegmentStream,
  AudioSegmentStream, Transmuxer, AacStream, H264Stream, NalByteStream,
  MP2T_PACKET_LENGTH, H264_STREAM_TYPE, ADTS_STREAM_TYPE,
  ADTS_SAMPLING_FREQUENCIES, mp4;

MP2T_PACKET_LENGTH = 188; // bytes
H264_STREAM_TYPE = 0x1b;
ADTS_STREAM_TYPE = 0x0f;
ADTS_SAMPLING_FREQUENCIES = [
  96000,
  88200,
  64000,
  48000,
  44100,
  32000,
  24000,
  22050,
  16000,
  12000,
  11025,
  8000,
  7350
];

mp4 = videojs.mp4;

/**
 * Splits an incoming stream of binary data into MPEG-2 Transport
 * Stream packets.
 */
TransportPacketStream = function() {
  var
    buffer = new Uint8Array(MP2T_PACKET_LENGTH),
    end = 0;

  TransportPacketStream.prototype.init.call(this);

  /**
   * Deliver new bytes to the stream.
   */
  this.push = function(bytes) {
    var remaining, i;

    // clear out any partial packets in the buffer
    if (end > 0) {
      remaining = MP2T_PACKET_LENGTH - end;
      buffer.set(bytes.subarray(0, remaining), end);

      // we still didn't write out a complete packet
      if (bytes.byteLength < remaining) {
        end += bytes.byteLength;
        return;
      }

      bytes = bytes.subarray(remaining);
      end = 0;
      this.trigger('data', buffer);
    }

    // if less than a single packet is available, buffer it up for later
    if (bytes.byteLength < MP2T_PACKET_LENGTH) {
      buffer.set(bytes.subarray(i), end);
      end += bytes.byteLength;
      return;
    }
    // parse out all the completed packets
    i = 0;
    do {
      this.trigger('data', bytes.subarray(i, i + MP2T_PACKET_LENGTH));
      i += MP2T_PACKET_LENGTH;
      remaining = bytes.byteLength - i;
    } while (i < bytes.byteLength && remaining >= MP2T_PACKET_LENGTH);
    // buffer any partial packets left over
    if (remaining > 0) {
      buffer.set(bytes.subarray(i));
      end = remaining;
    }
  };
};
TransportPacketStream.prototype = new videojs.Hls.Stream();

/**
 * Accepts an MP2T TransportPacketStream and emits data events with parsed
 * forms of the individual transport stream packets.
 */
TransportParseStream = function() {
  var parsePsi, parsePat, parsePmt, parsePes, self;
  TransportParseStream.prototype.init.call(this);
  self = this;

  this.programMapTable = {};

  parsePsi = function(payload, psi) {
    var offset = 0;

    // PSI packets may be split into multiple sections and those
    // sections may be split into multiple packets. If a PSI
    // section starts in this packet, the payload_unit_start_indicator
    // will be true and the first byte of the payload will indicate
    // the offset from the current position to the start of the
    // section.
    if (psi.payloadUnitStartIndicator) {
      offset += payload[offset] + 1;
    }

    if (psi.type === 'pat') {
      parsePat(payload.subarray(offset), psi);
    } else {
      parsePmt(payload.subarray(offset), psi);
    }
  };

  parsePat = function(payload, pat) {
    pat.section_number = payload[7];
    pat.last_section_number = payload[8];

    // skip the PSI header and parse the first PMT entry
    self.pmtPid = (payload[10] & 0x1F) << 8 | payload[11];
    pat.pmtPid = self.pmtPid;
  };

  /**
   * Parse out the relevant fields of a Program Map Table (PMT).
   * @param payload {Uint8Array} the PMT-specific portion of an MP2T
   * packet. The first byte in this array should be the table_id
   * field.
   * @param pmt {object} the object that should be decorated with
   * fields parsed from the PMT.
   */
  parsePmt = function(payload, pmt) {
    var sectionLength, tableEnd, programInfoLength, offset;

    // PMTs can be sent ahead of the time when they should actually
    // take effect. We don't believe this should ever be the case
    // for HLS but we'll ignore "forward" PMT declarations if we see
    // them. Future PMT declarations have the current_next_indicator
    // set to zero.
    if (!(payload[5] & 0x01)) {
      return;
    }

    // overwrite any existing program map table
    self.programMapTable = {};

    // the mapping table ends at the end of the current section
    sectionLength = (payload[1] & 0x0f) << 8 | payload[2];
    tableEnd = 3 + sectionLength - 4;

    // to determine where the table is, we have to figure out how
    // long the program info descriptors are
    programInfoLength = (payload[10] & 0x0f) << 8 | payload[11];

    // advance the offset to the first entry in the mapping table
    offset = 12 + programInfoLength;
    while (offset < tableEnd) {
      // add an entry that maps the elementary_pid to the stream_type
      self.programMapTable[(payload[offset + 1] & 0x1F) << 8 | payload[offset + 2]] = payload[offset];

      // move to the next table entry
      // skip past the elementary stream descriptors, if present
      offset += ((payload[offset + 3] & 0x0F) << 8 | payload[offset + 4]) + 5;
    }

    // record the map on the packet as well
    pmt.programMapTable = self.programMapTable;
  };

  parsePes = function(payload, pes) {
    var ptsDtsFlags;

    if (!pes.payloadUnitStartIndicator) {
      pes.data = payload;
      return;
    }

    // find out if this packets starts a new keyframe
    pes.dataAlignmentIndicator = (payload[6] & 0x04) !== 0;
    // PES packets may be annotated with a PTS value, or a PTS value
    // and a DTS value. Determine what combination of values is
    // available to work with.
    ptsDtsFlags = payload[7];

    // PTS and DTS are normally stored as a 33-bit number.  Javascript
    // performs all bitwise operations on 32-bit integers but it's
    // convenient to convert from 90ns to 1ms time scale anyway. So
    // what we are going to do instead is drop the least significant
    // bit (in effect, dividing by two) then we can divide by 45 (45 *
    // 2 = 90) to get ms.
    if (ptsDtsFlags & 0xC0) {
      // the PTS and DTS are not written out directly. For information
      // on how they are encoded, see
      // http://dvd.sourceforge.net/dvdinfo/pes-hdr.html
      pes.pts = (payload[9] & 0x0E) << 28
        | (payload[10] & 0xFF) << 21
        | (payload[11] & 0xFE) << 13
        | (payload[12] & 0xFF) <<  6
        | (payload[13] & 0xFE) >>>  2;
      pes.pts /= 45;
      pes.dts = pes.pts;
      if (ptsDtsFlags & 0x40) {
        pes.dts = (payload[14] & 0x0E ) << 28
          | (payload[15] & 0xFF ) << 21
          | (payload[16] & 0xFE ) << 13
          | (payload[17] & 0xFF ) << 6
          | (payload[18] & 0xFE ) >>> 2;
        pes.dts /= 45;
      }
    }

    // the data section starts immediately after the PES header.
    // pes_header_data_length specifies the number of header bytes
    // that follow the last byte of the field.
    pes.data = payload.subarray(9 + payload[8]);
  };

  /**
   * Deliver a new MP2T packet to the stream.
   */
  this.push = function(packet) {
    var
      result = {},
      offset = 4;
    // make sure packet is aligned on a sync byte
    if (packet[0] !== 0x47) {
      return this.trigger('error', 'mis-aligned packet');
    }
    result.payloadUnitStartIndicator = !!(packet[1] & 0x40);

    // pid is a 13-bit field starting at the last bit of packet[1]
    result.pid = packet[1] & 0x1f;
    result.pid <<= 8;
    result.pid |= packet[2];

    // if an adaption field is present, its length is specified by the
    // fifth byte of the TS packet header. The adaptation field is
    // used to add stuffing to PES packets that don't fill a complete
    // TS packet, and to specify some forms of timing and control data
    // that we do not currently use.
    if (((packet[3] & 0x30) >>> 4) > 0x01) {
      offset += packet[offset] + 1;
    }

    // parse the rest of the packet based on the type
    if (result.pid === 0) {
      result.type = 'pat';
      parsePsi(packet.subarray(offset), result);
    } else if (result.pid === this.pmtPid) {
      result.type = 'pmt';
      parsePsi(packet.subarray(offset), result);
    } else {
      result.streamType = this.programMapTable[result.pid];
      result.type = 'pes';
      parsePes(packet.subarray(offset), result);
    }

    this.trigger('data', result);
  };
};
TransportParseStream.prototype = new videojs.Hls.Stream();
TransportParseStream.STREAM_TYPES  = {
  h264: 0x1b,
  adts: 0x0f
};

/**
 * Reconsistutes program elementary stream (PES) packets from parsed
 * transport stream packets. That is, if you pipe an
 * mp2t.TransportParseStream into a mp2t.ElementaryStream, the output
 * events will be events which capture the bytes for individual PES
 * packets plus relevant metadata that has been extracted from the
 * container.
 */
ElementaryStream = function() {
  var
    // PES packet fragments
    video = {
      data: [],
      size: 0
    },
    audio = {
      data: [],
      size: 0
    },
    flushStream = function(stream, type) {
      var
        event = {
          type: type,
          data: new Uint8Array(stream.size),
        },
        i = 0,
        fragment;

      // do nothing if there is no buffered data
      if (!stream.data.length) {
        return;
      }
      event.trackId = stream.data[0].pid;
      event.pts = stream.data[0].pts;
      event.dts = stream.data[0].dts;

      // reassemble the packet
      while (stream.data.length) {
        fragment = stream.data.shift();

        event.data.set(fragment.data, i);
        i += fragment.data.byteLength;
      }
      stream.size = 0;

      self.trigger('data', event);
    },
    self;

  ElementaryStream.prototype.init.call(this);
  self = this;

  this.push = function(data) {
    ({
      pat: function() {
        // we have to wait for the PMT to arrive as well before we
        // have any meaningful metadata
      },
      pes: function() {
        var stream, streamType;

        switch (data.streamType) {
        case H264_STREAM_TYPE:
          stream = video;
          streamType = 'video';
          break;
        case ADTS_STREAM_TYPE:
          stream = audio;
          streamType = 'audio';
          break;
        default:
          // ignore unknown stream types
          return;
        }

        // if a new packet is starting, we can flush the completed
        // packet
        if (data.payloadUnitStartIndicator) {
          flushStream(stream, streamType);
        }

        // buffer this fragment until we are sure we've received the
        // complete payload
        stream.data.push(data);
        stream.size += data.data.byteLength;
      },
      pmt: function() {
        var
          event = {
            type: 'metadata',
            tracks: []
          },
          programMapTable = data.programMapTable,
          k,
          track;

        // translate streams to tracks
        for (k in programMapTable) {
          if (programMapTable.hasOwnProperty(k)) {
            track = {};
            track.id = +k;
            if (programMapTable[k] === H264_STREAM_TYPE) {
              track.codec = 'avc';
              track.type = 'video';
            } else if (programMapTable[k] === ADTS_STREAM_TYPE) {
              track.codec = 'adts';
              track.type = 'audio';
            }
            event.tracks.push(track);
          }
        }
        self.trigger('data', event);
      }
    })[data.type]();
  };

  /**
   * Flush any remaining input. Video PES packets may be of variable
   * length. Normally, the start of a new video packet can trigger the
   * finalization of the previous packet. That is not possible if no
   * more video is forthcoming, however. In that case, some other
   * mechanism (like the end of the file) has to be employed. When it is
   * clear that no additional data is forthcoming, calling this method
   * will flush the buffered packets.
   */
  this.end = function() {
    flushStream(video, 'video');
    flushStream(audio, 'audio');
  };
};
ElementaryStream.prototype = new videojs.Hls.Stream();

/*
 * Accepts a ElementaryStream and emits data events with parsed
 * AAC Audio Frames of the individual packets. Input audio in ADTS
 * format is unpacked and re-emitted as AAC frames.
 *
 * @see http://wiki.multimedia.cx/index.php?title=ADTS
 * @see http://wiki.multimedia.cx/?title=Understanding_AAC
 */
AacStream = function() {
  var i = 1, self, buffer;
  AacStream.prototype.init.call(this);
  self = this;

  this.push = function(packet) {
    var frameLength;

    if (packet.type !== 'audio') {
      // ignore non-audio data
      return;
    }

    buffer = packet.data;

    // unpack any ADTS frames which have been fully received
    while (i + 4 < buffer.length) {
      // frame length is a 13 bit integer starting 16 bits from the
      // end of the sync sequence
      frameLength = ((buffer[i + 2] & 0x03) << 11) |
        (buffer[i + 3] << 3) |
        ((buffer[i + 4] & 0xe0) >> 5);

      // deliver the AAC frame
      this.trigger('data', {
        channelcount: ((buffer[i + 1] & 1) << 3) |
          ((buffer[i + 2] & 0xc0) >> 6),
        samplerate: ADTS_SAMPLING_FREQUENCIES[(buffer[i + 1] & 0x3c) >> 2],
        // assume ISO/IEC 14496-12 AudioSampleEntry default of 16
        samplesize: 16,
        data: buffer.subarray(i + 6, i + frameLength - 1)
      });

      // flush the finished frame and try again
      buffer = buffer.subarray(i + frameLength - 1);
      i = 1;
    }
  };
};
AacStream.prototype = new videojs.Hls.Stream();

/**
 * Constructs a single-track, ISO BMFF media segment from AAC data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 */
// TODO: share common code with VideoSegmentStream
AudioSegmentStream = function(track) {
  var aacFrames = [], aacFramesLength = 0, sequenceNumber = 0;
  AudioSegmentStream.prototype.init.call(this);

  this.push = function(data) {
    // buffer audio data until end() is called
    aacFrames.push(data);
    aacFramesLength += data.data.byteLength;
  };

  this.end = function() {
    var boxes, currentFrame, data, sample, i, mdat, moof;
    // return early if no audio data has been observed
    if (aacFramesLength === 0) {
      return;
    }

    // concatenate the audio data to constuct the mdat
    data = new Uint8Array(aacFramesLength);
    track.samples = [];
    i = 0;
    while (aacFrames.length) {
      currentFrame = aacFrames[0];
      sample = {
        size: currentFrame.data.byteLength,
        duration: 1024 // FIXME calculate for realz
      };
      track.samples.push(sample);

      data.set(currentFrame.data, i);
      i += currentFrame.data.byteLength;

      aacFrames.shift();
    }
    aacFramesLength = 0;
    mdat = mp4.mdat(data);

    moof = mp4.moof(sequenceNumber, [track]);
    boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

    // bump the sequence number for next time
    sequenceNumber++;

    boxes.set(moof);
    boxes.set(mdat, moof.byteLength);

    this.trigger('data', boxes);
  };
};
AudioSegmentStream.prototype = new videojs.Hls.Stream();

/**
 * Accepts a NAL unit byte stream and unpacks the embedded NAL units.
 */
NalByteStream = function() {
  var
    i = 6,
    syncPoint = 1,
    buffer;
  NalByteStream.prototype.init.call(this);

  this.push = function(data) {
    var swapBuffer;

    if (!buffer) {
      buffer = data.data;
    } else {
      swapBuffer = new Uint8Array(buffer.byteLength + data.data.byteLength);
      swapBuffer.set(buffer);
      swapBuffer.set(data.data, buffer.byteLength);
      buffer = swapBuffer;
    }

    // Rec. ITU-T H.264, Annex B
    // scan for NAL unit boundaries

    // a match looks like this:
    // 0 0 1 .. NAL .. 0 0 1
    // ^ sync point        ^ i
    // or this:
    // 0 0 1 .. NAL .. 0 0 0
    // ^ sync point        ^ i
    while (i < buffer.byteLength) {
      // look at the current byte to determine if we've hit the end of
      // a NAL unit boundary
      switch (buffer[i]) {
      case 0:
        // skip past non-sync sequences
        if (buffer[i - 1] !== 0) {
          i += 2;
          break;
        } else if (buffer[i - 2] !== 0) {
          i++;
          break;
        }

        // deliver the NAL unit
        this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));

        // drop trailing zeroes
        do {
          i++;
        } while (buffer[i] !== 1);
        syncPoint = i - 2;
        i += 3;
        break;
      case 1:
        // skip past non-sync sequences
        if (buffer[i - 1] !== 0 ||
            buffer[i - 2] !== 0) {
          i += 3;
          break;
        }

        // deliver the NAL unit
        this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));
        syncPoint = i - 2;
        i += 3;
        break;
      default:
        // the current byte isn't a one or zero, so it cannot be part
        // of a sync sequence
        i += 3;
        break;
      }
    }
    // filter out the NAL units that were delivered
    buffer = buffer.subarray(syncPoint);
    i -= syncPoint;
    syncPoint = 0;
  };

  this.end = function() {
    // deliver the last buffered NAL unit
    if (buffer && buffer.byteLength > 3) {
      this.trigger('data', buffer.subarray(syncPoint + 3));
    }
  };
};
NalByteStream.prototype = new videojs.Hls.Stream();

/**
 * Accepts input from a ElementaryStream and produces H.264 NAL unit data
 * events.
 */
H264Stream = function() {
  var
    nalByteStream = new NalByteStream(),
    self,
    trackId,
    currentPts,
    currentDts,

    readSequenceParameterSet,
    skipScalingList;

  H264Stream.prototype.init.call(this);
  self = this;

  this.push = function(packet) {
    if (packet.type !== 'video') {
      return;
    }
    trackId = packet.trackId;
    currentPts = packet.pts;
    currentDts = packet.dts;

    nalByteStream.push(packet);
  };

  nalByteStream.on('data', function(data) {
    var event = {
      trackId: trackId,
      pts: currentPts,
      dts: currentDts,
      data: data
    };
    switch (data[0] & 0x1f) {

    case 0x05:
      event.nalUnitType = 'slice_layer_without_partitioning_rbsp_idr';
      break;
    case 0x07:
      event.nalUnitType = 'seq_parameter_set_rbsp';
      event.config = readSequenceParameterSet(data.subarray(1));
      break;
    case 0x08:
      event.nalUnitType = 'pic_parameter_set_rbsp';
      break;
    case 0x09:
      event.nalUnitType = 'access_unit_delimiter_rbsp';
      break;

    default:
      break;
    }
    self.trigger('data', event);
  });

  this.end = function() {
    nalByteStream.end();
  };

  /**
   * Advance the ExpGolomb decoder past a scaling list. The scaling
   * list is optionally transmitted as part of a sequence parameter
   * set and is not relevant to transmuxing.
   * @param count {number} the number of entries in this scaling list
   * @param expGolombDecoder {object} an ExpGolomb pointed to the
   * start of a scaling list
   * @see Recommendation ITU-T H.264, Section 7.3.2.1.1.1
   */
  skipScalingList = function(count, expGolombDecoder) {
    var
      lastScale = 8,
      nextScale = 8,
      j,
      deltaScale;

    for (j = 0; j < count; j++) {
      if (nextScale !== 0) {
        deltaScale = expGolombDecoder.readExpGolomb();
        nextScale = (lastScale + deltaScale + 256) % 256;
      }

      lastScale = (nextScale === 0) ? lastScale : nextScale;
    }
  };

  /**
   * Read a sequence parameter set and return some interesting video
   * properties. A sequence parameter set is the H264 metadata that
   * describes the properties of upcoming video frames.
   * @param data {Uint8Array} the bytes of a sequence parameter set
   * @return {object} an object with configuration parsed from the
   * sequence parameter set, including the dimensions of the
   * associated video frames.
   */
  readSequenceParameterSet = function(data) {
    var
      frameCropLeftOffset = 0,
      frameCropRightOffset = 0,
      frameCropTopOffset = 0,
      frameCropBottomOffset = 0,
      expGolombDecoder, profileIdc, levelIdc, profileCompatibility,
      chromaFormatIdc, picOrderCntType,
      numRefFramesInPicOrderCntCycle, picWidthInMbsMinus1,
      picHeightInMapUnitsMinus1,
      frameMbsOnlyFlag,
      scalingListCount,
      i;

    expGolombDecoder = new videojs.Hls.ExpGolomb(data);
    profileIdc = expGolombDecoder.readUnsignedByte(); // profile_idc
    profileCompatibility = expGolombDecoder.readBits(5); // constraint_set[0-5]_flag
    expGolombDecoder.skipBits(3); //  u(1), reserved_zero_2bits u(2)
    levelIdc = expGolombDecoder.readUnsignedByte(); // level_idc u(8)
    expGolombDecoder.skipUnsignedExpGolomb(); // seq_parameter_set_id

    // some profiles have more optional data we don't need
    if (profileIdc === 100 ||
        profileIdc === 110 ||
        profileIdc === 122 ||
        profileIdc === 244 ||
        profileIdc === 44 ||
        profileIdc === 83 ||
        profileIdc === 86 ||
        profileIdc === 118 ||
        profileIdc === 128) {
      chromaFormatIdc = expGolombDecoder.readUnsignedExpGolomb();
      if (chromaFormatIdc === 3) {
        expGolombDecoder.skipBits(1); // separate_colour_plane_flag
      }
      expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_luma_minus8
      expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_chroma_minus8
      expGolombDecoder.skipBits(1); // qpprime_y_zero_transform_bypass_flag
      if (expGolombDecoder.readBoolean()) { // seq_scaling_matrix_present_flag
        scalingListCount = (chromaFormatIdc !== 3) ? 8 : 12;
        for (i = 0; i < scalingListCount; i++) {
          if (expGolombDecoder.readBoolean()) { // seq_scaling_list_present_flag[ i ]
            if (i < 6) {
              skipScalingList(16, expGolombDecoder);
            } else {
              skipScalingList(64, expGolombDecoder);
            }
          }
        }
      }
    }

    expGolombDecoder.skipUnsignedExpGolomb(); // log2_max_frame_num_minus4
    picOrderCntType = expGolombDecoder.readUnsignedExpGolomb();

    if (picOrderCntType === 0) {
      expGolombDecoder.readUnsignedExpGolomb(); //log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      expGolombDecoder.skipBits(1); // delta_pic_order_always_zero_flag
      expGolombDecoder.skipExpGolomb(); // offset_for_non_ref_pic
      expGolombDecoder.skipExpGolomb(); // offset_for_top_to_bottom_field
      numRefFramesInPicOrderCntCycle = expGolombDecoder.readUnsignedExpGolomb();
      for(i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
        expGolombDecoder.skipExpGolomb(); // offset_for_ref_frame[ i ]
      }
    }

    expGolombDecoder.skipUnsignedExpGolomb(); // max_num_ref_frames
    expGolombDecoder.skipBits(1); // gaps_in_frame_num_value_allowed_flag

    picWidthInMbsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
    picHeightInMapUnitsMinus1 = expGolombDecoder.readUnsignedExpGolomb();

    frameMbsOnlyFlag = expGolombDecoder.readBits(1);
    if (frameMbsOnlyFlag === 0) {
      expGolombDecoder.skipBits(1); // mb_adaptive_frame_field_flag
    }

    expGolombDecoder.skipBits(1); // direct_8x8_inference_flag
    if (expGolombDecoder.readBoolean()) { // frame_cropping_flag
      frameCropLeftOffset = expGolombDecoder.readUnsignedExpGolomb();
      frameCropRightOffset = expGolombDecoder.readUnsignedExpGolomb();
      frameCropTopOffset = expGolombDecoder.readUnsignedExpGolomb();
      frameCropBottomOffset = expGolombDecoder.readUnsignedExpGolomb();
    }

    return {
      profileIdc: profileIdc,
      levelIdc: levelIdc,
      profileCompatibility: profileCompatibility,
      width: ((picWidthInMbsMinus1 + 1) * 16) - frameCropLeftOffset * 2 - frameCropRightOffset * 2,
      height: ((2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16) - (frameCropTopOffset * 2) - (frameCropBottomOffset * 2)
    };
  };

};
H264Stream.prototype = new videojs.Hls.Stream();

/**
 * Constructs a single-track, ISO BMFF media segment from H264 data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 * @param track {object} track metadata configuration
 */
VideoSegmentStream = function(track) {
  var
    sequenceNumber = 0,
    nalUnits = [],
    nalUnitsLength = 0;
  VideoSegmentStream.prototype.init.call(this);

  this.push = function(data) {
    // buffer video until end() is called
    nalUnits.push(data);
    nalUnitsLength += data.data.byteLength;
  };

  this.end = function() {
    var startUnit, currentNal, moof, mdat, boxes, i, data, view, sample;

    // return early if no video data has been observed
    if (nalUnitsLength === 0) {
      return;
    }

    // concatenate the video data and construct the mdat
    // first, we have to build the index from byte locations to
    // samples (that is, frames) in the video data
    data = new Uint8Array(nalUnitsLength + (4 * nalUnits.length));
    view = new DataView(data.buffer);
    track.samples = [];

    // see ISO/IEC 14496-12:2012, section 8.6.4.3
    sample = {
      size: 0,
      flags: {
        isLeading: 0,
        dependsOn: 1,
        isDependedOn: 0,
        hasRedundancy: 0,
        degradationPriority: 0
      }
    };
    i = 0;
    while (nalUnits.length) {
      currentNal = nalUnits[0];
      // flush the sample we've been building when a new sample is started
      if (currentNal.nalUnitType === 'access_unit_delimiter_rbsp') {
        if (startUnit) {
          // convert the duration to 90kHZ timescale to match the
          // timescales specified in the init segment
          sample.duration = (currentNal.dts - startUnit.dts) * 90;
          track.samples.push(sample);
        }
        sample = {
          size: 0,
          flags: {
            isLeading: 0,
            dependsOn: 1,
            isDependedOn: 0,
            hasRedundancy: 0,
            degradationPriority: 0
          },
          compositionTimeOffset: currentNal.pts - currentNal.dts
        };
        startUnit = currentNal;
      }
      if (currentNal.nalUnitType === 'slice_layer_without_partitioning_rbsp_idr') {
        // the current sample is a key frame
        sample.flags.dependsOn = 2;
      }
      sample.size += 4; // space for the NAL length
      sample.size += currentNal.data.byteLength;

      view.setUint32(i, currentNal.data.byteLength);
      i += 4;
      data.set(currentNal.data, i);
      i += currentNal.data.byteLength;

      nalUnits.shift();
    }
    // record the last sample
    if (track.samples.length) {
      sample.duration = track.samples[track.samples.length - 1].duration;
    }
    track.samples.push(sample);
    nalUnitsLength = 0;
    mdat = mp4.mdat(data);

    moof = mp4.moof(sequenceNumber, [track]);

    // it would be great to allocate this array up front instead of
    // throwing away hundreds of media segment fragments
    boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

    // bump the sequence number for next time
    sequenceNumber++;

    boxes.set(moof);
    boxes.set(mdat, moof.byteLength);

    this.trigger('data', boxes);
  };
};
VideoSegmentStream.prototype = new videojs.Hls.Stream();

/**
 * A Stream that expects MP2T binary data as input and produces
 * corresponding media segments, suitable for use with Media Source
 * Extension (MSE) implementations that support the ISO BMFF byte
 * stream format, like Chrome.
 * @see test/muxer/mse-demo.html for sample usage of a Transmuxer with
 * MSE
 */
Transmuxer = function() {
  var
    self = this,
    videoTrack,
    audioTrack,
    config,
    pps,

    packetStream, parseStream, elementaryStream,
    aacStream, h264Stream,
    videoSegmentStream, audioSegmentStream;

  Transmuxer.prototype.init.call(this);

  // set up the parsing pipeline
  packetStream = new TransportPacketStream();
  parseStream = new TransportParseStream();
  elementaryStream = new ElementaryStream();
  aacStream = new AacStream();
  h264Stream = new H264Stream();

  packetStream.pipe(parseStream);
  parseStream.pipe(elementaryStream);
  elementaryStream.pipe(aacStream);
  elementaryStream.pipe(h264Stream);

  // handle incoming data events
  h264Stream.on('data', function(data) {
    // record the track config
    if (data.nalUnitType === 'seq_parameter_set_rbsp' &&
        !config) {
      config = data.config;

      videoTrack.width = config.width;
      videoTrack.height = config.height;
      videoTrack.sps = [data.data];
      videoTrack.profileIdc = config.profileIdc;
      videoTrack.levelIdc = config.levelIdc;
      videoTrack.profileCompatibility = config.profileCompatibility;

      // generate an init segment once all the metadata is available
      if (pps) {
        self.trigger('data', {
          type: 'video',
          data: videojs.mp4.initSegment([videoTrack])
        });
      }
    }
    if (data.nalUnitType === 'pic_parameter_set_rbsp' &&
        !pps) {
      pps = data.data;
      videoTrack.pps = [data.data];

      if (config) {
        self.trigger('data', {
          type: 'video',
          data: videojs.mp4.initSegment([videoTrack])
        });
      }
    }
  });
  // generate an init segment based on the first audio sample
  aacStream.on('data', function(data) {
    if (audioTrack && audioTrack.channelcount === undefined) {
      audioTrack.channelcount = data.channelcount;
      audioTrack.samplerate = data.samplerate;
      audioTrack.samplesize = data.samplesize;
      self.trigger('data', {
        type: 'audio',
        data: videojs.mp4.initSegment([audioTrack])
      });
    }
  });
  // hook up the segment streams once track metadata is delivered
  elementaryStream.on('data', function(data) {
    var i, triggerData = function(type) {
      return function(segment) {
        self.trigger('data', {
          type: type,
          data: segment
        });
      };
    };
    if (data.type === 'metadata') {
      i = data.tracks.length;

      // scan the tracks listed in the metadata
      while (i--) {

        // hook up the video segment stream to the first track with h264 data
        if (data.tracks[i].type === 'video' && !videoSegmentStream) {
          videoTrack = data.tracks[i];
          videoSegmentStream = new VideoSegmentStream(videoTrack);
          h264Stream.pipe(videoSegmentStream);
          videoSegmentStream.on('data', triggerData('video'));
          break;
        }

        // hook up the audio segment stream to the first track with aac data
        if (data.tracks[i].type === 'audio' && !audioSegmentStream) {
          audioTrack = data.tracks[i];
          audioSegmentStream = new AudioSegmentStream(audioTrack);
          aacStream.pipe(audioSegmentStream);
          audioSegmentStream.on('data', triggerData('audio'));
        }
      }
    }
  });

  // feed incoming data to the front of the parsing pipeline
  this.push = function(data) {
    packetStream.push(data);
  };
  // flush any buffered data
  this.end = function() {
    elementaryStream.end();
    h264Stream.end();
    videoSegmentStream.end();
    audioSegmentStream.end();
  };
};
Transmuxer.prototype = new videojs.Hls.Stream();

window.videojs.mp2t = {
  PAT_PID: 0x0000,
  MP2T_PACKET_LENGTH: MP2T_PACKET_LENGTH,
  H264_STREAM_TYPE: H264_STREAM_TYPE,
  ADTS_STREAM_TYPE: ADTS_STREAM_TYPE,
  TransportPacketStream: TransportPacketStream,
  TransportParseStream: TransportParseStream,
  ElementaryStream: ElementaryStream,
  VideoSegmentStream: VideoSegmentStream,
  Transmuxer: Transmuxer,
  AacStream: AacStream,
  H264Stream: H264Stream
};
})(window, window.videojs);

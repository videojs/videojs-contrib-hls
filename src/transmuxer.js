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

var PacketStream, ParseStream, ProgramStream, Transmuxer, AacStream, H264Stream, MP2T_PACKET_LENGTH, H264_STREAM_TYPE, ADTS_STREAM_TYPE, mp4;

MP2T_PACKET_LENGTH = 188; // bytes
H264_STREAM_TYPE = 0x1b;
ADTS_STREAM_TYPE = 0x0f;
mp4 = videojs.mp4;

/**
 * Splits an incoming stream of binary data into MP2T packets.
 */
PacketStream = function() {
  var
    buffer = new Uint8Array(MP2T_PACKET_LENGTH),
    end = 0;

  PacketStream.prototype.init.call(this);

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
PacketStream.prototype = new videojs.Hls.Stream();

/**
 * Accepts an MP2T PacketStream and emits data events with parsed
 * forms of the individual packets.
 */
ParseStream = function() {
  var parsePsi, parsePat, parsePmt, parsePes, self;
  ParseStream.prototype.init.call(this);
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
    var tableEnd, programInfoLength, offset;

    pmt.section_number = payload[6];
    pmt.last_section_number = payload[7];

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

    // the mapping table ends right before the 32-bit CRC
    tableEnd = payload.byteLength - 4;
    // to determine where the table starts, we have to figure out how
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
ParseStream.prototype = new videojs.Hls.Stream();
ParseStream.STREAM_TYPES  = {
  h264: 0x1b,
  adts: 0x0f
};

/**
 * Reconsistutes program stream packets from multiple transport stream packets.
 */
ProgramStream = function() {
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
    flushStream = function(stream, type, pes) {
      var
        event = {
          type: type,
          data: new Uint8Array(stream.size),
        },
        i = 0,
        fragment;

      if ( pes !== undefined) {
        // move over data from PES into Stream frame
        event.pes = {};
        event.pes.pts = pes.pts;
        event.pes.dts = pes.dts;
        event.pes.pid = pes.pid;
        event.pes.dataAlignmentIndicator = pes.dataAlignmentIndicator;
        event.pes.payloadUnitStartIndicator = pes.payloadUnitStartIndicator
      }

      // do nothing if there is no buffered data
      if (!stream.data.length) {
        return;
      }

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

  ProgramStream.prototype.init.call(this);
  self = this;

  this.push = function(data) {
    ({
      pat: function() {
        // we have to wait for the PMT to arrive as well before we
        // have any meaningful metadata
      },
      pes: function() {
        var stream, streamType;

        if (data.streamType === H264_STREAM_TYPE) {
          stream = video;
          streamType = 'video';
        } else {
          stream = audio;
          streamType = 'audio';
        }

        // if a new packet is starting, we can flush the completed
        // packet
        if (data.payloadUnitStartIndicator) {
          flushStream(stream, streamType, data);
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
            } else if (programMapTable[k] === ADTS_STREAM_TYPE) {
              track.codec = 'adts';
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
ProgramStream.prototype = new videojs.Hls.Stream();

/*
 * Accepts a ProgramStream and emits data events with parsed
 * AAC Audio Frames of the individual packets.
 */
AacStream = function() {
  var  self, adtsSampleingRates, extraData;
  AacStream.prototype.init.call(this);
  self = this,
  adtsSampleingRates = [
    96000, 88200,
    64000, 48000,
    44100, 32000,
    24000, 22050,
    16000, 12000
  ],


  this.push = function(packet) {
    if (packet.type == "audio") {
      var adtsProtectionAbsent, // :Boolean
        adtsObjectType, // :int
        adtsSampleingIndex, // :int
        adtsChanelConfig, // :int
        adtsFrameSize, // :int
        adtsSampleCount, // :int
        adtsDuration, // :int
        aacFrame, // :Frame = null;

        newExtraData,
        next_pts = packet.pes.pts,
        data = packet.data;

      // byte 0
      if (0xFF !== data[0]) {
        console.assert(false, 'Error no ATDS header found');
      }

      // byte 1
      adtsProtectionAbsent = !!(data[1] & 0x01);

      // byte 2
      adtsObjectType = ((data[2] & 0xC0) >>> 6) + 1;
      adtsSampleingIndex = ((data[2] & 0x3C) >>> 2);
      adtsChanelConfig = ((data[2] & 0x01) << 2);

      // byte 3
      adtsChanelConfig |= ((data[3] & 0xC0) >>> 6);
      adtsFrameSize = ((data[3] & 0x03) << 11);

      // byte 4
      adtsFrameSize |= (data[4] << 3);

      // byte 5
      adtsFrameSize |= ((data[5] & 0xE0) >>> 5);
      adtsFrameSize -= (adtsProtectionAbsent ? 7 : 9);

      // byte 6
      adtsSampleCount = ((data[6] & 0x03) + 1) * 1024;
      adtsDuration = (adtsSampleCount * 1000) / adtsSampleingRates[adtsSampleingIndex];

      // newExtraData = (adtsObjectType << 11) |
      //                (adtsSampleingIndex << 7) |
      //                (adtsChanelConfig << 3);
      // if (newExtraData !== extraData) {
        aacFrame = {};
        aacFrame.pts = next_pts;
        aacFrame.dts = next_pts;
        aacFrame.bytes = new Uint8Array();

        // AAC is always 10
        aacFrame.audiocodecid = 10;
        aacFrame.stereo = (2 === adtsChanelConfig);
        aacFrame.audiosamplerate = adtsSampleingRates[adtsSampleingIndex];
        // Is AAC always 16 bit?
        aacFrame.audiosamplesize = 16;

        extraData = newExtraData;

        aacFrame.pts = aacFrame.dts;
        // For audio, DTS is always the same as PTS. We want to set the DTS
        // however so we can compare with video DTS to determine approximate
        // packet order
        aacFrame.pts = next_pts;
        //aacFrame.view.setUint16(aacFrame.position, newExtraData);
        //aacFrame.position += 2;
        //aacFrame.length = Math.max(aacFrame.length, aacFrame.position);

        //byte 7

        //this.tags.push(aacFrame);
      // }

      aacFrame.bytes = packet.data.subarray(7, packet.data.length);
      packet.frame = aacFrame;
      console.log(packet);
      this.trigger('data', packet);
    }
  };
};
AacStream.prototype = new videojs.Hls.Stream();

/**
 * Accepts a ProgramStream and emits data events with parsed
 * AAC Audio Frames of the individual packets.
 */
H264Stream = function() {
  var self;
  H264Stream.prototype.init.call(this);
  self = this;

  this.push = function(packet) {
    if (packet.type == "video") {
      this.trigger('data', packet);
    }
  };
};
H264Stream.prototype = new videojs.Hls.Stream();


Transmuxer = function() {
  var self = this, packetStream, parseStream, programStream, aacStream, h264Stream;
  Transmuxer.prototype.init.call(this);

  // set up the parsing pipeline
  packetStream = new PacketStream();
  parseStream = new ParseStream();
  programStream = new ProgramStream();
  aacStream = new AacStream();
  h264Stream = new H264Stream();

  packetStream.pipe(parseStream);
  parseStream.pipe(programStream);
  programStream.pipe(aacStream);
  programStream.pipe(h264Stream);

  // generate an init segment
  this.initSegment = mp4.initSegment();

  aacStream.on('data', function(data) {
    self.trigger('data', data);
  });
  h264Stream.on('data', function(data) {
    self.trigger('data', data);
  });
  // feed incoming data to the front of the parsing pipeline
  this.push = function(data) {
    packetStream.push(data);
  };
  // flush any buffered data
  this.end = programStream.end;
};
Transmuxer.prototype = new videojs.Hls.Stream();

window.videojs.mp2t = {
  PAT_PID: 0x0000,
  MP2T_PACKET_LENGTH: MP2T_PACKET_LENGTH,
  H264_STREAM_TYPE: H264_STREAM_TYPE,
  ADTS_STREAM_TYPE: ADTS_STREAM_TYPE,
  PacketStream: PacketStream,
  ParseStream: ParseStream,
  ProgramStream: ProgramStream,
  Transmuxer: Transmuxer,
  AacStream: AacStream,
  H264Stream: H264Stream
};
})(window, window.videojs);

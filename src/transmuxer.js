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

var PacketStream, ParseStream, MP2T_PACKET_LENGTH;

MP2T_PACKET_LENGTH = 188; // bytes

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
  PacketStream.prototype.init.call(this);
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
    var ptsDtsFlags,
        pesLength;

    // PES packet length
    pesLength = payload[4] << 8 | payload[5];

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

    // if an adaption field is present, its length is specified by
    // the fifth byte of the PES header. The adaptation field is
    // used to specify some forms of timing and control data that we
    // do not currently use.
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

window.videojs.mp2t = {
  PAT_PID: 0x0000,
  MP2T_PACKET_LENGTH: MP2T_PACKET_LENGTH,
  H264_STREAM_TYPE: 0x1b,
  ADTS_STREAM_TYPE: 0x0f,
  PacketStream: PacketStream,
  ParseStream: ParseStream
};
})(window, window.videojs);

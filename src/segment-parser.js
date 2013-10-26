(function(window) {
  var
    videojs = window.videojs,
    FlvTag = videojs.hls.FlvTag,
    H264Stream = videojs.hls.H264Stream,
    AacStream = videojs.hls.AacStream,
    m2tsPacketSize = 188;

  console.assert(H264Stream);
  console.assert(AacStream);

  window.videojs.hls.SegmentParser = function() {
    var
      self = this,
      parseTSPacket,
      pmtPid,
      streamBuffer = new Uint8Array(m2tsPacketSize),
      streamBufferByteCount = 0,
      videoPid,
      h264Stream = new H264Stream(),
      audioPid,
      aacStream = new AacStream(),
      seekToKeyFrame = false;

    // For information on the FLV format, see
    // http://download.macromedia.com/f4v/video_file_format_spec_v10_1.pdf.
    // Technically, this function returns the header and a metadata FLV tag
    // if duration is greater than zero
    // duration in seconds
    // @return {object} the bytes of the FLV header as a Uint8Array
    self.getFlvHeader = function(duration, audio, video) { // :ByteArray {
      var
        headBytes = new Uint8Array(3 + 1 + 1 + 4),
        head = new DataView(headBytes.buffer),
        metadata,
        result;

      // default arguments
      duration = duration || 0;
      audio = audio === undefined? true : audio;
      video = video === undefined? true : video;

      // signature
      head.setUint8(0, 0x46); // 'F'
      head.setUint8(1, 0x4c); // 'L'
      head.setUint8(2, 0x56); // 'V'

      // version
      head.setUint8(3, 0x01);

      // flags
      head.setUint8(4, (audio ? 0x04 : 0x00) | (video ? 0x01 : 0x00));

      // data offset, should be 9 for FLV v1
      head.setUint32(5, headBytes.byteLength);

      // init the first FLV tag
      if (duration <= 0) {
        // no duration available so just write the first field of the first
        // FLV tag
        result = new Uint8Array(headBytes.byteLength + 4);
        result.set(headBytes);
        result.set([0, 0, 0, 0], headBytes.byteLength);
        return result;
      }

      // write out the duration metadata tag
      metadata = new FlvTag(FlvTag.METADATA_TAG);
      metadata.pts = metadata.dts = 0;
      metadata.writeMetaDataDouble("duration", duration);
      result = new Uint8Array(headBytes.byteLength + metadata.byteLength);
      result.set(head);
      result.set(head.bytesLength, metadata.finalize());

      return result;
    };

    self.flushTags = function() {
      h264Stream.finishFrame();
    };
    self.doSeek = function() {
      self.flushTags();
      aacStream.tags.length = 0;
      h264Stream.tags.length = 0;
      seekToKeyFrame = true;
    };

    self.tagsAvailable = function() { // :int {
      var i, pts; // :uint

      if (seekToKeyFrame) {
        for (i = 0 ; i < h264Stream.tags.length && seekToKeyFrame; ++i) {
          if (h264Stream.tags[i].keyFrame) {
            seekToKeyFrame = false; // We found, a keyframe, stop seeking
          }
        }

        if (seekToKeyFrame) {
          // we didnt find a keyframe. yet
          h264Stream.tags.length = 0;
          return 0;
        }

        // TODO we MAY need to use dts, not pts
        h264Stream.tags = h264Stream.tags.slice(i);
        pts = h264Stream.tags[0].pts;

        // Remove any audio before the found keyframe
        while( 0 < aacStream.tags.length && pts > aacStream.tags[0].pts ) {
          aacStream.tags.shift();
        }
      }

      return h264Stream.tags.length + aacStream.tags.length;
    };

    self.getNextTag = function() { // :ByteArray {
      var tag; // :FlvTag; // return tags in approximate dts order

      if (0 === self.tagsAvailable()) {
        throw new Error("getNextTag() called when 0 == tagsAvailable()");
      }

      if (0 < h264Stream.tags.length) {
        if (0 < aacStream.tags.length && aacStream.tags[0].dts < h264Stream.tags[0].dts) {
          tag = aacStream.tags.shift();
        } else {
          tag = h264Stream.tags.shift();
        }
      } else if ( 0 < aacStream.tags.length ) {
        tag = aacStream.tags.shift();
      } else {
        // We dont have any tags available to return
        return new Uint8Array();
      }

      return tag.finalize();
    };

    self.parseSegmentBinaryData = function(data) { // :ByteArray) {
      var
        dataPosition = 0,
        dataSlice;

      // To avoid an extra copy, we will stash overflow data, and only
      // reconstruct the first packet. The rest of the packets will be
      // parsed directly from data
      if (streamBufferByteCount > 0) {
        if (data.byteLength + streamBufferByteCount < m2tsPacketSize) {
          // the current data is less than a single m2ts packet, so stash it
          // until we receive more

          // ?? this seems to append streamBuffer onto data and then just give up. I'm not sure why that would be interesting.
          videojs.log('data.length + streamBuffer.length < m2tsPacketSize ??');
          streamBuffer.readBytes(data, data.length, streamBuffer.length);
          return;
        } else {
          // we have enough data for an m2ts packet
          // process it immediately
          dataSlice = data.subarray(0, m2tsPacketSize - streamBufferByteCount);
          streamBuffer.set(dataSlice, streamBufferByteCount);

          parseTSPacket(streamBuffer);

          // reset the buffer
          streamBuffer = new Uint8Array(m2tsPacketSize);
          streamBufferByteCount = 0;
        }
      }

      while (true) {
        // Make sure we are TS aligned
        while(dataPosition < data.byteLength  && data[dataPosition] !== 0x47) {
          // If there is no sync byte skip forward until we find one
          // TODO if we find a sync byte, look 188 bytes in the future (if
          // possible). If there is not a sync byte there, keep looking
          dataPosition++;
        }

        // base case: not enough data to parse a m2ts packet
        if (data.byteLength - dataPosition < m2tsPacketSize) {
          if (data.byteLength - dataPosition > 0) {
            // there are bytes remaining, save them for next time
            streamBuffer.set(data.subarray(dataPosition),
                             streamBufferByteCount);
            streamBufferByteCount += data.byteLength - dataPosition;
          }
          return;
        }

        // attempt to parse a m2ts packet
        if (parseTSPacket(data.subarray(dataPosition, dataPosition + m2tsPacketSize))) {
          dataPosition += m2tsPacketSize;
        } else {
          // If there was an error parsing a TS packet. it could be
          // because we are not TS packet aligned. Step one forward by
          // one byte and allow the code above to find the next
          videojs.log('error parsing m2ts packet, attempting to re-align');
          dataPosition++;
        }
      }
    };

    // TODO add more testing to make sure we dont walk past the end of a TS
    // packet!
    parseTSPacket = function(data) { // :ByteArray):Boolean {
      var
        offset = 0, // :uint
        end = offset + m2tsPacketSize, // :uint

        // Don't look for a sync byte. We handle that in
        // parseSegmentBinaryData()

        // Payload Unit Start Indicator
        pusi = !!(data[offset + 1] & 0x40), // mask: 0100 0000

        // PacketId
        pid = (data[offset + 1] & 0x1F) << 8 | data[offset + 2], // mask: 0001 1111
        afflag = (data[offset + 3] & 0x30 ) >>> 4,

        aflen, // :uint
        patTableId, // :int
        patCurrentNextIndicator, // Boolean
        patSectionLength, // :uint

        pesPacketSize, // :int,
        dataAlignmentIndicator, // :Boolean,
        ptsDtsIndicator, // :int
        pesHeaderLength, // :int

        pts, // :uint
        dts, // :uint

        pmtTableId, // :int
        pmtCurrentNextIndicator, // :Boolean
        pmtSectionLength, // :uint

        streamType, // :int
        elementaryPID, // :int
        ESInfolength; // :int

      // Continuity Counter we could use this for sanity check, and
      // corrupt stream detection
      // cc = (data[offset + 3] & 0x0F);

      // Done with TS header
      offset += 4;

      if (afflag > 0x01) {   // skip most of the adaption field
        aflen = data[offset];
        offset += aflen + 1;
      }

      if (0x0000 === pid) {
        // always test for PMT first! (becuse other variables default to 0)

        // if pusi is set we must skip X bytes (PSI pointer field)
        offset += pusi ? 1 + data[offset] : 0;
        patTableId = data[offset];

        console.assert(0x00 === patTableId, 'patTableId should be 0x00');

        patCurrentNextIndicator = !!(data[offset + 5] & 0x01);
        if (patCurrentNextIndicator) {
          patSectionLength =  (data[offset + 1] & 0x0F) << 8 | data[offset + 2];
          offset += 8; // skip past PSI header

          // We currently only support streams with 1 program
          patSectionLength = (patSectionLength - 9) / 4;
          if (1 !== patSectionLength) {
            throw new Error("TS has more that 1 program");
          }

          // if we ever support more that 1 program (unlikely) loop over them here
          // var programNumber =   data[offset + 0] << 8 | data[offset + 1];
          // var programId = (data[offset+2] & 0x1F) << 8 | data[offset + 3];
          pmtPid = (data[offset + 2] & 0x1F) << 8 | data[offset + 3];
        }

        // We could test the CRC here to detect corruption with extra CPU cost
      } else if (videoPid === pid || audioPid === pid) {
        if (pusi) {
          // comment out for speed
          if (0x00 !== data[offset + 0] || 0x00 !== data[offset + 1] || 0x01 !== data[offset + 2]) {
            // look for PES start code
             throw new Error("PES did not begin with start code");
           }

          // var sid:int  = data[offset+3]; // StreamID
          pesPacketSize = (data[offset + 4] << 8) | data[offset + 5];
          dataAlignmentIndicator = (data[offset + 6] & 0x04) !== 0;
          ptsDtsIndicator = (data[offset + 7] & 0xC0) >>> 6;
          pesHeaderLength = data[offset + 8]; // TODO sanity check header length
          offset += 9; // Skip past PES header

          // PTS and DTS are normially stored as a 33 bit number.
          // JavaScript does not have a integer type larger than 32 bit
          // BUT, we need to convert from 90ns to 1ms time scale anyway.
          // so what we are going to do instead, is drop the least
          // significant bit (the same as dividing by two) then we can
          // divide by 45 (45 * 2 = 90) to get ms.
          if (ptsDtsIndicator & 0x03) {
            pts = (data[offset + 0] & 0x0E) << 28
              | (data[offset + 1] & 0xFF) << 21
              | (data[offset + 2] & 0xFE) << 13
              | (data[offset + 3] & 0xFF) <<  6
              | (data[offset + 4] & 0xFE) >>>  2;
            pts /= 45;
            if (ptsDtsIndicator & 0x01) {// DTS
              dts = (data[offset + 5] & 0x0E ) << 28
                | (data[offset + 6] & 0xFF ) << 21
                | (data[offset + 7] & 0xFE ) << 13
                | (data[offset + 8] & 0xFF ) << 6
                | (data[offset + 9] & 0xFE ) >>> 2;
              dts /= 45;
            } else {
              dts = pts;
            }
          }
          // Skip past "optional" portion of PTS header
          offset += pesHeaderLength;

          if (videoPid === pid) {
            // Stash this frame for future use.
            // console.assert(videoFrames.length < 3);

            h264Stream.setNextTimeStamp(pts,
                                        dts,
                                        dataAlignmentIndicator);
          } else if (audioPid === pid) {
            aacStream.setNextTimeStamp(pts,
                                       pesPacketSize,
                                       dataAlignmentIndicator);
          }
        }

        if (audioPid === pid) {
          aacStream.writeBytes(data, offset, end - offset);
        } else if (videoPid === pid) {
          h264Stream.writeBytes(data, offset, end - offset);
        }
      } else if (pmtPid === pid) {
        // TODO sanity check data[offset]
        // if pusi is set we must skip X bytes (PSI pointer field)
        offset += (pusi ? 1 + data[offset] : 0);
        pmtTableId = data[offset];

        console.assert(0x02 === pmtTableId);

        pmtCurrentNextIndicator = !!(data[offset + 5] & 0x01);
        if (pmtCurrentNextIndicator) {
          audioPid = videoPid = 0;
          pmtSectionLength  = (data[offset + 1] & 0x0F) << 8 | data[offset + 2];
          // skip CRC and PSI data we dont care about
          pmtSectionLength -= 13;

          offset += 12; // skip past PSI header and some PMT data
          while (0 < pmtSectionLength) {
            streamType = data[offset + 0];
            elementaryPID = (data[offset + 1] & 0x1F) << 8 | data[offset + 2];
            ESInfolength = (data[offset + 3] & 0x0F) << 8 | data[offset + 4];
            offset += 5 + ESInfolength;
            pmtSectionLength -=  5 + ESInfolength;

            if (0x1B === streamType) {
              if (0 !== videoPid) {
                throw new Error("Program has more than 1 video stream");
              }
              videoPid = elementaryPID;
            } else if (0x0F === streamType) {
              if (0 !== audioPid) {
                throw new Error("Program has more than 1 audio Stream");
              }
              audioPid = elementaryPID;
            }
            // TODO add support for MP3 audio
          }
        }
        // We could test the CRC here to detect corruption with extra CPU cost
      } else if (0x0011 === pid) {
        // Service Description Table
      } else if (0x1FFF === pid) {
        // NULL packet
      } else {
        videojs.log("Unknown PID parsing TS packet: " + pid);
      }

      return true;
    };

    self.stats = {
      h264Tags: function() {
        return h264Stream.tags.length;
      },
      aacTags: function() {
        return aacStream.tags.length;
      }
    };
  };
})(this);

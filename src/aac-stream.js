/*
 * aac-stream
 * 
 *
 * Copyright (c) 2013 Brightcove
 * All rights reserved.
 */

(function(window) {
var
  FlvTag = window.videojs.hls.FlvTag,
  adtsSampleingRates = [
    96000, 88200,
    64000, 48000,
    44100, 32000,
    24000, 22050,
    16000, 12000
  ];

window.videojs.hls.AacStream = function() {
  var 
    next_pts, // :uint
    pts_delta = -1, // :int
    state, // :uint
    pes_length, // :int

    adtsProtectionAbsent, // :Boolean
    adtsObjectType, // :int
    adtsSampleingIndex, // :int
    adtsChanelConfig, // :int
    adtsFrameSize, // :int
    adtsSampleCount, // :int
    adtsDuration, // :int

    aacFrame, // :FlvTag = null;
    extraData; // :uint;

  this.tags = [];

  // (pts:uint, pes_size:int, dataAligned:Boolean):void
  this.setNextTimeStamp = function(pts, pes_size, dataAligned) {
    if (0 > pts_delta) {
      // We assume the very firts pts is less than 0x80000000
      pts_delta = pts;
    }

    next_pts = pts - pts_delta;
    pes_length = pes_size;

    // If data is aligned, flush all internal buffers
    if (dataAligned) {
      state = 0;
    }
  };

  // (data:ByteArray, o:int = 0, l:int = 0):void
  this.writeBytes = function(data, o, l) {
    var
      e, // :int
      newExtraData, // :uint
      bytesToCopy; // :int

    // default arguments
    o = o || 0;
    l = l || 0;

    // Do not allow more than 'pes_length' bytes to be written
    l = (pes_length < l ? pes_length : l);
    pes_length -= l;
    e = o + l;
    while (o < e) {
      switch (state) {
      default:
        state = 0;
        break;
      case 0:
        if (o >= e) {
          return;
        }
        if (0xFF !== data[o]) {
          console.assert(false, 'Error no ATDS header found');
          o += 1;
          state = 0;
          return;
        }

        o += 1;
        state = 1;
        break;
      case 1:
        if (o >= e) {
          return;
        }
        if (0xF0 !== (data[o] & 0xF0)) {
          console.assert(false, 'Error no ATDS header found');
          o +=1;
          state = 0;
          return;
        }

        adtsProtectionAbsent = !!(data[o] & 0x01);

        o += 1;
        state = 2;
        break;
      case 2:
        if (o >= e) {
          return;
        }
        adtsObjectType = ((data[o] & 0xC0) >>> 6) + 1;
        adtsSampleingIndex = ((data[o] & 0x3C) >>> 2);
        adtsChanelConfig = ((data[o] & 0x01) << 2);

        o += 1;
        state = 3;
        break;
      case 3: 
        if (o >= e) {
          return;
        }
        adtsChanelConfig |= ((data[o] & 0xC0) >>> 6);
        adtsFrameSize = ((data[o] & 0x03) << 11);

        o += 1;
        state = 4;
        break;
      case 4: 
        if (o >= e) {
          return;
        }
        adtsFrameSize |= (data[o] << 3);

        o += 1;
        state = 5;
        break;
      case 5:
        if(o >= e) {
          return;
        }
        adtsFrameSize |= ((data[o] & 0xE0) >>> 5);
        adtsFrameSize -= (adtsProtectionAbsent ? 7 : 9);

        o += 1;
        state = 6;
        break;
      case 6: 
        if (o >= e) {
          return;
        }
        adtsSampleCount = ((data[o] & 0x03) + 1) * 1024;
        adtsDuration = (adtsSampleCount * 1000) / adtsSampleingRates[adtsSampleingIndex];

        newExtraData = (adtsObjectType << 11) |
                       (adtsSampleingIndex << 7) |
                       (adtsChanelConfig << 3);
        if (newExtraData !== extraData) {
          aacFrame = new FlvTag(FlvTag.METADATA_TAG);
          aacFrame.pts = next_pts;
          aacFrame.dts = next_pts;

          // AAC is always 10
          aacFrame.writeMetaDataDouble("audiocodecid", 10); 
          aacFrame.writeMetaDataBoolean("stereo", 2 === adtsChanelConfig);
          aacFrame.writeMetaDataDouble ("audiosamplerate", adtsSampleingRates[adtsSampleingIndex]);
          // Is AAC always 16 bit?
          aacFrame.writeMetaDataDouble ("audiosamplesize", 16); 

          this.tags.push(aacFrame);

          extraData = newExtraData;
          aacFrame = new FlvTag(FlvTag.AUDIO_TAG, true, FlvTag.AAC_AUDIO);
          aacFrame.pts = aacFrame.dts;
          // For audio, DTS is always the same as PTS. We want to set the DTS
          // however so we can compare with video DTS to determine approximate
          // packet order
          aacFrame.pts = next_pts; 
          aacFrame.view.setUint16(aacFrame.position, newExtraData);
          aacFrame.position += 2;
          aacFrame.length = Math.max(aacFrame.length, aacFrame.position);

          this.tags.push(aacFrame);
        }

        // Skip the checksum if there is one
        o += 1;
        state = 7;
        break;
      case 7:
        if (!adtsProtectionAbsent) {
          if (2 > (e - o)) {
            return;
          } else {
            o += 2;
          }
        }

        aacFrame = new FlvTag(FlvTag.AUDIO_TAG, undefined, FlvTag.AAC_AUDIO);
        aacFrame.pts = next_pts;
        aacFrame.dts = next_pts;
        state = 8;
        break;
      case 8:
        while (adtsFrameSize) {
          if (o >= e) {
            return;
          }
          bytesToCopy = (e - o) < adtsFrameSize ? (e - o) : adtsFrameSize;
          aacFrame.writeBytes(data, o, bytesToCopy);
          o += bytesToCopy;
          adtsFrameSize -= bytesToCopy;
        }

        this.tags.push(aacFrame);

        // finished with this frame
        state = 0;
        next_pts += adtsDuration;
      }
    }
  };
};

})(this);

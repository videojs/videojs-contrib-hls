(function(window) {

window.videojs.hls.Mp3Stream = function() {
  var
    hls = window.videojs.hls, 
    FlvTag = window.videojs.hls.FlvTag,
    //mpegVersion = ['2.5', 'reserved', 'MPEG Version 2', 'MPEG Version 1'],
    //mpegLayers = ['reserved', 'Layer III', 'Layer II', 'Layer I'],
    mpegBitrates = [
      // Version 2.5
      [
        [0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0, 0],
        [0,   8,  16,  24,  32,  40,  48,  56,  64,  80,  96, 112, 128, 144, 160, 0],
        [0,   8,  16,  24,  32,  40,  48,  56,  64,  80,  96, 112, 128, 144, 160, 0],
        [0,  32,  48,  56,  64,  80,  96, 112, 128, 144, 160, 176, 192, 224, 256, 0]
      ],
      // Reserved
      [
        [0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0, 0],
        [0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0, 0],
        [0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0, 0],
        [0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0, 0]
      ],
      // Version 2
      [
        [0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0, 0],
        [0,   8,  16,  24,  32,  40,  48,  56,  64,  80,  96, 112, 128, 144, 160, 0],
        [0,   8,  16,  24,  32,  40,  48,  56,  64,  80,  96, 112, 128, 144, 160, 0],
        [0,  32,  48,  56,  64,  80,  96, 112, 128, 144, 160, 176, 192, 224, 256, 0]
      ],
      // Version 1
      [
        [0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0, 0],
        [0,  32,  40,  48,  56,  64,  80,  96, 112, 128, 160, 192, 224, 256, 320, 0],
        [0,  32,  48,  56,  64,  80,  96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
        [0,  32,  64,  96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0]
      ]
    ],
    mpegSampleRates = [
      //Mpeg 2.5
      [11025, 12000,  8000, 0],
      //Reserved
      [0, 0, 0, 0],
      //Mpeg 2
      [22050, 24000, 16000, 0],
      // Mpeg 1
      [44100, 48000, 32000, 0]
    ],
    mpegFrameSamples = [
      [0,  576, 1152,  384],
      [0,    0,    0,    0],
      [0,  576, 1152,  384],
      [0, 1152, 1152,  384]
    ],
    mpeg_slot_size = [0, 1, 1, 4],
    next_pts, // :uint
    pts_delta = -1, // :int
    state = 0, // :uint
    pes_length, // :int
    mp3Frame,
    mp3FrameSize,
    sentMeta = false;

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

  this.writeBytes = function(data, o, l) {
    var e = o + l,
        bytesToCopy;

    while(o < e) {
      switch (state) {
        case 0:
          if(!(0xFF === data[o] &&
             0xE0 === (data[o + 1] & 0xE0))) {
            console.assert(false, 'No MP3 Header found');
            return;
          }
          var mpegVersionIndex = (data[o + 1] & 0x18) >> 3;
          var mpegLayerIndex = (data[o + 1] & 0x06) >> 1;
          var bitrateIndex = (data[o + 2] & 0xf0) >> 4;
          var sampleRateIndex = (data[o + 2] & 0x0C) >> 2;
          var pad = ((data[o + 2] & 0x02) >> 1) === 1;
          //var protection = (data[0 + 1] & 0x01) === 0;
          var bps = mpegFrameSamples[mpegVersionIndex][mpegLayerIndex] / 8.0;
          mp3FrameSize =  Math.floor(((bps * mpegBitrates[mpegVersionIndex][mpegLayerIndex][bitrateIndex] / mpegSampleRates[mpegVersionIndex][sampleRateIndex] * 1000) + (pad ? mpeg_slot_size[mpegLayerIndex] : 0)));
          var stereo = ((data[o + 3] & 0xC0) >> 6) !== 3;
          
          if( sentMeta === false) {
            mp3Frame = new FlvTag(FlvTag.METADATA_TAG);
            mp3Frame.pts = next_pts;
            mp3Frame.dts = next_pts;

            // MP3 is always 2
            mp3Frame.writeMetaDataDouble("audiocodecid", 2); 
            mp3Frame.writeMetaDataBoolean("stereo", stereo);
            mp3Frame.writeMetaDataDouble ("audiosamplerate", mpegSampleRates[mpegVersionIndex][sampleRateIndex]);
            // Is AAC always 16 bit?
            mp3Frame.writeMetaDataDouble ("audiosamplesize", 16);

            this.tags.push(mp3Frame);
            sentMeta = true;
          }

          mp3Frame = new FlvTag(FlvTag.AUDIO_TAG, undefined, hls.FlvTag.MP3_AUDIO);
          mp3Frame.pts = next_pts;
          mp3Frame.dts = next_pts;
          state = 1;
          break;
        case 1:
          while(mp3FrameSize) {
            if( o >= e ) {
              return;
            }
            bytesToCopy = (e - o) < mp3FrameSize ? (e - o) : mp3FrameSize; 
            mp3Frame.writeBytes(data, o, bytesToCopy);
            o += bytesToCopy;
            mp3FrameSize -= bytesToCopy;
          }
          // Done with this frame
          this.tags.push(mp3Frame);
          state = 0;
          break;
      }
    }
  };
};
})(this);
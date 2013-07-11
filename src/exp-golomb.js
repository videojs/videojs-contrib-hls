(function(window) {

window.videojs.hls.ExpGolomb = function(workingData) {
  var
    // the number of bytes left to examine in workingData
    workingBytesAvailable = workingData.byteLength,

    // the current word being examined
    workingWord, // :uint

    // the number of bits left to examine in the current word
    workingBitsAvailable; // :uint;

  // ():uint
  this.length = function() {
    return (8 * workingBytesAvailable);
  };

  // ():uint
  this.bitsAvailable = function() {
    return (8 * workingBytesAvailable) + workingBitsAvailable;
  };

  // ():void
  this.loadWord = function() {
    var
      workingBytes = new Uint8Array(4),
      availableBytes = Math.min(4, workingBytesAvailable);

    // console.assert(availableBytes > 0);

    workingBytes.set(workingData.subarray(0, availableBytes));
    workingWord = new DataView(workingBytes.buffer).getUint32(0);

    // track the amount of workingData that has been processed
    workingBitsAvailable = availableBytes * 8;
    workingBytesAvailable -= availableBytes;
  };

  // (size:int):void
  this.skipBits = function(size) {
    var skipBytes; // :int
    if (workingBitsAvailable > size) {
      workingWord          <<= size;
      workingBitsAvailable -= size;
    } else {
      size -= workingBitsAvailable;
      skipBytes = size / 8;

      size -= (skipBytes * 8);
      workingData.position += skipBytes;

      this.loadWord();

      workingWord <<= size;
      workingBitsAvailable -= size;
    }
  };

  // (size:int):uint
  this.readBits = function(size) {
    var
      bits = Math.min(workingBitsAvailable, size), // :uint
      valu = workingWord >>> (32 - bits); // :uint

    console.assert(32 > size, 'Cannot read more than 32 bits at a time');

    workingBitsAvailable -= bits;
    if (0 < workingBitsAvailable) {
      workingWord <<= bits;
    } else {
      this.loadWord();
    }

    bits = size - bits;
    if (0 < bits) {
      return valu << bits | this.readBits(bits);
    } else {
      return valu;
    }
  };

  // ():uint
  this.skipLeadingZeros = function() {
    var clz; // :uint
    for (clz = 0 ; clz < workingBitsAvailable ; ++clz) {
      if (0 !== (workingWord & (0x80000000 >>> clz))) {
        workingWord <<= clz;
        workingBitsAvailable -= clz;
        return clz;
      }
    }

    // we exhausted workingWord and still have not found a 1
    this.loadWord(); 
    return clz + this.skipLeadingZeros();
  };

  // ():void
  this.skipUnsignedExpGolomb = function() {
    this.skipBits(1 + this.skipLeadingZeros());
  };

  // ():void
  this.skipExpGolomb = function() {
    this.skipBits(1 + this.skipLeadingZeros());
  };

  // ():uint
  this.readUnsignedExpGolomb = function() {
    var clz = this.skipLeadingZeros(); // :uint
    return this.readBits(clz + 1) - 1;
  };

  // ():int
  this.readExpGolomb = function() {
    var valu = this.readUnsignedExpGolomb(); // :int
    if (0x01 & valu) {
      // the number is odd if the low order bit is set
      return (1 + valu) >>> 1; // add 1 to make it even, and divide by 2
    } else {
      return -1 * (valu >>> 1); // divide by two then make it negative
    }
  };

  // Some convenience functions
  // :Boolean
  this.readBoolean = function() {
    return 1 === this.readBits(1);
  };

  // ():int
  this.readUnsignedByte = function() {
    return this.readBits(8);
  };

  this.loadWord();

};
})(this);

/*
 *
 * This file contains an adaptation of the AES decryption algorithm
 * from the Standford Javascript Cryptography Library. That work is
 * covered by the following copyright and permissions notice:
 *
 * Copyright 2009-2010 Emily Stark, Mike Hamburg, Dan Boneh.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHORS ``AS IS'' AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR
 * BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
 * OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN
 * IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * The views and conclusions contained in the software and documentation
 * are those of the authors and should not be interpreted as representing
 * official policies, either expressed or implied, of the authors.
 */
(function(window, videojs, unpad) {
'use strict';

var AES, AsyncStream, Decrypter, decrypt, ntoh;

/**
 * Convert network-order (big-endian) bytes into their little-endian
 * representation.
 */
ntoh = function(word) {
  return (word << 24) |
    ((word & 0xff00) << 8) |
    ((word & 0xff0000) >> 8) |
    (word >>> 24);
};

/**
 * Schedule out an AES key for both encryption and decryption. This
 * is a low-level class. Use a cipher mode to do bulk encryption.
 *
 * @constructor
 * @param key {Array} The key as an array of 4, 6 or 8 words.
 */
AES = function (key) {
  this._precompute();

  var i, j, tmp,
    encKey, decKey,
    sbox = this._tables[0][4], decTable = this._tables[1],
    keyLen = key.length, rcon = 1;

  if (keyLen !== 4 && keyLen !== 6 && keyLen !== 8) {
    throw new Error("Invalid aes key size");
  }

  encKey = key.slice(0);
  decKey = [];
  this._key = [encKey, decKey];

  // schedule encryption keys
  for (i = keyLen; i < 4 * keyLen + 28; i++) {
    tmp = encKey[i-1];

    // apply sbox
    if (i%keyLen === 0 || (keyLen === 8 && i%keyLen === 4)) {
      tmp = sbox[tmp>>>24]<<24 ^ sbox[tmp>>16&255]<<16 ^ sbox[tmp>>8&255]<<8 ^ sbox[tmp&255];

      // shift rows and add rcon
      if (i%keyLen === 0) {
        tmp = tmp<<8 ^ tmp>>>24 ^ rcon<<24;
        rcon = rcon<<1 ^ (rcon>>7)*283;
      }
    }

    encKey[i] = encKey[i-keyLen] ^ tmp;
  }

  // schedule decryption keys
  for (j = 0; i; j++, i--) {
    tmp = encKey[j&3 ? i : i - 4];
    if (i<=4 || j<4) {
      decKey[j] = tmp;
    } else {
      decKey[j] = decTable[0][sbox[tmp>>>24      ]] ^
                  decTable[1][sbox[tmp>>16  & 255]] ^
                  decTable[2][sbox[tmp>>8   & 255]] ^
                  decTable[3][sbox[tmp      & 255]];
    }
  }
};

AES.prototype = {
  /**
   * The expanded S-box and inverse S-box tables. These will be computed
   * on the client so that we don't have to send them down the wire.
   *
   * There are two tables, _tables[0] is for encryption and
   * _tables[1] is for decryption.
   *
   * The first 4 sub-tables are the expanded S-box with MixColumns. The
   * last (_tables[01][4]) is the S-box itself.
   *
   * @private
   */
  _tables: [[[],[],[],[],[]],[[],[],[],[],[]]],

  /**
   * Expand the S-box tables.
   *
   * @private
   */
  _precompute: function () {
   var encTable = this._tables[0], decTable = this._tables[1],
       sbox = encTable[4], sboxInv = decTable[4],
       i, x, xInv, d=[], th=[], x2, x4, x8, s, tEnc, tDec;

    // Compute double and third tables
   for (i = 0; i < 256; i++) {
     th[( d[i] = i<<1 ^ (i>>7)*283 )^i]=i;
   }

   for (x = xInv = 0; !sbox[x]; x ^= x2 || 1, xInv = th[xInv] || 1) {
     // Compute sbox
     s = xInv ^ xInv<<1 ^ xInv<<2 ^ xInv<<3 ^ xInv<<4;
     s = s>>8 ^ s&255 ^ 99;
     sbox[x] = s;
     sboxInv[s] = x;

     // Compute MixColumns
     x8 = d[x4 = d[x2 = d[x]]];
     tDec = x8*0x1010101 ^ x4*0x10001 ^ x2*0x101 ^ x*0x1010100;
     tEnc = d[s]*0x101 ^ s*0x1010100;

     for (i = 0; i < 4; i++) {
       encTable[i][x] = tEnc = tEnc<<24 ^ tEnc>>>8;
       decTable[i][s] = tDec = tDec<<24 ^ tDec>>>8;
     }
   }

   // Compactify. Considerable speedup on Firefox.
   for (i = 0; i < 5; i++) {
     encTable[i] = encTable[i].slice(0);
     decTable[i] = decTable[i].slice(0);
   }
  },

  /**
   * Decrypt 16 bytes, specified as four 32-bit words.
   * @param encrypted0 {number} the first word to decrypt
   * @param encrypted1 {number} the second word to decrypt
   * @param encrypted2 {number} the third word to decrypt
   * @param encrypted3 {number} the fourth word to decrypt
   * @param out {Int32Array} the array to write the decrypted words
   * into
   * @param offset {number} the offset into the output array to start
   * writing results
   * @return {Array} The plaintext.
   */
  decrypt:function (encrypted0, encrypted1, encrypted2, encrypted3, out, offset) {
    var key = this._key[1],
        // state variables a,b,c,d are loaded with pre-whitened data
        a = encrypted0 ^ key[0],
        b = encrypted3 ^ key[1],
        c = encrypted2 ^ key[2],
        d = encrypted1 ^ key[3],
        a2, b2, c2,

        nInnerRounds = key.length / 4 - 2, // key.length === 2 ?
        i,
        kIndex = 4,
        table = this._tables[1],

        // load up the tables
        table0    = table[0],
        table1    = table[1],
        table2    = table[2],
        table3    = table[3],
        sbox  = table[4];

    // Inner rounds. Cribbed from OpenSSL.
    for (i = 0; i < nInnerRounds; i++) {
      a2 = table0[a>>>24] ^ table1[b>>16 & 255] ^ table2[c>>8 & 255] ^ table3[d & 255] ^ key[kIndex];
      b2 = table0[b>>>24] ^ table1[c>>16 & 255] ^ table2[d>>8 & 255] ^ table3[a & 255] ^ key[kIndex + 1];
      c2 = table0[c>>>24] ^ table1[d>>16 & 255] ^ table2[a>>8 & 255] ^ table3[b & 255] ^ key[kIndex + 2];
      d  = table0[d>>>24] ^ table1[a>>16 & 255] ^ table2[b>>8 & 255] ^ table3[c & 255] ^ key[kIndex + 3];
      kIndex += 4;
      a=a2; b=b2; c=c2;
    }

    // Last round.
    for (i = 0; i < 4; i++) {
      out[(3 & -i) + offset] =
        sbox[a>>>24      ]<<24 ^
        sbox[b>>16  & 255]<<16 ^
        sbox[c>>8   & 255]<<8  ^
        sbox[d      & 255]     ^
        key[kIndex++];
      a2=a; a=b; b=c; c=d; d=a2;
    }
  }
};

/**
 * Decrypt bytes using AES-128 with CBC and PKCS#7 padding.
 * @param encrypted {Uint8Array} the encrypted bytes
 * @param key {Uint32Array} the bytes of the decryption key
 * @param initVector {Uint32Array} the initialization vector (IV) to
 * use for the first round of CBC.
 * @return {Uint8Array} the decrypted bytes
 *
 * @see http://en.wikipedia.org/wiki/Advanced_Encryption_Standard
 * @see http://en.wikipedia.org/wiki/Block_cipher_mode_of_operation#Cipher_Block_Chaining_.28CBC.29
 * @see https://tools.ietf.org/html/rfc2315
 */
decrypt = function(encrypted, key, initVector) {
  var
    // word-level access to the encrypted bytes
    encrypted32 = new Int32Array(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength >> 2),

    decipher = new AES(Array.prototype.slice.call(key)),

    // byte and word-level access for the decrypted output
    decrypted = new Uint8Array(encrypted.byteLength),
    decrypted32 = new Int32Array(decrypted.buffer),

    // temporary variables for working with the IV, encrypted, and
    // decrypted data
    init0, init1, init2, init3,
    encrypted0, encrypted1, encrypted2, encrypted3,

    // iteration variable
    wordIx;

  // pull out the words of the IV to ensure we don't modify the
  // passed-in reference and easier access
  init0 = initVector[0];
  init1 = initVector[1];
  init2 = initVector[2];
  init3 = initVector[3];

  // decrypt four word sequences, applying cipher-block chaining (CBC)
  // to each decrypted block
  for (wordIx = 0; wordIx < encrypted32.length; wordIx += 4) {
    // convert big-endian (network order) words into little-endian
    // (javascript order)
    encrypted0 = ntoh(encrypted32[wordIx]);
    encrypted1 = ntoh(encrypted32[wordIx + 1]);
    encrypted2 = ntoh(encrypted32[wordIx + 2]);
    encrypted3 = ntoh(encrypted32[wordIx + 3]);

    // decrypt the block
    decipher.decrypt(encrypted0,
                     encrypted1,
                     encrypted2,
                     encrypted3,
                     decrypted32,
                     wordIx);

    // XOR with the IV, and restore network byte-order to obtain the
    // plaintext
    decrypted32[wordIx]     = ntoh(decrypted32[wordIx] ^ init0);
    decrypted32[wordIx + 1] = ntoh(decrypted32[wordIx + 1] ^ init1);
    decrypted32[wordIx + 2] = ntoh(decrypted32[wordIx + 2] ^ init2);
    decrypted32[wordIx + 3] = ntoh(decrypted32[wordIx + 3] ^ init3);

    // setup the IV for the next round
    init0 = encrypted0;
    init1 = encrypted1;
    init2 = encrypted2;
    init3 = encrypted3;
  }

  return decrypted;
};

AsyncStream = function() {
  this.jobs = [];
  this.delay = 1;
  this.timeout_ = null;
};
AsyncStream.prototype = new videojs.Hls.Stream();
AsyncStream.prototype.processJob_ = function() {
  this.jobs.shift()();
  if (this.jobs.length) {
    this.timeout_ = setTimeout(videojs.bind(this, this.processJob_),
                               this.delay);
  } else {
    this.timeout_ = null;
  }
};
AsyncStream.prototype.push = function(job) {
  this.jobs.push(job);
  if (!this.timeout_) {
    this.timeout_ = setTimeout(videojs.bind(this, this.processJob_),
                               this.delay);
  }
};

Decrypter = function(encrypted, key, initVector, done) {
  var
    step = Decrypter.STEP,
    encrypted32 = new Int32Array(encrypted.buffer),
    decrypted = new Uint8Array(encrypted.byteLength),
    i = 0;
  this.asyncStream_ = new AsyncStream();

  // split up the encryption job and do the individual chunks asynchronously
  this.asyncStream_.push(this.decryptChunk_(encrypted32.subarray(i, i + step),
                                            key,
                                            initVector,
                                            decrypted,
                                            i));
  for (i = step; i < encrypted32.length; i += step) {
    initVector = new Uint32Array([
      ntoh(encrypted32[i - 4]),
      ntoh(encrypted32[i - 3]),
      ntoh(encrypted32[i - 2]),
      ntoh(encrypted32[i - 1])
    ]);
    this.asyncStream_.push(this.decryptChunk_(encrypted32.subarray(i, i + step),
                                              key,
                                              initVector,
                                              decrypted));
  }
  // invoke the done() callback when everything is finished
  this.asyncStream_.push(function() {
    // remove pkcs#7 padding from the decrypted bytes
    done(null, unpad(decrypted));
  });
};
Decrypter.prototype = new videojs.Hls.Stream();
Decrypter.prototype.decryptChunk_ = function(encrypted, key, initVector, decrypted) {
  return function() {
    var bytes = decrypt(encrypted,
                        key,
                        initVector);
    decrypted.set(bytes, encrypted.byteOffset);
  };
};
// the maximum number of bytes to process at one time
Decrypter.STEP = 4 * 8000;

// exports
videojs.Hls.decrypt = decrypt;
videojs.Hls.Decrypter = Decrypter;
videojs.Hls.AsyncStream = AsyncStream;

})(window, window.videojs, window.pkcs7.unpad);

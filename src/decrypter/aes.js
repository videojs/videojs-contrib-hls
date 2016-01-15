/**
 * Schedule out an AES key for both encryption and decryption. This
 * is a low-level class. Use a cipher mode to do bulk encryption.
 *
 * @constructor
 * @param key {Array} The key as an array of 4, 6 or 8 words.
 */
const AES = function(key) {
  this._precompute();

  let i;
  let j;
  let tmp;
  let encKey;
  let decKey;
  let sbox = this._tables[0][4];
  let decTable = this._tables[1];
  let keyLen = key.length;
  let rcon = 1;

  if (keyLen !== 4 && keyLen !== 6 && keyLen !== 8) {
    throw new Error('Invalid aes key size');
  }

  encKey = key.slice(0);
  decKey = [];
  this._key = [encKey, decKey];

  // schedule encryption keys
  for (i = keyLen; i < 4 * keyLen + 28; i++) {
    tmp = encKey[i - 1];

    // apply sbox
    if (i % keyLen === 0 || (keyLen === 8 && i % keyLen === 4)) {
      tmp = sbox[tmp >>> 24] << 24 ^
        sbox[tmp >> 16 & 255] << 16 ^
        sbox[tmp >> 8 & 255] << 8 ^
        sbox[tmp & 255];

      // shift rows and add rcon
      if (i % keyLen === 0) {
        tmp = tmp << 8 ^ tmp >>> 24 ^ rcon << 24;
        rcon = rcon << 1 ^ (rcon >> 7) * 283;
      }
    }

    encKey[i] = encKey[i - keyLen] ^ tmp;
  }

  // schedule decryption keys
  for (j = 0; i; j++, i--) {
    tmp = encKey[j & 3 ? i : i - 4];
    if (i <= 4 || j < 4) {
      decKey[j] = tmp;
    } else {
      decKey[j] = decTable[0][sbox[tmp >>> 24 ]] ^
        decTable[1][sbox[tmp >> 16 & 255]] ^
        decTable[2][sbox[tmp >> 8 & 255]] ^
        decTable[3][sbox[tmp & 255]];
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
  _tables: [[[], [], [], [], []], [[], [], [], [], []]],

  /**
   * Expand the S-box tables.
   *
   * @private
   */
  _precompute() {
    let encTable = this._tables[0];
    let decTable = this._tables[1];
    let sbox = encTable[4];
    let sboxInv = decTable[4];
    let i;
    let x;
    let xInv;
    let d = [];
    let th = [];
    let x2;
    let x4;
    let x8;
    let s;
    let tEnc;
    let tDec;

    // Compute double and third tables
    for (i = 0; i < 256; i++) {
      th[(d[i] = i << 1 ^ (i >> 7) * 283) ^ i] = i;
    }

    for (x = xInv = 0; !sbox[x]; x ^= x2 || 1, xInv = th[xInv] || 1) {
      // Compute sbox
      s = xInv ^ xInv << 1 ^ xInv << 2 ^ xInv << 3 ^ xInv << 4;
      s = s >> 8 ^ s & 255 ^ 99;
      sbox[x] = s;
      sboxInv[s] = x;

      // Compute MixColumns
      x8 = d[x4 = d[x2 = d[x]]];
      tDec = x8 * 0x1010101 ^ x4 * 0x10001 ^ x2 * 0x101 ^ x * 0x1010100;
      tEnc = d[s] * 0x101 ^ s * 0x1010100;

      for (i = 0; i < 4; i++) {
        encTable[i][x] = tEnc = tEnc << 24 ^ tEnc >>> 8;
        decTable[i][s] = tDec = tDec << 24 ^ tDec >>> 8;
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
  decrypt(encrypted0, encrypted1, encrypted2, encrypted3, out, offset) {
    let key = this._key[1];
    // state variables a,b,c,d are loaded with pre-whitened data
    let a = encrypted0 ^ key[0];
    let b = encrypted3 ^ key[1];
    let c = encrypted2 ^ key[2];
    let d = encrypted1 ^ key[3];
    let a2;
    let b2;
    let c2;

    // key.length === 2 ?
    let nInnerRounds = key.length / 4 - 2;
    let i;
    let kIndex = 4;
    let table = this._tables[1];

    // load up the tables
    let table0 = table[0];
    let table1 = table[1];
    let table2 = table[2];
    let table3 = table[3];
    let sbox = table[4];

    // Inner rounds. Cribbed from OpenSSL.
    for (i = 0; i < nInnerRounds; i++) {
      a2 = table0[a >>> 24] ^
        table1[b >> 16 & 255] ^
        table2[c >> 8 & 255] ^
        table3[d & 255] ^
        key[kIndex];
      b2 = table0[b >>> 24] ^
        table1[c >> 16 & 255] ^
        table2[d >> 8 & 255] ^
        table3[a & 255] ^
        key[kIndex + 1];
      c2 = table0[c >>> 24] ^
        table1[d >> 16 & 255] ^
        table2[a >> 8 & 255] ^
        table3[b & 255] ^
        key[kIndex + 2];
      d = table0[d >>> 24] ^
        table1[a >> 16 & 255] ^
        table2[b >> 8 & 255] ^
        table3[c & 255] ^
        key[kIndex + 3];
      kIndex += 4;
      a = a2; b = b2; c = c2;
    }

    // Last round.
    for (i = 0; i < 4; i++) {
      out[(3 & -i) + offset] =
        sbox[a >>> 24] << 24 ^
        sbox[b >> 16 & 255] << 16 ^
        sbox[c >> 8 & 255] << 8 ^
        sbox[d & 255] ^
        key[kIndex++];
      a2 = a; a = b; b = c; c = d; d = a2;
    }
  }
};

export default AES;

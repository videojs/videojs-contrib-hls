import AsyncStream from './async-stream';
import Stream from '../stream';
import ntoh from './ntoh';
import {unpad} from 'pkcs7';
import decrypt from './decrypt';

const Decrypter = function(encrypted, key, initVector, done) {
  let step = Decrypter.STEP;
  let encrypted32 = new Int32Array(encrypted.buffer);
  let decrypted = new Uint8Array(encrypted.byteLength);
  let i = 0;

  this.asyncStream_ = new AsyncStream();

  // split up the encryption job and do the individual chunks asynchronously
  this.asyncStream_.push(this.decryptChunk_(
    encrypted32.subarray(i, i + step),
    key,
    initVector,
    decrypted,
    i
  ));
  for (i = step; i < encrypted32.length; i += step) {
    initVector = new Uint32Array([
      ntoh(encrypted32[i - 4]),
      ntoh(encrypted32[i - 3]),
      ntoh(encrypted32[i - 2]),
      ntoh(encrypted32[i - 1])
    ]);
    this.asyncStream_.push(this.decryptChunk_(
      encrypted32.subarray(i, i + step),
      key,
      initVector,
      decrypted
    ));
  }
  // invoke the done() callback when everything is finished
  this.asyncStream_.push(function() {
    // remove pkcs#7 padding from the decrypted bytes
    done(null, unpad(decrypted));
  });
};

Decrypter.prototype = new Stream();
Decrypter.prototype.decryptChunk_ = function(encrypted, key, initVector, decrypted) {
  return function() {
    let bytes = decrypt(
      encrypted,
      key,
      initVector
    );

    decrypted.set(bytes, encrypted.byteOffset);
  };
};
// the maximum number of bytes to process at one time
Decrypter.STEP = 4 * 8000;

export default Decrypter;

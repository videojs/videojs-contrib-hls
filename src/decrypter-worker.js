import window from 'global/window';
import {Decrypter} from 'aes-decrypter';

/**
 * Callback method to send the decrypted segment bytes back to the main thread
 *
 * @param {Object} err
 *        Decryption error. Will always be null with aes-decrypter ^1.0.3
 * @param {Uint8Array} bytes
 *        Decrypted byte array
 * @function postDecrypted
 */
const postDecrypted = function(err, bytes) {
  window.postMessage({
    action: 'done',
    source: this.source,
    bytes: bytes.buffer,
    byteOffset: bytes.byteOffset,
    byteLength: bytes.byteLength
  }, [bytes.buffer]);
};

/**
 * Our web wroker interface so that things can talk to aes-decrypter
 * that will be running in a web worker. the scope is passed to this by
 * webworkify.
 *
 * @param {Object} self
 *        the scope for the web worker
 */
const Worker = function(self) {
  self.onmessage = function(event) {
    const data = event.data;
    if (data.action === 'decrypt') {
      const encrypted = new Uint8Array(data.encrypted.bytes,
                                     data.encrypted.byteOffset,
                                     data.encrypted.byteLength);
      const key = new Uint32Array(data.key.bytes,
                                data.key.byteOffset,
                                data.key.byteLength / 4);
      const iv = new Uint32Array(data.iv.bytes,
                               data.iv.byteOffset,
                               data.iv.byteLength / 4);
      const context = {
        source: data.source
      };

      new Decrypter(encrypted,
                    key,
                    iv,
                    postDecrypted.bind(context));
    }
  };
};

export default (self) => {
  return new Worker(self);
};

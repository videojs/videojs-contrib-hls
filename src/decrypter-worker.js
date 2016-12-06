import window from 'global/window';
import {Decrypter} from 'aes-decrypter';

/**
 * Our web wroker interface so that things can talk to aes-decrypter
 * that will be running in a web worker. the scope is passed to this by
 * webworkify.
 *
 * @param {Object} self the scope for the web worker
 */
const Worker = function(self) {
  self.onmessage = function(event) {
    let data = event.data;

    if (data.action === 'decrypt') {
      let encrypted = new Uint8Array(data.encrypted.bytes,
                                     data.encrypted.byteOffset,
                                     data.encrypted.byteLength);
      let key = new Uint32Array(data.key.bytes,
                                data.key.byteOffset,
                                data.key.byteLength / 4);
      let iv = new Uint32Array(data.iv.bytes,
                               data.iv.byteOffset,
                               data.iv.byteLength / 4);
      let fn = function(err, bytes) {
        if (err) {
          return;
        }

        window.postMessage({
          action: 'done',
          bytes: bytes.buffer,
          byteOffset: bytes.byteOffset,
          byteLength: bytes.byteLength
        }, [bytes.buffer]);
      };

      return new Decrypter(encrypted, key, iv, fn);
    }
  };
};

export default (self) => {
  return new Worker(self);
};

import window from 'global/window';
import {Decrypter} from 'aes-decrypter';

/**
 * Our web worker interface so that things can talk to aes-decrypter
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

      /* eslint-disable no-new, handle-callback-err */
      new Decrypter(encrypted,
                    key,
                    iv,
                    function(err, bytes) {
                      window.postMessage({
                        action: 'done',
                        source: data.source,
                        bytes: bytes.buffer,
                        byteOffset: bytes.byteOffset,
                        byteLength: bytes.byteLength
                      }, [bytes.buffer]);
                    });
      /* eslint-enable */
    }
  };
};

export default (self) => {
  return new Worker(self);
};

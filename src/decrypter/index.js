/**
 * @file decrypter/index.js
 *
 * Index module to easily import the primary components of AES-128
 * decryption. Like this:
 *
 * ```js
 * import {Decrypter, decrypt, AsyncStream} from './src/decrypter';
 * ```
 */
import {decrypt, Decrypter} from './decrypter';
import AsyncStream from './async-stream';

export default {
  decrypt,
  Decrypter,
  AsyncStream
};

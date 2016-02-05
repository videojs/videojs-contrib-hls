/**
 * Main file for Decrypter so that we can neatly export
 * all of our functionality as one object in one file
 * and we will only have to require the top level directory
 * in this case that would look like:
 * ``` JavaScript
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

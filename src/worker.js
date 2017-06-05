import worker from 'webworkify';
import Decrypter from './decrypter-worker.js';

export default () => worker(Decrypter);

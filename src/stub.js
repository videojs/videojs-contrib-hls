import m3u8 from './m3u8';
import Stream from './stream';
import videojs from 'video.js';
import {Decrypter, decrypt, AsyncStream} from './decrypter';

if(typeof window.videojs.Hls === 'undefined') {
  videojs.Hls = {};
}
videojs.Hls.Stream = Stream;
videojs.m3u8 = m3u8;
videojs.Hls.decrypt = decrypt;
videojs.Hls.Decrypter = Decrypter;
videojs.Hls.AsyncStream = AsyncStream;

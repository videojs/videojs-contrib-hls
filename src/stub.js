import m3u8 from './m3u8';
import Stream from './Stream';
import videojs from 'video.js';

if(typeof window.videojs.Hls === 'undefined') {
  videojs.Hls = {};
}
videojs.Hls.Stream = Stream;
videojs.m3u8 = m3u8;


import m3u8 from './m3u8';
import Stream from './stream';
import videojs from 'video.js';
import {Decrypter, decrypt, AsyncStream} from './decrypter';
import Playlist from './playlist';
import PlaylistLoader from './playlist-loader';
import xhr from './xhr';


if(typeof window.videojs.Hls === 'undefined') {
  videojs.Hls = {};
}
videojs.Hls.Stream = Stream;
videojs.m3u8 = m3u8;
videojs.Hls.decrypt = decrypt;
videojs.Hls.Decrypter = Decrypter;
videojs.Hls.AsyncStream = AsyncStream;
videojs.Hls.xhr = xhr;
videojs.Hls.Playlist = Playlist;
videojs.Hls.PlaylistLoader = PlaylistLoader;

/**
 * videojs-hls
 * The main file for the HLS project.
 * License: https://github.com/videojs/videojs-contrib-hls/blob/master/LICENSE
 */
import PlaylistLoader from './playlist-loader';
import Playlist from './playlist';
import xhr from './xhr';
import {Decrypter, AsyncStream, decrypt} from './decrypter';
import utils from './bin-utils';
import {MediaSource, URL} from 'videojs-contrib-media-sources';
import m3u8 from './m3u8';
import {default as videojs, AudioTrack} from 'video.js';
import MasterPlaylistController from './master-playlist-controller';

const Hls = {
  PlaylistLoader,
  Playlist,
  Decrypter,
  AsyncStream,
  decrypt,
  utils,
  xhr
};

// the desired length of video to maintain in the buffer, in seconds
Hls.GOAL_BUFFER_LENGTH = 30;

// HLS is a source handler, not a tech. Make sure attempts to use it
// as one do not cause exceptions.
Hls.canPlaySource = function() {
  return videojs.log.warn('HLS is no longer a tech. Please remove it from ' +
                          'your player\'s techOrder.');
};

/**
 * Whether the browser has built-in HLS support.
 */
Hls.supportsNativeHls = (function() {
  let video = document.createElement('video');
  let xMpegUrl;
  let vndMpeg;

  // native HLS is definitely not supported if HTML5 video isn't
  if (!videojs.getComponent('Html5').isSupported()) {
    return false;
  }

  xMpegUrl = video.canPlayType('application/x-mpegURL');
  vndMpeg = video.canPlayType('application/vnd.apple.mpegURL');
  return (/probably|maybe/).test(xMpegUrl) ||
    (/probably|maybe/).test(vndMpeg);
}());

// HLS is a source handler, not a tech. Make sure attempts to use it
// as one do not cause exceptions.
Hls.isSupported = function() {
  return videojs.log.warn('HLS is no longer a tech. Please remove it from ' +
                          'your player\'s techOrder.');
};

const Component = videojs.getComponent('Component');

export default class HlsHandler extends Component {
  constructor(tech, options) {
    super(tech);
    let _player;

    // tech.player() is deprecated but setup a reference to HLS for
    // backwards-compatibility
    if (tech.options_ && tech.options_.playerId) {
      _player = videojs(tech.options_.playerId);
      if (!_player.hls) {
        Object.defineProperty(_player, 'hls', {
          get: () => {
            videojs.log.warn('player.hls is deprecated. Use player.tech.hls instead.');
            return this;
          }
        });
      }
    }
    this.tech_ = tech;
    this.source_ = options.source;
    this.mode_ = options.mode;

    // start playlist selection at a reasonable bandwidth for
    // broadband internet
    // 0.5 Mbps
    this.bandwidth = options.bandwidth || 4194304;
    this.bytesReceived = 0;

    this.on(this.tech_, 'seeking', function() {
      this.setCurrentTime(this.tech_.currentTime());
    });
    this.on(this.tech_, 'error', function() {
      if (this.masterPlaylistController_) {
        this.masterPlaylistController_.pauseLoading();
      }
    });

    this.audioTrackChange_ = () => {
      this.masterPlaylistController_.useAudio();
    };

    this.on(this.tech_, 'play', this.play);
  }

  src(src) {
    // do nothing if the src is falsey
    if (!src) {
      return;
    }

    this.options_ = {};
    if (typeof this.source_.withCredentials !== 'undefined') {
      this.options_.withCredentials = this.source_.withCredentials;
    } else if (videojs.options.hls) {
      this.options_.withCredentials = videojs.options.hls.withCredentials;
    }

    this.masterPlaylistController_ = new MasterPlaylistController({
      url: this.source_.src,
      withCredentials: this.options_.withCredentials,
      currentTimeFunc: this.tech_.currentTime.bind(this.tech_),
      mediaSourceMode: this.mode_,
      hlsHandler: this,
      externHls: Hls
    });

    this.tech_.one('canplay',
      this.masterPlaylistController_.setupFirstPlay.bind(this.masterPlaylistController_));

    this.masterPlaylistController_.on('sourceopen', () => {
      this.tech_.audioTracks().addEventListener('change', this.audioTrackChange_);
    });

    this.masterPlaylistController_.on('selectedinitialmedia', () => {
      let audioTrackList = this.tech_.audioTracks();
      let media = this.masterPlaylistController_.media();
      let master = this.masterPlaylistController_.master();
      let mediaGroups = master.mediaGroups;
      let attributes = {
        audio: {main: {default: true}}
      };

      if (!media.attributes) {
        // source URL was playlist manifest, not master
        // no audio tracks to add
        return;
      }

      // only do alternative audio tracks in html5 mode, and if we have them
      if (this.mode_ === 'html5' &&
          media.attributes &&
          media.attributes.AUDIO &&
         mediaGroups.AUDIO[media.attributes.AUDIO]) {
        attributes.audio = mediaGroups.AUDIO[media.attributes.AUDIO];
      }

      // clear current audioTracks
      while (audioTrackList.length > 0) {
        let track = audioTrackList[(audioTrackList.length - 1)];

        audioTrackList.removeTrack(track);
      }

      for (let label in attributes.audio) {
        let hlstrack = attributes.audio[label];

        // disable eslint here so ie8 works
        /* eslint-disable dot-notation */
        audioTrackList.addTrack(new AudioTrack({
          kind: hlstrack['default'] ? 'main' : 'alternative',
          language: hlstrack.language || '',
          enabled: hlstrack['default'] || false,
          label
        }));
        /* eslint-enable dot-notation */
      }
      this.masterPlaylistController_.useAudio();
    });

    this.masterPlaylistController_.on('loadedmetadata', () => {
      this.tech_.trigger('loadedmetadata');
    });

    // do nothing if the tech has been disposed already
    // this can occur if someone sets the src in player.ready(), for instance
    if (!this.tech_.el()) {
      return;
    }

    this.tech_.src(videojs.URL.createObjectURL(
      this.masterPlaylistController_.mediaSource));
  }

  /**
   * Begin playing the video.
   */
  play() {
    if (this.tech_.ended()) {
      this.tech_.setCurrentTime(0);
    }

    this.masterPlaylistController_.load();

    if (this.tech_.played().length === 0) {
      return this.masterPlaylistController_.setupFirstPlay();
    }

    // if the viewer has paused and we fell out of the live window,
    // seek forward to the earliest available position
    if (this.duration() === Infinity) {
      if (this.tech_.currentTime() < this.seekable().start(0)) {
        this.tech_.setCurrentTime(this.seekable().start(0));
      }
    }
  }

  setCurrentTime(currentTime) {
    this.masterPlaylistController_.setCurrentTime(currentTime);
  }

  duration() {
    return this.masterPlaylistController_.duration();
  }

  seekable() {
    return this.masterPlaylistController_.seekable();
  }

  /**
  * Abort all outstanding work and cleanup.
  */
  dispose() {
    if (this.masterPlaylistController_) {
      this.masterPlaylistController_.dispose();
    }
    this.tech_.audioTracks().removeEventListener('change', this.audioTrackChange_);

    super.dispose();
  }
}

/**
 * The Source Handler object, which informs video.js what additional
 * MIME types are supported and sets up playback. It is registered
 * automatically to the appropriate tech based on the capabilities of
 * the browser it is running in. It is not necessary to use or modify
 * this object in normal usage.
 */
const HlsSourceHandler = function(mode) {
  return {
    canHandleSource(srcObj) {
      return HlsSourceHandler.canPlayType(srcObj.type);
    },
    handleSource(source, tech) {
      if (mode === 'flash') {
        // We need to trigger this asynchronously to give others the chance
        // to bind to the event when a source is set at player creation
        tech.setTimeout(function() {
          tech.trigger('loadstart');
        }, 1);
      }
      tech.hls = new HlsHandler(tech, {
        source,
        mode
      });
      tech.hls.src(source.src);
      return tech.hls;
    },
    canPlayType(type) {
      return HlsSourceHandler.canPlayType(type);
    }
  };
};

/**
 * A comparator function to sort two playlist object by bandwidth.
 * @param left {object} a media playlist object
 * @param right {object} a media playlist object
 * @return {number} Greater than zero if the bandwidth attribute of
 * left is greater than the corresponding attribute of right. Less
 * than zero if the bandwidth of right is greater than left and
 * exactly zero if the two are equal.
 */
Hls.comparePlaylistBandwidth = function(left, right) {
  let leftBandwidth;
  let rightBandwidth;

  if (left.attributes && left.attributes.BANDWIDTH) {
    leftBandwidth = left.attributes.BANDWIDTH;
  }
  leftBandwidth = leftBandwidth || window.Number.MAX_VALUE;
  if (right.attributes && right.attributes.BANDWIDTH) {
    rightBandwidth = right.attributes.BANDWIDTH;
  }
  rightBandwidth = rightBandwidth || window.Number.MAX_VALUE;

  return leftBandwidth - rightBandwidth;
};

/**
 * A comparator function to sort two playlist object by resolution (width).
 * @param left {object} a media playlist object
 * @param right {object} a media playlist object
 * @return {number} Greater than zero if the resolution.width attribute of
 * left is greater than the corresponding attribute of right. Less
 * than zero if the resolution.width of right is greater than left and
 * exactly zero if the two are equal.
 */
Hls.comparePlaylistResolution = function(left, right) {
  let leftWidth;
  let rightWidth;

  if (left.attributes &&
      left.attributes.RESOLUTION &&
      left.attributes.RESOLUTION.width) {
    leftWidth = left.attributes.RESOLUTION.width;
  }

  leftWidth = leftWidth || window.Number.MAX_VALUE;

  if (right.attributes &&
      right.attributes.RESOLUTION &&
      right.attributes.RESOLUTION.width) {
    rightWidth = right.attributes.RESOLUTION.width;
  }

  rightWidth = rightWidth || window.Number.MAX_VALUE;

  // NOTE - Fallback to bandwidth sort as appropriate in cases where multiple renditions
  // have the same media dimensions/ resolution
  if (leftWidth === rightWidth &&
      left.attributes.BANDWIDTH &&
      right.attributes.BANDWIDTH) {
    return left.attributes.BANDWIDTH - right.attributes.BANDWIDTH;
  }
  return leftWidth - rightWidth;
};

HlsSourceHandler.canPlayType = function(type) {
  let mpegurlRE = /^application\/(?:x-|vnd\.apple\.)mpegurl/i;

  // favor native HLS support if it's available
  if (Hls.supportsNativeHls) {
    return false;
  }
  return mpegurlRE.test(type);
};

if (typeof videojs.MediaSource === 'undefined' ||
    typeof videojs.URL === 'undefined') {
  videojs.MediaSource = MediaSource;
  videojs.URL = URL;
}

// register source handlers with the appropriate techs
if (MediaSource.supportsNativeMediaSources()) {
  videojs.getComponent('Html5').registerSourceHandler(HlsSourceHandler('html5'));
}
if (window.Uint8Array) {
  videojs.getComponent('Flash').registerSourceHandler(HlsSourceHandler('flash'));
}

videojs.HlsHandler = HlsHandler;
videojs.HlsSourceHandler = HlsSourceHandler;
videojs.Hls = Hls;
videojs.m3u8 = m3u8;

export default {
  Hls,
  HlsHandler,
  HlsSourceHandler
};

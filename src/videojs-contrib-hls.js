/**
 * @file videojs-contrib-hls.js
 *
 * The main file for the HLS project.
 * License: https://github.com/videojs/videojs-contrib-hls/blob/master/LICENSE
 */
import document from 'global/document';
import PlaylistLoader from './playlist-loader';
import Playlist from './playlist';
import xhrFactory from './xhr';
import {Decrypter, AsyncStream, decrypt} from 'aes-decrypter';
import utils from './bin-utils';
import {MediaSource, URL} from 'videojs-contrib-media-sources';
import m3u8 from 'm3u8-parser';
import videojs from 'video.js';
import { MasterPlaylistController } from './master-playlist-controller';
import Config from './config';
import renditionSelectionMixin from './rendition-mixin';
import window from 'global/window';
import PlaybackWatcher from './playback-watcher';
import reloadSourceOnError from './reload-source-on-error';
import {
  lastBandwidthSelector,
  lowestBitrateCompatibleVariantSelector,
  comparePlaylistBandwidth,
  comparePlaylistResolution
} from './playlist-selectors.js';

const Hls = {
  PlaylistLoader,
  Playlist,
  Decrypter,
  AsyncStream,
  decrypt,
  utils,

  STANDARD_PLAYLIST_SELECTOR: lastBandwidthSelector,
  INITIAL_PLAYLIST_SELECTOR: lowestBitrateCompatibleVariantSelector,
  comparePlaylistBandwidth,
  comparePlaylistResolution,

  xhr: xhrFactory()
};

// 0.5 MB/s
const INITIAL_BANDWIDTH = 4194304;

// Define getter/setters for config properites
[
  'GOAL_BUFFER_LENGTH',
  'MAX_GOAL_BUFFER_LENGTH',
  'GOAL_BUFFER_LENGTH_RATE',
  'BUFFER_LOW_WATER_LINE',
  'MAX_BUFFER_LOW_WATER_LINE',
  'BUFFER_LOW_WATER_LINE_RATE',
  'BANDWIDTH_VARIANCE'
].forEach((prop) => {
  Object.defineProperty(Hls, prop, {
    get() {
      videojs.log.warn(`using Hls.${prop} is UNSAFE be sure you know what you are doing`);
      return Config[prop];
    },
    set(value) {
      videojs.log.warn(`using Hls.${prop} is UNSAFE be sure you know what you are doing`);

      if (typeof value !== 'number' || value < 0) {
        videojs.log.warn(`value of Hls.${prop} must be greater than or equal to 0`);
        return;
      }

      Config[prop] = value;
    }
  });
});

/**
 * Updates the selectedIndex of the QualityLevelList when a mediachange happens in hls.
 *
 * @param {QualityLevelList} qualityLevels The QualityLevelList to update.
 * @param {PlaylistLoader} playlistLoader PlaylistLoader containing the new media info.
 * @function handleHlsMediaChange
 */
const handleHlsMediaChange = function(qualityLevels, playlistLoader) {
  let newPlaylist = playlistLoader.media();
  let selectedIndex = -1;

  for (let i = 0; i < qualityLevels.length; i++) {
    if (qualityLevels[i].id === newPlaylist.uri) {
      selectedIndex = i;
      break;
    }
  }

  qualityLevels.selectedIndex_ = selectedIndex;
  qualityLevels.trigger({
    selectedIndex,
    type: 'change'
  });
};

/**
 * Adds quality levels to list once playlist metadata is available
 *
 * @param {QualityLevelList} qualityLevels The QualityLevelList to attach events to.
 * @param {Object} hls Hls object to listen to for media events.
 * @function handleHlsLoadedMetadata
 */
const handleHlsLoadedMetadata = function(qualityLevels, hls) {
  hls.representations().forEach((rep) => {
    qualityLevels.addQualityLevel(rep);
  });
  handleHlsMediaChange(qualityLevels, hls.playlists);
};

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

  // native HLS is definitely not supported if HTML5 video isn't
  if (!videojs.getTech('Html5').isSupported()) {
    return false;
  }

  // HLS manifests can go by many mime-types
  let canPlay = [
    // Apple santioned
    'application/vnd.apple.mpegurl',
    // Apple sanctioned for backwards compatibility
    'audio/mpegurl',
    // Very common
    'audio/x-mpegurl',
    // Very common
    'application/x-mpegurl',
    // Included for completeness
    'video/x-mpegurl',
    'video/mpegurl',
    'application/mpegurl'
  ];

  return canPlay.some(function(canItPlay) {
    return (/maybe|probably/i).test(video.canPlayType(canItPlay));
  });
}());

/**
 * HLS is a source handler, not a tech. Make sure attempts to use it
 * as one do not cause exceptions.
 */
Hls.isSupported = function() {
  return videojs.log.warn('HLS is no longer a tech. Please remove it from ' +
                          'your player\'s techOrder.');
};

const Component = videojs.getComponent('Component');

/**
 * The Hls Handler object, where we orchestrate all of the parts
 * of HLS to interact with video.js
 *
 * @class HlsHandler
 * @extends videojs.Component
 * @param {Object} source the soruce object
 * @param {Tech} tech the parent tech object
 * @param {Object} options optional and required options
 */
class HlsHandler extends Component {
  constructor(source, tech, options) {
    super(tech, options.hls);

    // tech.player() is deprecated but setup a reference to HLS for
    // backwards-compatibility
    if (tech.options_ && tech.options_.playerId) {
      let _player = videojs(tech.options_.playerId);

      if (!_player.hasOwnProperty('hls')) {
        Object.defineProperty(_player, 'hls', {
          get: () => {
            videojs.log.warn('player.hls is deprecated. Use player.tech_.hls instead.');
            tech.trigger({type: 'usage', name: 'hls-player-access'});
            return this;
          }
        });
      }
    }

    this.tech_ = tech;
    this.source_ = source;
    this.stats = {};
    this.ignoreNextSeekingEvent_ = false;
    this.setOptions_();

    // overriding native HLS only works if audio tracks have been emulated
    // error early if we're misconfigured:
    if (this.options_.overrideNative &&
        (tech.featuresNativeVideoTracks || tech.featuresNativeAudioTracks)) {
      throw new Error('Overriding native HLS requires emulated tracks. ' +
                      'See https://git.io/vMpjB');
    }

    // listen for fullscreenchange events for this player so that we
    // can adjust our quality selection quickly
    this.on(document, [
      'fullscreenchange', 'webkitfullscreenchange',
      'mozfullscreenchange', 'MSFullscreenChange'
    ], (event) => {
      let fullscreenElement = document.fullscreenElement ||
          document.webkitFullscreenElement ||
          document.mozFullScreenElement ||
          document.msFullscreenElement;

      if (fullscreenElement && fullscreenElement.contains(this.tech_.el())) {
        this.masterPlaylistController_.fastQualityChange_();
      }
    });

    this.on(this.tech_, 'seeking', function() {
      if (this.ignoreNextSeekingEvent_) {
        this.ignoreNextSeekingEvent_ = false;
        return;
      }

      this.setCurrentTime(this.tech_.currentTime());
    });
    this.on(this.tech_, 'error', function() {
      if (this.masterPlaylistController_) {
        this.masterPlaylistController_.pauseLoading();
      }
    });

    this.on(this.tech_, 'play', this.play);
  }

  setOptions_() {
    // defaults
    this.options_.withCredentials = this.options_.withCredentials || false;

    if (typeof this.options_.blacklistDuration !== 'number') {
      this.options_.blacklistDuration = 5 * 60;
    }

    // start playlist selection at a reasonable bandwidth for
    // broadband internet (0.5 MB/s) or mobile (0.0625 MB/s)
    if (typeof this.options_.bandwidth !== 'number') {
      this.options_.bandwidth = INITIAL_BANDWIDTH;
    }

    // If the bandwidth number is unchanged from the initial setting
    // then this takes precedence over the enableLowInitialPlaylist option
    this.options_.enableLowInitialPlaylist =
       this.options_.enableLowInitialPlaylist &&
       this.options_.bandwidth === INITIAL_BANDWIDTH;

    // grab options passed to player.src
    ['withCredentials', 'bandwidth'].forEach((option) => {
      if (typeof this.source_[option] !== 'undefined') {
        this.options_[option] = this.source_[option];
      }
    });

    this.bandwidth = this.options_.bandwidth;
  }
  /**
   * called when player.src gets called, handle a new source
   *
   * @param {Object} src the source object to handle
   */
  src(src) {
    // do nothing if the src is falsey
    if (!src) {
      return;
    }
    this.setOptions_();
    // add master playlist controller options
    this.options_.url = this.source_.src;
    this.options_.tech = this.tech_;
    this.options_.externHls = Hls;

    this.masterPlaylistController_ = new MasterPlaylistController(this.options_);
    this.playbackWatcher_ = new PlaybackWatcher(
      videojs.mergeOptions(this.options_, {
        seekable: () => this.seekable()
      }));

    this.masterPlaylistController_.on('error', () => {
      let player = videojs.players[this.tech_.options_.playerId];

      player.error(this.masterPlaylistController_.error);
    });

    // `this` in selectPlaylist should be the HlsHandler for backwards
    // compatibility with < v2
    this.masterPlaylistController_.selectPlaylist =
      this.selectPlaylist ?
        this.selectPlaylist.bind(this) : Hls.STANDARD_PLAYLIST_SELECTOR.bind(this);

    this.masterPlaylistController_.selectInitialPlaylist =
      Hls.INITIAL_PLAYLIST_SELECTOR.bind(this);

    // re-expose some internal objects for backwards compatibility with < v2
    this.playlists = this.masterPlaylistController_.masterPlaylistLoader_;
    this.mediaSource = this.masterPlaylistController_.mediaSource;

    // Proxy assignment of some properties to the master playlist
    // controller. Using a custom property for backwards compatibility
    // with < v2
    Object.defineProperties(this, {
      selectPlaylist: {
        get() {
          return this.masterPlaylistController_.selectPlaylist;
        },
        set(selectPlaylist) {
          this.masterPlaylistController_.selectPlaylist = selectPlaylist.bind(this);
        }
      },
      throughput: {
        get() {
          return this.masterPlaylistController_.mainSegmentLoader_.throughput.rate;
        },
        set(throughput) {
          this.masterPlaylistController_.mainSegmentLoader_.throughput.rate = throughput;
          // By setting `count` to 1 the throughput value becomes the starting value
          // for the cumulative average
          this.masterPlaylistController_.mainSegmentLoader_.throughput.count = 1;
        }
      },
      bandwidth: {
        get() {
          return this.masterPlaylistController_.mainSegmentLoader_.bandwidth;
        },
        set(bandwidth) {
          this.masterPlaylistController_.mainSegmentLoader_.bandwidth = bandwidth;
          // setting the bandwidth manually resets the throughput counter
          // `count` is set to zero that current value of `rate` isn't included
          // in the cumulative average
          this.masterPlaylistController_.mainSegmentLoader_.throughput = {
            rate: 0,
            count: 0
          };
        }
      },
      /**
       * `systemBandwidth` is a combination of two serial processes bit-rates. The first
       * is the network bitrate provided by `bandwidth` and the second is the bitrate of
       * the entire process after that - decryption, transmuxing, and appending - provided
       * by `throughput`.
       *
       * Since the two process are serial, the overall system bandwidth is given by:
       *   sysBandwidth = 1 / (1 / bandwidth + 1 / throughput)
       */
      systemBandwidth: {
        get() {
          let invBandwidth = 1 / (this.bandwidth || 1);
          let invThroughput;

          if (this.throughput > 0) {
            invThroughput = 1 / this.throughput;
          } else {
            invThroughput = 0;
          }

          let systemBitrate = Math.floor(1 / (invBandwidth + invThroughput));

          return systemBitrate;
        },
        set() {
          videojs.log.error('The "systemBandwidth" property is read-only');
        }
      }
    });

    Object.defineProperties(this.stats, {
      bandwidth: {
        get: () => this.bandwidth || 0,
        enumerable: true
      },
      mediaRequests: {
        get: () => this.masterPlaylistController_.mediaRequests_() || 0,
        enumerable: true
      },
      mediaRequestsAborted: {
        get: () => this.masterPlaylistController_.mediaRequestsAborted_() || 0,
        enumerable: true
      },
      mediaRequestsTimedout: {
        get: () => this.masterPlaylistController_.mediaRequestsTimedout_() || 0,
        enumerable: true
      },
      mediaRequestsErrored: {
        get: () => this.masterPlaylistController_.mediaRequestsErrored_() || 0,
        enumerable: true
      },
      mediaTransferDuration: {
        get: () => this.masterPlaylistController_.mediaTransferDuration_() || 0,
        enumerable: true
      },
      mediaBytesTransferred: {
        get: () => this.masterPlaylistController_.mediaBytesTransferred_() || 0,
        enumerable: true
      },
      mediaSecondsLoaded: {
        get: () => this.masterPlaylistController_.mediaSecondsLoaded_() || 0,
        enumerable: true
      }
    });

    this.tech_.one('canplay',
      this.masterPlaylistController_.setupFirstPlay.bind(this.masterPlaylistController_));

    this.masterPlaylistController_.on('selectedinitialmedia', () => {
      // Add the manual rendition mix-in to HlsHandler
      renditionSelectionMixin(this);
    });

    // the bandwidth of the primary segment loader is our best
    // estimate of overall bandwidth
    this.on(this.masterPlaylistController_, 'progress', function() {
      this.tech_.trigger('progress');
    });

    // In the live case, we need to ignore the very first `seeking` event since
    // that will be the result of the seek-to-live behavior
    this.on(this.masterPlaylistController_, 'firstplay', function() {
      this.ignoreNextSeekingEvent_ = true;
    });

    this.tech_.ready(() => this.setupQualityLevels_());

    // do nothing if the tech has been disposed already
    // this can occur if someone sets the src in player.ready(), for instance
    if (!this.tech_.el()) {
      return;
    }

    this.tech_.src(videojs.URL.createObjectURL(
      this.masterPlaylistController_.mediaSource));
  }

  /**
   * Initializes the quality levels and sets listeners to update them.
   *
   * @method setupQualityLevels_
   * @private
   */
  setupQualityLevels_() {
    let player = videojs.players[this.tech_.options_.playerId];

    if (player && player.qualityLevels) {
      this.qualityLevels_ = player.qualityLevels();

      this.masterPlaylistController_.on('selectedinitialmedia', () => {
        handleHlsLoadedMetadata(this.qualityLevels_, this);
      });

      this.playlists.on('mediachange', () => {
        handleHlsMediaChange(this.qualityLevels_, this.playlists);
      });
    }
  }

  /**
   * Begin playing the video.
   */
  play() {
    this.masterPlaylistController_.play();
  }

  /**
   * a wrapper around the function in MasterPlaylistController
   */
  setCurrentTime(currentTime) {
    this.masterPlaylistController_.setCurrentTime(currentTime);
  }

  /**
   * a wrapper around the function in MasterPlaylistController
   */
  duration() {
    return this.masterPlaylistController_.duration();
  }

  /**
   * a wrapper around the function in MasterPlaylistController
   */
  seekable() {
    return this.masterPlaylistController_.seekable();
  }

  /**
  * Abort all outstanding work and cleanup.
  */
  dispose() {
    if (this.playbackWatcher_) {
      this.playbackWatcher_.dispose();
    }
    if (this.masterPlaylistController_) {
      this.masterPlaylistController_.dispose();
    }
    if (this.qualityLevels_) {
      this.qualityLevels_.dispose();
    }
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
    canHandleSource(srcObj, options = {}) {
      let localOptions = videojs.mergeOptions(videojs.options, options);

      // this forces video.js to skip this tech/mode if its not the one we have been
      // overriden to use, by returing that we cannot handle the source.
      if (localOptions.hls &&
          localOptions.hls.mode &&
          localOptions.hls.mode !== mode) {
        return false;
      }
      return HlsSourceHandler.canPlayType(srcObj.type, localOptions);
    },
    handleSource(source, tech, options = {}) {
      let localOptions = videojs.mergeOptions(videojs.options, options, {hls: {mode}});

      if (mode === 'flash') {
        // We need to trigger this asynchronously to give others the chance
        // to bind to the event when a source is set at player creation
        tech.setTimeout(function() {
          tech.trigger('loadstart');
        }, 1);
      }

      tech.hls = new HlsHandler(source, tech, localOptions);
      tech.hls.xhr = xhrFactory();

      tech.hls.src(source.src);
      return tech.hls;
    },
    canPlayType(type, options = {}) {
      let localOptions = videojs.mergeOptions(videojs.options, options);

      if (HlsSourceHandler.canPlayType(type, localOptions)) {
        return 'maybe';
      }
      return '';
    }
  };
};

HlsSourceHandler.canPlayType = function(type, options) {
  // No support for IE 10 or below
  if (videojs.browser.IE_VERSION && videojs.browser.IE_VERSION <= 10) {
    return false;
  }

  let mpegurlRE = /^(audio|video|application)\/(x-|vnd\.apple\.)?mpegurl/i;

  // favor native HLS support if it's available
  if (!options.hls.overrideNative && Hls.supportsNativeHls) {
    return false;
  }
  return mpegurlRE.test(type);
};

if (typeof videojs.MediaSource === 'undefined' ||
    typeof videojs.URL === 'undefined') {
  videojs.MediaSource = MediaSource;
  videojs.URL = URL;
}

const flashTech = videojs.getTech('Flash');

// register source handlers with the appropriate techs
if (MediaSource.supportsNativeMediaSources()) {
  videojs.getTech('Html5').registerSourceHandler(HlsSourceHandler('html5'), 0);
}
if (window.Uint8Array && flashTech) {
  flashTech.registerSourceHandler(HlsSourceHandler('flash'));
}

videojs.HlsHandler = HlsHandler;
videojs.HlsSourceHandler = HlsSourceHandler;
videojs.Hls = Hls;
if (!videojs.use) {
  videojs.registerComponent('Hls', Hls);
}
videojs.m3u8 = m3u8;
videojs.options.hls = videojs.options.hls || {};

if (videojs.registerPlugin) {
  videojs.registerPlugin('reloadSourceOnError', reloadSourceOnError);
} else {
  videojs.plugin('reloadSourceOnError', reloadSourceOnError);
}

module.exports = {
  Hls,
  HlsHandler,
  HlsSourceHandler
};

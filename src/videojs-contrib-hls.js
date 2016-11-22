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

const Hls = {
  PlaylistLoader,
  Playlist,
  Decrypter,
  AsyncStream,
  decrypt,
  utils,
  xhr: xhrFactory()
};

Object.defineProperty(Hls, 'GOAL_BUFFER_LENGTH', {
  get() {
    videojs.log.warn('using Hls.GOAL_BUFFER_LENGTH is UNSAFE be sure ' +
                     'you know what you are doing');
    return Config.GOAL_BUFFER_LENGTH;
  },
  set(v) {
    videojs.log.warn('using Hls.GOAL_BUFFER_LENGTH is UNSAFE be sure ' +
                     'you know what you are doing');
    if (typeof v !== 'number' || v <= 0) {
      videojs.log.warn('value passed to Hls.GOAL_BUFFER_LENGTH ' +
                       'must be a number and greater than 0');
      return;
    }
    Config.GOAL_BUFFER_LENGTH = v;
  }
});

// A fudge factor to apply to advertised playlist bitrates to account for
// temporary flucations in client bandwidth
const BANDWIDTH_VARIANCE = 1.2;

/**
 * Returns the CSS value for the specified property on an element
 * using `getComputedStyle`. Firefox has a long-standing issue where
 * getComputedStyle() may return null when running in an iframe with
 * `display: none`.
 *
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=548397
 * @param {HTMLElement} el the htmlelement to work on
 * @param {string} the proprety to get the style for
 */
const safeGetComputedStyle = function(el, property) {
  let result;

  if (!el) {
    return '';
  }

  result = window.getComputedStyle(el);
  if (!result) {
    return '';
  }

  return result[property];
};

/**
 * Chooses the appropriate media playlist based on the current
 * bandwidth estimate and the player size.
 *
 * @return {Playlist} the highest bitrate playlist less than the currently detected
 * bandwidth, accounting for some amount of bandwidth variance
 */
Hls.STANDARD_PLAYLIST_SELECTOR = function() {
  let effectiveBitrate;
  let sortedPlaylists = this.playlists.master.playlists.slice();
  let bandwidthPlaylists = [];
  let now = +new Date();
  let i;
  let variant;
  let bandwidthBestVariant;
  let resolutionPlusOne;
  let resolutionPlusOneAttribute;
  let resolutionBestVariant;
  let width;
  let height;

  sortedPlaylists.sort(Hls.comparePlaylistBandwidth);

  // filter out any playlists that have been excluded due to
  // incompatible configurations or playback errors
  sortedPlaylists = sortedPlaylists.filter((localVariant) => {
    if (typeof localVariant.excludeUntil !== 'undefined') {
      return now >= localVariant.excludeUntil;
    }
    return true;
  });

  // filter out any variant that has greater effective bitrate
  // than the current estimated bandwidth
  i = sortedPlaylists.length;
  while (i--) {
    variant = sortedPlaylists[i];

    // ignore playlists without bandwidth information
    if (!variant.attributes || !variant.attributes.BANDWIDTH) {
      continue;
    }

    effectiveBitrate = variant.attributes.BANDWIDTH * BANDWIDTH_VARIANCE;

    if (effectiveBitrate < this.systemBandwidth) {
      bandwidthPlaylists.push(variant);

      // since the playlists are sorted in ascending order by
      // bandwidth, the first viable variant is the best
      if (!bandwidthBestVariant) {
        bandwidthBestVariant = variant;
      }
    }
  }

  i = bandwidthPlaylists.length;

  // sort variants by resolution
  bandwidthPlaylists.sort(Hls.comparePlaylistResolution);

  // forget our old variant from above,
  // or we might choose that in high-bandwidth scenarios
  // (this could be the lowest bitrate rendition as  we go through all of them above)
  variant = null;

  width = parseInt(safeGetComputedStyle(this.tech_.el(), 'width'), 10);
  height = parseInt(safeGetComputedStyle(this.tech_.el(), 'height'), 10);

  // iterate through the bandwidth-filtered playlists and find
  // best rendition by player dimension
  while (i--) {
    variant = bandwidthPlaylists[i];

    // ignore playlists without resolution information
    if (!variant.attributes ||
        !variant.attributes.RESOLUTION ||
        !variant.attributes.RESOLUTION.width ||
        !variant.attributes.RESOLUTION.height) {
      continue;
    }

    // since the playlists are sorted, the first variant that has
    // dimensions less than or equal to the player size is the best
    let variantResolution = variant.attributes.RESOLUTION;

    if (variantResolution.width === width &&
        variantResolution.height === height) {
      // if we have the exact resolution as the player use it
      resolutionPlusOne = null;
      resolutionBestVariant = variant;
      break;
    } else if (variantResolution.width < width &&
               variantResolution.height < height) {
      // if both dimensions are less than the player use the
      // previous (next-largest) variant
      break;
    } else if (!resolutionPlusOne ||
               (variantResolution.width < resolutionPlusOneAttribute.width &&
                variantResolution.height < resolutionPlusOneAttribute.height)) {
      // If we still haven't found a good match keep a
      // reference to the previous variant for the next loop
      // iteration

      // By only saving variants if they are smaller than the
      // previously saved variant, we ensure that we also pick
      // the highest bandwidth variant that is just-larger-than
      // the video player
      resolutionPlusOne = variant;
      resolutionPlusOneAttribute = resolutionPlusOne.attributes.RESOLUTION;
    }
  }

  // fallback chain of variants
  return resolutionPlusOne ||
    resolutionBestVariant ||
    bandwidthBestVariant ||
    sortedPlaylists[0];
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
  if (!videojs.getComponent('Html5').isSupported()) {
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

const USER_AGENT = window.navigator && window.navigator.userAgent || '';

/**
 * Determines whether the browser supports a change in the audio configuration
 * during playback. Currently only Firefox 48 and below do not support this.
 * window.isSecureContext is a propterty that was added to window in firefox 49,
 * so we can use it to detect Firefox 49+.
 *
 * @return {Boolean} Whether the browser supports audio config change during playback
 */
Hls.supportsAudioInfoChange_ = function() {
  if (videojs.browser.IS_FIREFOX) {
    let firefoxVersionMap = (/Firefox\/([\d.]+)/i).exec(USER_AGENT);
    let version = parseInt(firefoxVersionMap[1], 10);

    return version >= 49;
  }
  return true;
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
    super(tech);

    // tech.player() is deprecated but setup a reference to HLS for
    // backwards-compatibility
    if (tech.options_ && tech.options_.playerId) {
      let _player = videojs(tech.options_.playerId);

      if (!_player.hasOwnProperty('hls')) {
        Object.defineProperty(_player, 'hls', {
          get: () => {
            videojs.log.warn('player.hls is deprecated. Use player.tech_.hls instead.');
            return this;
          }
        });
      }
    }

    this.tech_ = tech;
    this.source_ = source;
    this.stats = {};
    this.ignoreNextSeekingEvent_ = false;

    // handle global & Source Handler level options
    this.options_ = videojs.mergeOptions(videojs.options.hls || {}, options.hls);
    this.setOptions_();

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

    this.audioTrackChange_ = () => {
      this.masterPlaylistController_.setupAudio();
    };

    this.on(this.tech_, 'play', this.play);
  }

  setOptions_() {
    // defaults
    this.options_.withCredentials = this.options_.withCredentials || false;

    // start playlist selection at a reasonable bandwidth for
    // broadband internet
    // 0.5 MB/s
    if (typeof this.options_.bandwidth !== 'number') {
      this.options_.bandwidth = 4194304;
    }

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

    // `this` in selectPlaylist should be the HlsHandler for backwards
    // compatibility with < v2
    this.masterPlaylistController_.selectPlaylist =
      this.selectPlaylist ?
        this.selectPlaylist.bind(this) : Hls.STANDARD_PLAYLIST_SELECTOR.bind(this);

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
          this.masterPlaylistController_.mainSegmentLoader_.throughput = {rate: 0, count: 0};
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

    this.masterPlaylistController_.on('sourceopen', () => {
      this.tech_.audioTracks().addEventListener('change', this.audioTrackChange_);
    });

    this.masterPlaylistController_.on('selectedinitialmedia', () => {
      // Add the manual rendition mix-in to HlsHandler
      renditionSelectionMixin(this);
    });

    this.masterPlaylistController_.on('audioupdate', () => {
      // clear current audioTracks
      this.tech_.clearTracks('audio');
      this.masterPlaylistController_.activeAudioGroup().forEach((audioTrack) => {
        this.tech_.audioTracks().addTrack(audioTrack);
      });
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

    // do nothing if the tech has been disposed already
    // this can occur if someone sets the src in player.ready(), for instance
    if (!this.tech_.el()) {
      return;
    }

    this.tech_.src(videojs.URL.createObjectURL(
      this.masterPlaylistController_.mediaSource));
  }

  /**
   * a helper for grabbing the active audio group from MasterPlaylistController
   *
   * @private
   */
  activeAudioGroup_() {
    return this.masterPlaylistController_.activeAudioGroup();
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
      // this forces video.js to skip this tech/mode if its not the one we have been
      // overriden to use, by returing that we cannot handle the source.
      if (videojs.options.hls &&
          videojs.options.hls.mode &&
          videojs.options.hls.mode !== mode) {
        return false;
      }
      return HlsSourceHandler.canPlayType(srcObj.type);
    },
    handleSource(source, tech, options) {
      if (mode === 'flash') {
        // We need to trigger this asynchronously to give others the chance
        // to bind to the event when a source is set at player creation
        tech.setTimeout(function() {
          tech.trigger('loadstart');
        }, 1);
      }

      let settings = videojs.mergeOptions(options, {hls: {mode}});

      tech.hls = new HlsHandler(source, tech, settings);

      tech.hls.xhr = xhrFactory();
      // Use a global `before` function if specified on videojs.Hls.xhr
      // but still allow for a per-player override
      if (videojs.Hls.xhr.beforeRequest) {
        tech.hls.xhr.beforeRequest = videojs.Hls.xhr.beforeRequest;
      }

      tech.hls.src(source.src);
      return tech.hls;
    },
    canPlayType(type) {
      if (HlsSourceHandler.canPlayType(type)) {
        return 'maybe';
      }
      return '';
    }
  };
};

/**
 * A comparator function to sort two playlist object by bandwidth.
 *
 * @param {Object} left a media playlist object
 * @param {Object} right a media playlist object
 * @return {Number} Greater than zero if the bandwidth attribute of
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
 * @param {Object} left a media playlist object
 * @param {Object} right a media playlist object
 * @return {Number} Greater than zero if the resolution.width attribute of
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
  let mpegurlRE = /^(audio|video|application)\/(x-|vnd\.apple\.)?mpegurl/i;

  // favor native HLS support if it's available
  if (!videojs.options.hls.overrideNative && Hls.supportsNativeHls) {
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
  videojs.getComponent('Html5').registerSourceHandler(HlsSourceHandler('html5'), 0);
}
if (window.Uint8Array) {
  videojs.getComponent('Flash').registerSourceHandler(HlsSourceHandler('flash'));
}

videojs.HlsHandler = HlsHandler;
videojs.HlsSourceHandler = HlsSourceHandler;
videojs.Hls = Hls;
videojs.m3u8 = m3u8;
videojs.registerComponent('Hls', Hls);
videojs.options.hls = videojs.options.hls || {};
videojs.plugin('reloadSourceOnError', reloadSourceOnError);

module.exports = {
  Hls,
  HlsHandler,
  HlsSourceHandler
};

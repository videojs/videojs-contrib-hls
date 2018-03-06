/**
 * @file master-playlist-controller.js
 */
import PlaylistLoader from './playlist-loader';
import { isEnabled, isLowestEnabledRendition } from './playlist.js';
import SegmentLoader from './segment-loader';
import VTTSegmentLoader from './vtt-segment-loader';
import Ranges from './ranges';
import videojs from 'video.js';
import AdCueTags from './ad-cue-tags';
import SyncController from './sync-controller';
import { translateLegacyCodecs } from 'videojs-contrib-media-sources/es5/codec-utils';
import worker from 'webwackify';
import Decrypter from './decrypter-worker';
import Config from './config';
import { parseCodecs } from './util/codecs.js';
import { createMediaTypes, setupMediaGroups } from './media-groups';

const ABORT_EARLY_BLACKLIST_SECONDS = 60 * 2;

let Hls;

// Default codec parameters if none were provided for video and/or audio
const defaultCodecs = {
  videoCodec: 'avc1',
  videoObjectTypeIndicator: '.4d400d',
  // AAC-LC
  audioProfile: '2'
};

// SegmentLoader stats that need to have each loader's
// values summed to calculate the final value
const loaderStats = [
  'mediaRequests',
  'mediaRequestsAborted',
  'mediaRequestsTimedout',
  'mediaRequestsErrored',
  'mediaTransferDuration',
  'mediaBytesTransferred'
];
const sumLoaderStat = function(stat) {
  return this.audioSegmentLoader_[stat] +
         this.mainSegmentLoader_[stat];
};

const resolveDecrypterWorker = () => {
  let result;

  try {
    result = require.resolve('./decrypter-worker');
  } catch (e) {
    // no result
  }

  return result;
};

/**
 * Replace codecs in the codec string with the old apple-style `avc1.<dd>.<dd>` to the
 * standard `avc1.<hhhhhh>`.
 *
 * @param codecString {String} the codec string
 * @return {String} the codec string with old apple-style codecs replaced
 *
 * @private
 */
export const mapLegacyAvcCodecs_ = function(codecString) {
  return codecString.replace(/avc1\.(\d+)\.(\d+)/i, (match) => {
    return translateLegacyCodecs([match])[0];
  });
};

/**
 * Build a media mime-type string from a set of parameters
 * @param {String} type either 'audio' or 'video'
 * @param {String} container either 'mp2t' or 'mp4'
 * @param {Array} codecs an array of codec strings to add
 * @return {String} a valid media mime-type
 */
const makeMimeTypeString = function(type, container, codecs) {
  // The codecs array is filtered so that falsey values are
  // dropped and don't cause Array#join to create spurious
  // commas
  return `${type}/${container}; codecs="${codecs.filter(c=>!!c).join(', ')}"`;
};

/**
 * Returns the type container based on information in the playlist
 * @param {Playlist} media the current media playlist
 * @return {String} a valid media container type
 */
const getContainerType = function(media) {
  // An initialization segment means the media playlist is an iframe
  // playlist or is using the mp4 container. We don't currently
  // support iframe playlists, so assume this is signalling mp4
  // fragments.
  if (media.segments && media.segments.length && media.segments[0].map) {
    return 'mp4';
  }
  return 'mp2t';
};

/**
 * Returns a set of codec strings parsed from the playlist or the default
 * codec strings if no codecs were specified in the playlist
 * @param {Playlist} media the current media playlist
 * @return {Object} an object with the video and audio codecs
 */
const getCodecs = function(media) {
  // if the codecs were explicitly specified, use them instead of the
  // defaults
  let mediaAttributes = media.attributes || {};

  if (mediaAttributes.CODECS) {
    return parseCodecs(mediaAttributes.CODECS);
  }
  return defaultCodecs;
};

/**
 * Calculates the MIME type strings for a working configuration of
 * SourceBuffers to play variant streams in a master playlist. If
 * there is no possible working configuration, an empty array will be
 * returned.
 *
 * @param master {Object} the m3u8 object for the master playlist
 * @param media {Object} the m3u8 object for the variant playlist
 * @return {Array} the MIME type strings. If the array has more than
 * one entry, the first element should be applied to the video
 * SourceBuffer and the second to the audio SourceBuffer.
 *
 * @private
 */
export const mimeTypesForPlaylist_ = function(master, media) {
  let containerType = getContainerType(media);
  let codecInfo = getCodecs(media);
  let mediaAttributes = media.attributes || {};
  // Default condition for a traditional HLS (no demuxed audio/video)
  let isMuxed = true;
  let isMaat = false;

  if (!media) {
    // Not enough information
    return [];
  }

  if (master.mediaGroups.AUDIO && mediaAttributes.AUDIO) {
    let audioGroup = master.mediaGroups.AUDIO[mediaAttributes.AUDIO];

    // Handle the case where we are in a multiple-audio track scenario
    if (audioGroup) {
      isMaat = true;
      // Start with the everything demuxed then...
      isMuxed = false;
      // ...check to see if any audio group tracks are muxed (ie. lacking a uri)
      for (let groupId in audioGroup) {
        if (!audioGroup[groupId].uri) {
          isMuxed = true;
          break;
        }
      }
    }
  }

  // HLS with multiple-audio tracks must always get an audio codec.
  // Put another way, there is no way to have a video-only multiple-audio HLS!
  if (isMaat && !codecInfo.audioProfile) {
    videojs.log.warn(
      'Multiple audio tracks present but no audio codec string is specified. ' +
      'Attempting to use the default audio codec (mp4a.40.2)');
    codecInfo.audioProfile = defaultCodecs.audioProfile;
  }

  // Generate the final codec strings from the codec object generated above
  let codecStrings = {};

  if (codecInfo.videoCodec) {
    codecStrings.video = `${codecInfo.videoCodec}${codecInfo.videoObjectTypeIndicator}`;
  }

  if (codecInfo.audioProfile) {
    codecStrings.audio = `mp4a.40.${codecInfo.audioProfile}`;
  }

  // Finally, make and return an array with proper mime-types depending on
  // the configuration
  let justAudio = makeMimeTypeString('audio', containerType, [codecStrings.audio]);
  let justVideo = makeMimeTypeString('video', containerType, [codecStrings.video]);
  let bothVideoAudio = makeMimeTypeString('video', containerType, [
    codecStrings.video,
    codecStrings.audio
  ]);

  if (isMaat) {
    if (!isMuxed && codecStrings.video) {
      return [
        justVideo,
        justAudio
      ];
    }
    // There exists the possiblity that this will return a `video/container`
    // mime-type for the first entry in the array even when there is only audio.
    // This doesn't appear to be a problem and simplifies the code.
    return [
      bothVideoAudio,
      justAudio
    ];
  }

  // If there is ano video codec at all, always just return a single
  // audio/<container> mime-type
  if (!codecStrings.video) {
    return [
      justAudio
    ];
  }

  // When not using separate audio media groups, audio and video is
  // *always* muxed
  return [
    bothVideoAudio
  ];
};

/**
 * the master playlist controller controller all interactons
 * between playlists and segmentloaders. At this time this mainly
 * involves a master playlist and a series of audio playlists
 * if they are available
 *
 * @class MasterPlaylistController
 * @extends videojs.EventTarget
 */
export class MasterPlaylistController extends videojs.EventTarget {
  constructor(options) {
    super();

    let {
      url,
      withCredentials,
      mode,
      tech,
      bandwidth,
      externHls,
      useCueTags,
      blacklistDuration,
      enableLowInitialPlaylist
    } = options;

    if (!url) {
      throw new Error('A non-empty playlist URL is required');
    }

    Hls = externHls;

    this.withCredentials = withCredentials;
    this.tech_ = tech;
    this.hls_ = tech.hls;
    this.mode_ = mode;
    this.useCueTags_ = useCueTags;
    this.blacklistDuration = blacklistDuration;
    this.enableLowInitialPlaylist = enableLowInitialPlaylist;
    if (this.useCueTags_) {
      this.cueTagsTrack_ = this.tech_.addTextTrack('metadata',
        'ad-cues');
      this.cueTagsTrack_.inBandMetadataTrackDispatchType = '';
    }

    this.requestOptions_ = {
      withCredentials: this.withCredentials,
      timeout: null
    };

    this.mediaTypes_ = createMediaTypes();

    this.mediaSource = new videojs.MediaSource({ mode });

    // load the media source into the player
    this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen_.bind(this));

    this.seekable_ = videojs.createTimeRanges();
    this.hasPlayed_ = () => false;

    this.syncController_ = new SyncController(options);
    this.segmentMetadataTrack_ = tech.addRemoteTextTrack({
      kind: 'metadata',
      label: 'segment-metadata'
    }, false).track;

    this.decrypter_ = worker(Decrypter, resolveDecrypterWorker());

    const segmentLoaderSettings = {
      hls: this.hls_,
      mediaSource: this.mediaSource,
      currentTime: this.tech_.currentTime.bind(this.tech_),
      seekable: () => this.seekable(),
      seeking: () => this.tech_.seeking(),
      duration: () => this.mediaSource.duration,
      hasPlayed: () => this.hasPlayed_(),
      goalBufferLength: () => this.goalBufferLength(),
      bandwidth,
      syncController: this.syncController_,
      decrypter: this.decrypter_
    };

    // setup playlist loaders
    this.masterPlaylistLoader_ = new PlaylistLoader(url, this.hls_, this.withCredentials);
    this.setupMasterPlaylistLoaderListeners_();

    // setup segment loaders
    // combined audio/video or just video when alternate audio track is selected
    this.mainSegmentLoader_ =
      new SegmentLoader(videojs.mergeOptions(segmentLoaderSettings, {
        segmentMetadataTrack: this.segmentMetadataTrack_,
        loaderType: 'main'
      }), options);

    // alternate audio track
    this.audioSegmentLoader_ =
      new SegmentLoader(videojs.mergeOptions(segmentLoaderSettings, {
        loaderType: 'audio'
      }), options);

    this.subtitleSegmentLoader_ =
      new VTTSegmentLoader(videojs.mergeOptions(segmentLoaderSettings, {
        loaderType: 'vtt'
      }), options);

    this.setupSegmentLoaderListeners_();

    // Create SegmentLoader stat-getters
    loaderStats.forEach((stat) => {
      this[stat + '_'] = sumLoaderStat.bind(this, stat);
    });

    this.masterPlaylistLoader_.load();
  }

  /**
   * Register event handlers on the master playlist loader. A helper
   * function for construction time.
   *
   * @private
   */
  setupMasterPlaylistLoaderListeners_() {
    this.masterPlaylistLoader_.on('loadedmetadata', () => {
      let media = this.masterPlaylistLoader_.media();
      let requestTimeout = (this.masterPlaylistLoader_.targetDuration * 1.5) * 1000;

      // If we don't have any more available playlists, we don't want to
      // timeout the request.
      if (isLowestEnabledRendition(
            this.masterPlaylistLoader_.master, this.masterPlaylistLoader_.media())) {
        this.requestOptions_.timeout = 0;
      } else {
        this.requestOptions_.timeout = requestTimeout;
      }

      // if this isn't a live video and preload permits, start
      // downloading segments
      if (media.endList && this.tech_.preload() !== 'none') {
        this.mainSegmentLoader_.playlist(media, this.requestOptions_);
        this.mainSegmentLoader_.load();
      }

      setupMediaGroups({
        segmentLoaders: {
          AUDIO: this.audioSegmentLoader_,
          SUBTITLES: this.subtitleSegmentLoader_,
          main: this.mainSegmentLoader_
        },
        tech: this.tech_,
        requestOptions: this.requestOptions_,
        masterPlaylistLoader: this.masterPlaylistLoader_,
        mode: this.mode_,
        hls: this.hls_,
        master: this.master(),
        mediaTypes: this.mediaTypes_,
        blacklistCurrentPlaylist: this.blacklistCurrentPlaylist.bind(this)
      });

      this.triggerPresenceUsage_(this.master(), media);

      try {
        this.setupSourceBuffers_();
      } catch (e) {
        videojs.log.warn('Failed to create SourceBuffers', e);
        return this.mediaSource.endOfStream('decode');
      }
      this.setupFirstPlay();

      this.trigger('selectedinitialmedia');
    });

    this.masterPlaylistLoader_.on('loadedplaylist', () => {
      let updatedPlaylist = this.masterPlaylistLoader_.media();

      if (!updatedPlaylist) {
        let selectedMedia;

        if (this.enableLowInitialPlaylist) {
          selectedMedia = this.selectInitialPlaylist();
        }

        if (!selectedMedia) {
          selectedMedia = this.selectPlaylist();
        }

        this.initialMedia_ = selectedMedia;
        this.masterPlaylistLoader_.media(this.initialMedia_);
        return;
      }

      if (this.useCueTags_) {
        this.updateAdCues_(updatedPlaylist);
      }

      // TODO: Create a new event on the PlaylistLoader that signals
      // that the segments have changed in some way and use that to
      // update the SegmentLoader instead of doing it twice here and
      // on `mediachange`
      this.mainSegmentLoader_.playlist(updatedPlaylist, this.requestOptions_);
      this.updateDuration();

      // If the player isn't paused, ensure that the segment loader is running,
      // as it is possible that it was temporarily stopped while waiting for
      // a playlist (e.g., in case the playlist errored and we re-requested it).
      if (!this.tech_.paused()) {
        this.mainSegmentLoader_.load();
      }

      if (!updatedPlaylist.endList) {
        let addSeekableRange = () => {
          let seekable = this.seekable();

          if (seekable.length !== 0) {
            this.mediaSource.addSeekableRange_(seekable.start(0), seekable.end(0));
          }
        };

        if (this.duration() !== Infinity) {
          let onDurationchange = () => {
            if (this.duration() === Infinity) {
              addSeekableRange();
            } else {
              this.tech_.one('durationchange', onDurationchange);
            }
          };

          this.tech_.one('durationchange', onDurationchange);
        } else {
          addSeekableRange();
        }
      }
    });

    this.masterPlaylistLoader_.on('error', () => {
      this.blacklistCurrentPlaylist(this.masterPlaylistLoader_.error);
    });

    this.masterPlaylistLoader_.on('mediachanging', () => {
      this.mainSegmentLoader_.abort();
      this.mainSegmentLoader_.pause();
    });

    this.masterPlaylistLoader_.on('mediachange', () => {
      let media = this.masterPlaylistLoader_.media();
      let requestTimeout = (this.masterPlaylistLoader_.targetDuration * 1.5) * 1000;

      // If we don't have any more available playlists, we don't want to
      // timeout the request.
      if (isLowestEnabledRendition(
            this.masterPlaylistLoader_.master, this.masterPlaylistLoader_.media())) {
        this.requestOptions_.timeout = 0;
      } else {
        this.requestOptions_.timeout = requestTimeout;
      }

      // TODO: Create a new event on the PlaylistLoader that signals
      // that the segments have changed in some way and use that to
      // update the SegmentLoader instead of doing it twice here and
      // on `loadedplaylist`
      this.mainSegmentLoader_.playlist(media, this.requestOptions_);
      this.mainSegmentLoader_.load();

      this.tech_.trigger({
        type: 'mediachange',
        bubbles: true
      });
    });

    this.masterPlaylistLoader_.on('playlistunchanged', () => {
      let updatedPlaylist = this.masterPlaylistLoader_.media();
      let playlistOutdated = this.stuckAtPlaylistEnd_(updatedPlaylist);

      if (playlistOutdated) {
        // Playlist has stopped updating and we're stuck at its end. Try to
        // blacklist it and switch to another playlist in the hope that that
        // one is updating (and give the player a chance to re-adjust to the
        // safe live point).
        this.blacklistCurrentPlaylist({
          message: 'Playlist no longer updating.'
        });
        // useful for monitoring QoS
        this.tech_.trigger('playliststuck');
      }
    });

    this.masterPlaylistLoader_.on('renditiondisabled', () => {
      this.tech_.trigger({type: 'usage', name: 'hls-rendition-disabled'});
    });
    this.masterPlaylistLoader_.on('renditionenabled', () => {
      this.tech_.trigger({type: 'usage', name: 'hls-rendition-enabled'});
    });
  }

  /**
   * A helper function for triggerring presence usage events once per source
   *
   * @private
   */
  triggerPresenceUsage_(master, media) {
    let mediaGroups = master.mediaGroups || {};
    let defaultDemuxed = true;
    let audioGroupKeys = Object.keys(mediaGroups.AUDIO);

    for (let mediaGroup in mediaGroups.AUDIO) {
      for (let label in mediaGroups.AUDIO[mediaGroup]) {
        let properties = mediaGroups.AUDIO[mediaGroup][label];

        if (!properties.uri) {
          defaultDemuxed = false;
        }
      }
    }

    if (defaultDemuxed) {
      this.tech_.trigger({type: 'usage', name: 'hls-demuxed'});
    }

    if (Object.keys(mediaGroups.SUBTITLES).length) {
      this.tech_.trigger({type: 'usage', name: 'hls-webvtt'});
    }

    if (Hls.Playlist.isAes(media)) {
      this.tech_.trigger({type: 'usage', name: 'hls-aes'});
    }

    if (Hls.Playlist.isFmp4(media)) {
      this.tech_.trigger({type: 'usage', name: 'hls-fmp4'});
    }

    if (audioGroupKeys.length &&
        Object.keys(mediaGroups.AUDIO[audioGroupKeys[0]]).length > 1) {
      this.tech_.trigger({type: 'usage', name: 'hls-alternate-audio'});
    }

    if (this.useCueTags_) {
      this.tech_.trigger({type: 'usage', name: 'hls-playlist-cue-tags'});
    }
  }
  /**
   * Register event handlers on the segment loaders. A helper function
   * for construction time.
   *
   * @private
   */
  setupSegmentLoaderListeners_() {
    this.mainSegmentLoader_.on('bandwidthupdate', () => {
      const nextPlaylist = this.selectPlaylist();
      const currentPlaylist = this.masterPlaylistLoader_.media();
      const buffered = this.tech_.buffered();
      const forwardBuffer = buffered.length ?
        buffered.end(buffered.length - 1) - this.tech_.currentTime() : 0;

      const bufferLowWaterLine = this.bufferLowWaterLine();

      // If the playlist is live, then we want to not take low water line into account.
      // This is because in LIVE, the player plays 3 segments from the end of the
      // playlist, and if `BUFFER_LOW_WATER_LINE` is greater than the duration availble
      // in those segments, a viewer will never experience a rendition upswitch.
      if (!currentPlaylist.endList ||
          // For the same reason as LIVE, we ignore the low water line when the VOD
          // duration is below the max potential low water line
          this.duration() < Config.MAX_BUFFER_LOW_WATER_LINE ||
          // we want to switch down to lower resolutions quickly to continue playback, but
          nextPlaylist.attributes.BANDWIDTH < currentPlaylist.attributes.BANDWIDTH ||
          // ensure we have some buffer before we switch up to prevent us running out of
          // buffer while loading a higher rendition.
          forwardBuffer >= bufferLowWaterLine) {
        this.masterPlaylistLoader_.media(nextPlaylist);
      }

      this.tech_.trigger('bandwidthupdate');
    });
    this.mainSegmentLoader_.on('progress', () => {
      this.trigger('progress');
    });

    this.mainSegmentLoader_.on('error', () => {
      this.blacklistCurrentPlaylist(this.mainSegmentLoader_.error());
    });

    this.mainSegmentLoader_.on('syncinfoupdate', () => {
      this.onSyncInfoUpdate_();
    });

    this.mainSegmentLoader_.on('timestampoffset', () => {
      this.tech_.trigger({type: 'usage', name: 'hls-timestamp-offset'});
    });
    this.audioSegmentLoader_.on('syncinfoupdate', () => {
      this.onSyncInfoUpdate_();
    });

    this.mainSegmentLoader_.on('ended', () => {
      this.onEndOfStream();
    });

    this.mainSegmentLoader_.on('earlyabort', () => {
      this.blacklistCurrentPlaylist({
        message: 'Aborted early because there isn\'t enough bandwidth to complete the ' +
          'request without rebuffering.'
      }, ABORT_EARLY_BLACKLIST_SECONDS);
    });

    this.mainSegmentLoader_.on('reseteverything', () => {
      // If playing an MTS stream, a videojs.MediaSource is listening for
      // hls-reset to reset caption parsing state in the transmuxer
      this.tech_.trigger('hls-reset');
    });

    this.mainSegmentLoader_.on('segmenttimemapping', (event) => {
      // If playing an MTS stream in html, a videojs.MediaSource is listening for
      // hls-segment-time-mapping update its internal mapping of stream to display time
      this.tech_.trigger({
        type: 'hls-segment-time-mapping',
        mapping: event.mapping
      });
    });

    this.audioSegmentLoader_.on('ended', () => {
      this.onEndOfStream();
    });
  }

  mediaSecondsLoaded_() {
    return Math.max(this.audioSegmentLoader_.mediaSecondsLoaded +
                    this.mainSegmentLoader_.mediaSecondsLoaded);
  }

  /**
   * Call load on our SegmentLoaders
   */
  load() {
    this.mainSegmentLoader_.load();
    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.load();
    }
    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.load();
    }
  }

  /**
   * Re-tune playback quality level for the current player
   * conditions. This method may perform destructive actions, like
   * removing already buffered content, to readjust the currently
   * active playlist quickly.
   *
   * @private
   */
  fastQualityChange_() {
    let media = this.selectPlaylist();

    if (media !== this.masterPlaylistLoader_.media()) {
      this.masterPlaylistLoader_.media(media);

      this.mainSegmentLoader_.resetLoader();
      // don't need to reset audio as it is reset when media changes
    }
  }

  /**
   * Begin playback.
   */
  play() {
    if (this.setupFirstPlay()) {
      return;
    }

    if (this.tech_.ended()) {
      this.tech_.setCurrentTime(0);
    }

    if (this.hasPlayed_()) {
      this.load();
    }

    let seekable = this.tech_.seekable();

    // if the viewer has paused and we fell out of the live window,
    // seek forward to the live point
    if (this.tech_.duration() === Infinity) {
      if (this.tech_.currentTime() < seekable.start(0)) {
        return this.tech_.setCurrentTime(seekable.end(seekable.length - 1));
      }
    }
  }

  /**
   * Seek to the latest media position if this is a live video and the
   * player and video are loaded and initialized.
   */
  setupFirstPlay() {
    let media = this.masterPlaylistLoader_.media();

    // Check that everything is ready to begin buffering for the first call to play
    //  If 1) there is no active media
    //     2) the player is paused
    //     3) the first play has already been setup
    // then exit early
    if (!media || this.tech_.paused() || this.hasPlayed_()) {
      return false;
    }

    // when the video is a live stream
    if (!media.endList) {
      const seekable = this.seekable();

      if (!seekable.length) {
        // without a seekable range, the player cannot seek to begin buffering at the live
        // point
        return false;
      }

      if (videojs.browser.IE_VERSION &&
          this.mode_ === 'html5' &&
          this.tech_.readyState() === 0) {
        // IE11 throws an InvalidStateError if you try to set currentTime while the
        // readyState is 0, so it must be delayed until the tech fires loadedmetadata.
        this.tech_.one('loadedmetadata', () => {
          this.trigger('firstplay');
          this.tech_.setCurrentTime(seekable.end(0));
          this.hasPlayed_ = () => true;
        });

        return false;
      }

      // trigger firstplay to inform the source handler to ignore the next seek event
      this.trigger('firstplay');
      // seek to the live point
      this.tech_.setCurrentTime(seekable.end(0));
    }

    this.hasPlayed_ = () => true;
    // we can begin loading now that everything is ready
    this.load();
    return true;
  }

  /**
   * handle the sourceopen event on the MediaSource
   *
   * @private
   */
  handleSourceOpen_() {
    // Only attempt to create the source buffer if none already exist.
    // handleSourceOpen is also called when we are "re-opening" a source buffer
    // after `endOfStream` has been called (in response to a seek for instance)
    try {
      this.setupSourceBuffers_();
    } catch (e) {
      videojs.log.warn('Failed to create Source Buffers', e);
      return this.mediaSource.endOfStream('decode');
    }

    // if autoplay is enabled, begin playback. This is duplicative of
    // code in video.js but is required because play() must be invoked
    // *after* the media source has opened.
    if (this.tech_.autoplay()) {
      const playPromise = this.tech_.play();

      // Catch/silence error when a pause interrupts a play request
      // on browsers which return a promise
      if (typeof playPromise !== 'undefined' && typeof playPromise.then === 'function') {
        playPromise.then(null, (e) => {});
      }
    }

    this.trigger('sourceopen');
  }

  /**
   * Calls endOfStream on the media source when all active stream types have called
   * endOfStream
   *
   * @param {string} streamType
   *        Stream type of the segment loader that called endOfStream
   * @private
   */
  onEndOfStream() {
    let isEndOfStream = this.mainSegmentLoader_.ended_;

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      // if the audio playlist loader exists, then alternate audio is active, so we need
      // to wait for both the main and audio segment loaders to call endOfStream
      isEndOfStream = isEndOfStream && this.audioSegmentLoader_.ended_;
    }

    if (isEndOfStream) {
      this.mediaSource.endOfStream();
    }
  }

  /**
   * Check if a playlist has stopped being updated
   * @param {Object} playlist the media playlist object
   * @return {boolean} whether the playlist has stopped being updated or not
   */
  stuckAtPlaylistEnd_(playlist) {
    let seekable = this.seekable();

    if (!seekable.length) {
      // playlist doesn't have enough information to determine whether we are stuck
      return false;
    }

    let expired =
      this.syncController_.getExpiredTime(playlist, this.mediaSource.duration);

    if (expired === null) {
      return false;
    }

    // does not use the safe live end to calculate playlist end, since we
    // don't want to say we are stuck while there is still content
    let absolutePlaylistEnd = Hls.Playlist.playlistEnd(playlist, expired);
    let currentTime = this.tech_.currentTime();
    let buffered = this.tech_.buffered();

    if (!buffered.length) {
      // return true if the playhead reached the absolute end of the playlist
      return absolutePlaylistEnd - currentTime <= Ranges.SAFE_TIME_DELTA;
    }
    let bufferedEnd = buffered.end(buffered.length - 1);

    // return true if there is too little buffer left and buffer has reached absolute
    // end of playlist
    return bufferedEnd - currentTime <= Ranges.SAFE_TIME_DELTA &&
           absolutePlaylistEnd - bufferedEnd <= Ranges.SAFE_TIME_DELTA;
  }

  /**
   * Blacklists a playlist when an error occurs for a set amount of time
   * making it unavailable for selection by the rendition selection algorithm
   * and then forces a new playlist (rendition) selection.
   *
   * @param {Object=} error an optional error that may include the playlist
   * to blacklist
   * @param {Number=} blacklistDuration an optional number of seconds to blacklist the
   * playlist
   */
  blacklistCurrentPlaylist(error = {}, blacklistDuration) {
    let currentPlaylist;
    let nextPlaylist;

    // If the `error` was generated by the playlist loader, it will contain
    // the playlist we were trying to load (but failed) and that should be
    // blacklisted instead of the currently selected playlist which is likely
    // out-of-date in this scenario
    currentPlaylist = error.playlist || this.masterPlaylistLoader_.media();

    blacklistDuration = blacklistDuration ||
                        error.blacklistDuration ||
                        this.blacklistDuration;

    // If there is no current playlist, then an error occurred while we were
    // trying to load the master OR while we were disposing of the tech
    if (!currentPlaylist) {
      this.error = error;

      try {
        return this.mediaSource.endOfStream('network');
      } catch (e) {
        return this.trigger('error');
      }
    }

    let isFinalRendition =
      this.masterPlaylistLoader_.master.playlists.filter(isEnabled).length === 1;

    if (isFinalRendition) {
      // Never blacklisting this playlist because it's final rendition
      videojs.log.warn('Problem encountered with the current ' +
                       'HLS playlist. Trying again since it is the final playlist.');

      this.tech_.trigger('retryplaylist');
      return this.masterPlaylistLoader_.load(isFinalRendition);
    }
    // Blacklist this playlist
    currentPlaylist.excludeUntil = Date.now() + (blacklistDuration * 1000);
    this.tech_.trigger('blacklistplaylist');
    this.tech_.trigger({type: 'usage', name: 'hls-rendition-blacklisted'});

    // Select a new playlist
    nextPlaylist = this.selectPlaylist();
    videojs.log.warn('Problem encountered with the current HLS playlist.' +
                     (error.message ? ' ' + error.message : '') +
                     ' Switching to another playlist.');

    return this.masterPlaylistLoader_.media(nextPlaylist);
  }

  /**
   * Pause all segment loaders
   */
  pauseLoading() {
    this.mainSegmentLoader_.pause();
    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.pause();
    }
    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.pause();
    }
  }

  /**
   * set the current time on all segment loaders
   *
   * @param {TimeRange} currentTime the current time to set
   * @return {TimeRange} the current time
   */
  setCurrentTime(currentTime) {
    let buffered = Ranges.findRange(this.tech_.buffered(), currentTime);

    if (!(this.masterPlaylistLoader_ && this.masterPlaylistLoader_.media())) {
      // return immediately if the metadata is not ready yet
      return 0;
    }

    // it's clearly an edge-case but don't thrown an error if asked to
    // seek within an empty playlist
    if (!this.masterPlaylistLoader_.media().segments) {
      return 0;
    }

    // In flash playback, the segment loaders should be reset on every seek, even
    // in buffer seeks. If the seek location is already buffered, continue buffering as
    // usual
    if (buffered && buffered.length && this.mode_ !== 'flash') {
      return currentTime;
    }

    // cancel outstanding requests so we begin buffering at the new
    // location
    this.mainSegmentLoader_.resetEverything();
    this.mainSegmentLoader_.abort();
    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      this.audioSegmentLoader_.resetEverything();
      this.audioSegmentLoader_.abort();
    }
    if (this.mediaTypes_.SUBTITLES.activePlaylistLoader) {
      this.subtitleSegmentLoader_.resetEverything();
      this.subtitleSegmentLoader_.abort();
    }

    // start segment loader loading in case they are paused
    this.load();
  }

  /**
   * get the current duration
   *
   * @return {TimeRange} the duration
   */
  duration() {
    if (!this.masterPlaylistLoader_) {
      return 0;
    }

    if (this.mediaSource) {
      return this.mediaSource.duration;
    }

    return Hls.Playlist.duration(this.masterPlaylistLoader_.media());
  }

  /**
   * check the seekable range
   *
   * @return {TimeRange} the seekable range
   */
  seekable() {
    return this.seekable_;
  }

  onSyncInfoUpdate_() {
    let mainSeekable;
    let audioSeekable;

    if (!this.masterPlaylistLoader_) {
      return;
    }

    let media = this.masterPlaylistLoader_.media();

    if (!media) {
      return;
    }

    let expired = this.syncController_.getExpiredTime(media, this.mediaSource.duration);

    if (expired === null) {
      // not enough information to update seekable
      return;
    }

    mainSeekable = Hls.Playlist.seekable(media, expired);

    if (mainSeekable.length === 0) {
      return;
    }

    if (this.mediaTypes_.AUDIO.activePlaylistLoader) {
      media = this.mediaTypes_.AUDIO.activePlaylistLoader.media();
      expired = this.syncController_.getExpiredTime(media, this.mediaSource.duration);

      if (expired === null) {
        return;
      }

      audioSeekable = Hls.Playlist.seekable(media, expired);

      if (audioSeekable.length === 0) {
        return;
      }
    }

    if (!audioSeekable) {
      // seekable has been calculated based on buffering video data so it
      // can be returned directly
      this.seekable_ = mainSeekable;
    } else if (audioSeekable.start(0) > mainSeekable.end(0) ||
               mainSeekable.start(0) > audioSeekable.end(0)) {
      // seekables are pretty far off, rely on main
      this.seekable_ = mainSeekable;
    } else {
      this.seekable_ = videojs.createTimeRanges([[
        (audioSeekable.start(0) > mainSeekable.start(0)) ? audioSeekable.start(0) :
                                                           mainSeekable.start(0),
        (audioSeekable.end(0) < mainSeekable.end(0)) ? audioSeekable.end(0) :
                                                       mainSeekable.end(0)
      ]]);
    }

    this.tech_.trigger('seekablechanged');
  }

  /**
   * Update the player duration
   */
  updateDuration() {
    let oldDuration = this.mediaSource.duration;
    let newDuration = Hls.Playlist.duration(this.masterPlaylistLoader_.media());
    let buffered = this.tech_.buffered();
    let setDuration = () => {
      this.mediaSource.duration = newDuration;
      this.tech_.trigger('durationchange');

      this.mediaSource.removeEventListener('sourceopen', setDuration);
    };

    if (buffered.length > 0) {
      newDuration = Math.max(newDuration, buffered.end(buffered.length - 1));
    }

    // if the duration has changed, invalidate the cached value
    if (oldDuration !== newDuration) {
      // update the duration
      if (this.mediaSource.readyState !== 'open') {
        this.mediaSource.addEventListener('sourceopen', setDuration);
      } else {
        setDuration();
      }
    }
  }

  /**
   * dispose of the MasterPlaylistController and everything
   * that it controls
   */
  dispose() {
    this.decrypter_.terminate();
    this.masterPlaylistLoader_.dispose();
    this.mainSegmentLoader_.dispose();

    ['AUDIO', 'SUBTITLES'].forEach((type) => {
      const groups = this.mediaTypes_[type].groups;

      for (let id in groups) {
        groups[id].forEach((group) => {
          if (group.playlistLoader) {
            group.playlistLoader.dispose();
          }
        });
      }
    });

    this.audioSegmentLoader_.dispose();
    this.subtitleSegmentLoader_.dispose();
  }

  /**
   * return the master playlist object if we have one
   *
   * @return {Object} the master playlist object that we parsed
   */
  master() {
    return this.masterPlaylistLoader_.master;
  }

  /**
   * return the currently selected playlist
   *
   * @return {Object} the currently selected playlist object that we parsed
   */
  media() {
    // playlist loader will not return media if it has not been fully loaded
    return this.masterPlaylistLoader_.media() || this.initialMedia_;
  }

  /**
   * setup our internal source buffers on our segment Loaders
   *
   * @private
   */
  setupSourceBuffers_() {
    let media = this.masterPlaylistLoader_.media();
    let mimeTypes;

    // wait until a media playlist is available and the Media Source is
    // attached
    if (!media || this.mediaSource.readyState !== 'open') {
      return;
    }

    mimeTypes = mimeTypesForPlaylist_(this.masterPlaylistLoader_.master, media);
    if (mimeTypes.length < 1) {
      this.error =
        'No compatible SourceBuffer configuration for the variant stream:' +
        media.resolvedUri;
      return this.mediaSource.endOfStream('decode');
    }
    this.mainSegmentLoader_.mimeType(mimeTypes[0]);
    if (mimeTypes[1]) {
      this.audioSegmentLoader_.mimeType(mimeTypes[1]);
    }

    // exclude any incompatible variant streams from future playlist
    // selection
    this.excludeIncompatibleVariants_(media);
  }

  /**
   * Blacklist playlists that are known to be codec or
   * stream-incompatible with the SourceBuffer configuration. For
   * instance, Media Source Extensions would cause the video element to
   * stall waiting for video data if you switched from a variant with
   * video and audio to an audio-only one.
   *
   * @param {Object} media a media playlist compatible with the current
   * set of SourceBuffers. Variants in the current master playlist that
   * do not appear to have compatible codec or stream configurations
   * will be excluded from the default playlist selection algorithm
   * indefinitely.
   * @private
   */
  excludeIncompatibleVariants_(media) {
    let master = this.masterPlaylistLoader_.master;
    let codecCount = 2;
    let videoCodec = null;
    let codecs;

    if (media.attributes.CODECS) {
      codecs = parseCodecs(media.attributes.CODECS);
      videoCodec = codecs.videoCodec;
      codecCount = codecs.codecCount;
    }
    master.playlists.forEach(function(variant) {
      let variantCodecs = {
        codecCount: 2,
        videoCodec: null
      };

      if (variant.attributes.CODECS) {
        let codecString = variant.attributes.CODECS;

        variantCodecs = parseCodecs(codecString);

        if (window.MediaSource &&
            window.MediaSource.isTypeSupported &&
            !window.MediaSource.isTypeSupported(
              'video/mp4; codecs="' + mapLegacyAvcCodecs_(codecString) + '"')) {
          variant.excludeUntil = Infinity;
        }
      }

      // if the streams differ in the presence or absence of audio or
      // video, they are incompatible
      if (variantCodecs.codecCount !== codecCount) {
        variant.excludeUntil = Infinity;
      }

      // if h.264 is specified on the current playlist, some flavor of
      // it must be specified on all compatible variants
      if (variantCodecs.videoCodec !== videoCodec) {
        variant.excludeUntil = Infinity;
      }

    });
  }

  updateAdCues_(media) {
    let offset = 0;
    let seekable = this.seekable();

    if (seekable.length) {
      offset = seekable.start(0);
    }

    AdCueTags.updateAdCues(media, this.cueTagsTrack_, offset);
  }

  /**
   * Calculates the desired forward buffer length based on current time
   *
   * @return {Number} Desired forward buffer length in seconds
   */
  goalBufferLength() {
    const currentTime = this.tech_.currentTime();
    const initial = Config.GOAL_BUFFER_LENGTH;
    const rate = Config.GOAL_BUFFER_LENGTH_RATE;
    const max = Math.max(initial, Config.MAX_GOAL_BUFFER_LENGTH);

    return Math.min(initial + currentTime * rate, max);
  }

  /**
   * Calculates the desired buffer low water line based on current time
   *
   * @return {Number} Desired buffer low water line in seconds
   */
  bufferLowWaterLine() {
    const currentTime = this.tech_.currentTime();
    const initial = Config.BUFFER_LOW_WATER_LINE;
    const rate = Config.BUFFER_LOW_WATER_LINE_RATE;
    const max = Math.max(initial, Config.MAX_BUFFER_LOW_WATER_LINE);

    return Math.min(initial + currentTime * rate, max);
  }
}

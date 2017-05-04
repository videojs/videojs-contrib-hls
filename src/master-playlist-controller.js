/**
 * @file master-playlist-controller.js
 */
import PlaylistLoader from './playlist-loader';
import SegmentLoader from './segment-loader';
import VTTSegmentLoader from './vtt-segment-loader';
import Ranges from './ranges';
import videojs from 'video.js';
import AdCueTags from './ad-cue-tags';
import SyncController from './sync-controller';
import { translateLegacyCodecs } from 'videojs-contrib-media-sources/es5/codec-utils';
import worker from 'webworkify';
import Decrypter from './decrypter-worker';

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

/**
 * determine if an object a is differnt from
 * and object b. both only having one dimensional
 * properties
 *
 * @param {Object} a object one
 * @param {Object} b object two
 * @return {Boolean} if the object has changed or not
 */
const objectChanged = function(a, b) {
  if (typeof a !== typeof b) {
    return true;
  }
  // if we have a different number of elements
  // something has changed
  if (Object.keys(a).length !== Object.keys(b).length) {
    return true;
  }

  for (let prop in a) {
    if (a[prop] !== b[prop]) {
      return true;
    }
  }
  return false;
};

/**
 * Parses a codec string to retrieve the number of codecs specified,
 * the video codec and object type indicator, and the audio profile.
 *
 * @private
 */
const parseCodecs = function(codecs) {
  let result = {
    codecCount: 0
  };
  let parsed;

  result.codecCount = codecs.split(',').length;
  result.codecCount = result.codecCount || 2;

  // parse the video codec
  parsed = (/(^|\s|,)+(avc1)([^ ,]*)/i).exec(codecs);
  if (parsed) {
    result.videoCodec = parsed[2];
    result.videoObjectTypeIndicator = parsed[3];
  }

  // parse the last field of the audio codec
  result.audioProfile =
    (/(^|\s|,)+mp4a.[0-9A-Fa-f]+\.([0-9A-Fa-f]+)/i).exec(codecs);
  result.audioProfile = result.audioProfile && result.audioProfile[2];

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
    videojs.log.warn('Multiple audio tracks present but no audio codec string is specified. ' +
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
      blacklistDuration
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
    if (this.useCueTags_) {
      this.cueTagsTrack_ = this.tech_.addTextTrack('metadata',
        'ad-cues');
      this.cueTagsTrack_.inBandMetadataTrackDispatchType = '';
    }

    this.requestOptions_ = {
      withCredentials: this.withCredentials,
      timeout: null
    };

    this.audioGroups_ = {};
    this.subtitleGroups_ = { groups: {}, tracks: {} };

    this.mediaSource = new videojs.MediaSource({ mode });
    this.audioinfo_ = null;
    this.mediaSource.on('audioinfo', this.handleAudioinfoUpdate_.bind(this));

    // load the media source into the player
    this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen_.bind(this));

    this.seekable_ = videojs.createTimeRanges();
    this.hasPlayed_ = () => false;

    this.syncController_ = new SyncController();
    this.segmentMetadataTrack_ = tech.addRemoteTextTrack({
      kind: 'metadata',
      label: 'segment-metadata'
    }, true).track;

    this.decrypter_ = worker(Decrypter);

    let segmentLoaderOptions = {
      hls: this.hls_,
      mediaSource: this.mediaSource,
      currentTime: this.tech_.currentTime.bind(this.tech_),
      seekable: () => this.seekable(),
      seeking: () => this.tech_.seeking(),
      duration: () => this.mediaSource.duration,
      hasPlayed: () => this.hasPlayed_(),
      bandwidth,
      syncController: this.syncController_,
      decrypter: this.decrypter_
    };

    // setup playlist loaders
    this.masterPlaylistLoader_ = new PlaylistLoader(url, this.hls_, this.withCredentials);
    this.setupMasterPlaylistLoaderListeners_();
    this.audioPlaylistLoader_ = null;
    this.subtitlePlaylistLoader_ = null;

    // setup segment loaders
    // combined audio/video or just video when alternate audio track is selected
    this.mainSegmentLoader_ = new SegmentLoader(videojs.mergeOptions(segmentLoaderOptions, {
      segmentMetadataTrack: this.segmentMetadataTrack_,
      loaderType: 'main'
    }));

    // alternate audio track
    this.audioSegmentLoader_ = new SegmentLoader(videojs.mergeOptions(segmentLoaderOptions, {
      loaderType: 'audio'
    }));

    this.subtitleSegmentLoader_ = new VTTSegmentLoader(videojs.mergeOptions(segmentLoaderOptions, {
      loaderType: 'vtt'
    }));

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
      if (this.masterPlaylistLoader_.isLowestEnabledRendition_()) {
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

      this.fillAudioTracks_();
      this.setupAudio();

      this.fillSubtitleTracks_();
      this.setupSubtitles();

      try {
        this.setupSourceBuffers_();
      } catch (e) {
        videojs.log.warn('Failed to create SourceBuffers', e);
        return this.mediaSource.endOfStream('decode');
      }
      this.setupFirstPlay();

      this.trigger('audioupdate');
      this.trigger('selectedinitialmedia');
    });

    this.masterPlaylistLoader_.on('loadedplaylist', () => {
      let updatedPlaylist = this.masterPlaylistLoader_.media();

      if (!updatedPlaylist) {
        // select the initial variant
        this.initialMedia_ = this.selectPlaylist();
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
      let activeAudioGroup;
      let activeTrack;

      // If we don't have any more available playlists, we don't want to
      // timeout the request.
      if (this.masterPlaylistLoader_.isLowestEnabledRendition_()) {
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

      // if the audio group has changed, a new audio track has to be
      // enabled
      activeAudioGroup = this.activeAudioGroup();
      activeTrack = activeAudioGroup.filter((track) => track.enabled)[0];
      if (!activeTrack) {
        this.setupAudio();
        this.trigger('audioupdate');
      }
      this.setupSubtitles();

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
  }

  /**
   * Register event handlers on the segment loaders. A helper function
   * for construction time.
   *
   * @private
   */
  setupSegmentLoaderListeners_() {
    this.mainSegmentLoader_.on('bandwidthupdate', () => {
      // figure out what stream the next segment should be downloaded from
      // with the updated bandwidth information
      this.masterPlaylistLoader_.media(this.selectPlaylist());
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

    this.audioSegmentLoader_.on('syncinfoupdate', () => {
      this.onSyncInfoUpdate_();
    });

    this.audioSegmentLoader_.on('error', () => {
      videojs.log.warn('Problem encountered with the current alternate audio track' +
                       '. Switching back to default.');
      this.audioSegmentLoader_.abort();
      this.audioPlaylistLoader_ = null;
      this.setupAudio();
    });

    this.subtitleSegmentLoader_.on('error', this.handleSubtitleError_.bind(this));
  }

  handleAudioinfoUpdate_(event) {
    if (Hls.supportsAudioInfoChange_() ||
        !this.audioInfo_ ||
        !objectChanged(this.audioInfo_, event.info)) {
      this.audioInfo_ = event.info;
      return;
    }

    let error = 'had different audio properties (channels, sample rate, etc.) ' +
        'or changed in some other way.  This behavior is currently ' +
        'unsupported in Firefox 48 and below due to an issue: \n\n' +
        'https://bugzilla.mozilla.org/show_bug.cgi?id=1247138\n\n';

    let enabledIndex =
        this.activeAudioGroup()
          .map((track) => track.enabled)
          .indexOf(true);
    let enabledTrack = this.activeAudioGroup()[enabledIndex];
    let defaultTrack = this.activeAudioGroup().filter((track) => {
      return track.properties_ && track.properties_.default;
    })[0];

    // they did not switch audiotracks
    // blacklist the current playlist
    if (!this.audioPlaylistLoader_) {
      error = `The rendition that we tried to switch to ${error}` +
        'Unfortunately that means we will have to blacklist ' +
        'the current playlist and switch to another. Sorry!';
      this.blacklistCurrentPlaylist();
    } else {
      error = `The audio track '${enabledTrack.label}' that we tried to ` +
        `switch to ${error} Unfortunately this means we will have to ` +
        `return you to the main track '${defaultTrack.label}'. Sorry!`;
      defaultTrack.enabled = true;
      this.activeAudioGroup().splice(enabledIndex, 1);
      this.trigger('audioupdate');
    }

    videojs.log.warn(error);
    this.setupAudio();
  }

  mediaSecondsLoaded_() {
    return Math.max(this.audioSegmentLoader_.mediaSecondsLoaded +
                    this.mainSegmentLoader_.mediaSecondsLoaded);
  }

  /**
   * fill our internal list of HlsAudioTracks with data from
   * the master playlist or use a default
   *
   * @private
   */
  fillAudioTracks_() {
    let master = this.master();
    let mediaGroups = master.mediaGroups || {};

    // force a default if we have none or we are not
    // in html5 mode (the only mode to support more than one
    // audio track)
    if (!mediaGroups ||
        !mediaGroups.AUDIO ||
        Object.keys(mediaGroups.AUDIO).length === 0 ||
        this.mode_ !== 'html5') {
      // "main" audio group, track name "default"
      mediaGroups.AUDIO = { main: { default: { default: true }}};
    }

    for (let mediaGroup in mediaGroups.AUDIO) {
      if (!this.audioGroups_[mediaGroup]) {
        this.audioGroups_[mediaGroup] = [];
      }

      for (let label in mediaGroups.AUDIO[mediaGroup]) {
        let properties = mediaGroups.AUDIO[mediaGroup][label];
        let track = new videojs.AudioTrack({
          id: label,
          kind: this.audioTrackKind_(properties),
          enabled: false,
          language: properties.language,
          label
        });

        track.properties_ = properties;
        this.audioGroups_[mediaGroup].push(track);
      }
    }

    // enable the default active track
    (this.activeAudioGroup().filter((audioTrack) => {
      return audioTrack.properties_.default;
    })[0] || this.activeAudioGroup()[0]).enabled = true;
  }

  /**
   * Convert the properties of an HLS track into an audioTrackKind.
   *
   * @private
   */
  audioTrackKind_(properties) {
    let kind = properties.default ? 'main' : 'alternative';

    if (properties.characteristics &&
        properties.characteristics.indexOf('public.accessibility.describes-video') >= 0) {
      kind = 'main-desc';
    }

    return kind;
  }
  /**
   * fill our internal list of Subtitle Tracks with data from
   * the master playlist or use a default
   *
   * @private
   */
  fillSubtitleTracks_() {
    let master = this.master();
    let mediaGroups = master.mediaGroups || {};

    for (let mediaGroup in mediaGroups.SUBTITLES) {
      if (!this.subtitleGroups_.groups[mediaGroup]) {
        this.subtitleGroups_.groups[mediaGroup] = [];
      }

      for (let label in mediaGroups.SUBTITLES[mediaGroup]) {
        let properties = mediaGroups.SUBTITLES[mediaGroup][label];

        if (!properties.forced) {
          this.subtitleGroups_.groups[mediaGroup].push(
            videojs.mergeOptions({ id: label }, properties));

          if (typeof this.subtitleGroups_.tracks[label] === 'undefined') {
            let track = this.tech_.addRemoteTextTrack({
              id: label,
              kind: 'subtitles',
              enabled: false,
              language: properties.language,
              label
            }, true).track;

            this.subtitleGroups_.tracks[label] = track;
          }
        }
      }
    }

    // Do not enable a default subtitle track. Wait for user interaction instead.
  }

  /**
   * Call load on our SegmentLoaders
   */
  load() {
    this.mainSegmentLoader_.load();
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.load();
    }
    if (this.subtitlePlaylistLoader_) {
      this.subtitleSegmentLoader_.load();
    }
  }

  /**
   * Returns the audio group for the currently active primary
   * media playlist.
   */
  activeAudioGroup() {
    let videoPlaylist = this.masterPlaylistLoader_.media();
    let result;

    if (videoPlaylist.attributes && videoPlaylist.attributes.AUDIO) {
      result = this.audioGroups_[videoPlaylist.attributes.AUDIO];
    }

    return result || this.audioGroups_.main;
  }

  /**
   * Returns the subtitle group for the currently active primary
   * media playlist.
   */
  activeSubtitleGroup_() {
    let videoPlaylist = this.masterPlaylistLoader_.media();
    let result;

    if (!videoPlaylist) {
      return null;
    }

    if (videoPlaylist.attributes && videoPlaylist.attributes.SUBTITLES) {
      result = this.subtitleGroups_.groups[videoPlaylist.attributes.SUBTITLES];
    }

    return result || this.subtitleGroups_.groups.main;
  }

  activeSubtitleTrack_() {
    for (let trackName in this.subtitleGroups_.tracks) {
      if (this.subtitleGroups_.tracks[trackName].mode === 'showing') {
        return this.subtitleGroups_.tracks[trackName];
      }
    }

    return null;
  }

  handleSubtitleError_() {
    videojs.log.warn('Problem encountered loading the subtitle track' +
                     '. Switching back to default.');

    this.subtitleSegmentLoader_.abort();

    let track = this.activeSubtitleTrack_();

    if (track) {
      track.mode = 'disabled';
    }

    this.setupSubtitles();
  }

  /**
   * Determine the correct audio rendition based on the active
   * AudioTrack and initialize a PlaylistLoader and SegmentLoader if
   * necessary. This method is called once automatically before
   * playback begins to enable the default audio track and should be
   * invoked again if the track is changed.
   */
  setupAudio() {
    // determine whether seperate loaders are required for the audio
    // rendition
    let audioGroup = this.activeAudioGroup();
    let track = audioGroup.filter((audioTrack) => {
      return audioTrack.enabled;
    })[0];

    if (!track) {
      track = audioGroup.filter((audioTrack) => {
        return audioTrack.properties_.default;
      })[0] || audioGroup[0];
      track.enabled = true;
    }

    // stop playlist and segment loading for audio
    if (this.audioPlaylistLoader_) {
      this.audioPlaylistLoader_.dispose();
      this.audioPlaylistLoader_ = null;
    }
    this.audioSegmentLoader_.pause();

    if (!track.properties_.resolvedUri) {
      this.mainSegmentLoader_.resetEverything();
      return;
    }
    this.audioSegmentLoader_.resetEverything();

    // startup playlist and segment loaders for the enabled audio
    // track
    this.audioPlaylistLoader_ = new PlaylistLoader(track.properties_.resolvedUri,
                                                   this.hls_,
                                                   this.withCredentials);
    this.audioPlaylistLoader_.load();

    this.audioPlaylistLoader_.on('loadedmetadata', () => {
      let audioPlaylist = this.audioPlaylistLoader_.media();

      this.audioSegmentLoader_.playlist(audioPlaylist, this.requestOptions_);

      // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments
      if (!this.tech_.paused() ||
          (audioPlaylist.endList && this.tech_.preload() !== 'none')) {
        this.audioSegmentLoader_.load();
      }

      if (!audioPlaylist.endList) {
        this.audioPlaylistLoader_.trigger('firstplay');
      }
    });

    this.audioPlaylistLoader_.on('loadedplaylist', () => {
      let updatedPlaylist;

      if (this.audioPlaylistLoader_) {
        updatedPlaylist = this.audioPlaylistLoader_.media();
      }

      if (!updatedPlaylist) {
        // only one playlist to select
        this.audioPlaylistLoader_.media(
          this.audioPlaylistLoader_.playlists.master.playlists[0]);
        return;
      }

      this.audioSegmentLoader_.playlist(updatedPlaylist, this.requestOptions_);
    });

    this.audioPlaylistLoader_.on('error', () => {
      videojs.log.warn('Problem encountered loading the alternate audio track' +
                       '. Switching back to default.');
      this.audioSegmentLoader_.abort();
      this.setupAudio();
    });
  }

  /**
   * Determine the correct subtitle playlist based on the active
   * SubtitleTrack and initialize a PlaylistLoader and SegmentLoader if
   * necessary. This method is called once automatically before
   * playback begins to enable the default subtitle track and should be
   * invoked again if the track is changed.
   */
  setupSubtitles() {
    let subtitleGroup = this.activeSubtitleGroup_();
    let track = this.activeSubtitleTrack_();

    this.subtitleSegmentLoader_.pause();

    if (!track) {
      // stop playlist and segment loading for subtitles
      if (this.subtitlePlaylistLoader_) {
        this.subtitlePlaylistLoader_.dispose();
        this.subtitlePlaylistLoader_ = null;
      }
      return;
    }

    let properties = subtitleGroup.filter((subtitleProperties) => {
      return subtitleProperties.id === track.id;
    })[0];

    // startup playlist and segment loaders for the enabled subtitle track
    if (!this.subtitlePlaylistLoader_ ||
        // if the media hasn't loaded yet, we don't have the URI to check, so it is
        // easiest to simply recreate the playlist loader
        !this.subtitlePlaylistLoader_.media() ||
        this.subtitlePlaylistLoader_.media().resolvedUri !== properties.resolvedUri) {

      if (this.subtitlePlaylistLoader_) {
        this.subtitlePlaylistLoader_.dispose();
      }

      // reset the segment loader only when the subtitle playlist is changed instead of
      // every time setupSubtitles is called since switching subtitle tracks fires
      // multiple `change` events on the TextTrackList
      this.subtitleSegmentLoader_.resetEverything();

      // can't reuse playlistloader because we're only using single renditions and not a
      // proper master
      this.subtitlePlaylistLoader_ = new PlaylistLoader(properties.resolvedUri,
                                                        this.hls_,
                                                        this.withCredentials);

      this.subtitlePlaylistLoader_.on('loadedmetadata', () => {
        let subtitlePlaylist = this.subtitlePlaylistLoader_.media();

        this.subtitleSegmentLoader_.playlist(subtitlePlaylist, this.requestOptions_);
        this.subtitleSegmentLoader_.track(this.activeSubtitleTrack_());

        // if the video is already playing, or if this isn't a live video and preload
        // permits, start downloading segments
        if (!this.tech_.paused() ||
            (subtitlePlaylist.endList && this.tech_.preload() !== 'none')) {
          this.subtitleSegmentLoader_.load();
        }
      });

      this.subtitlePlaylistLoader_.on('loadedplaylist', () => {
        let updatedPlaylist;

        if (this.subtitlePlaylistLoader_) {
          updatedPlaylist = this.subtitlePlaylistLoader_.media();
        }

        if (!updatedPlaylist) {
          return;
        }

        this.subtitleSegmentLoader_.playlist(updatedPlaylist, this.requestOptions_);
      });

      this.subtitlePlaylistLoader_.on('error', this.handleSubtitleError_.bind(this));
    }

    if (this.subtitlePlaylistLoader_.media() &&
        this.subtitlePlaylistLoader_.media().resolvedUri === properties.resolvedUri) {
      this.subtitleSegmentLoader_.load();
    } else {
      this.subtitlePlaylistLoader_.load();
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
    let seekable;
    let media = this.masterPlaylistLoader_.media();

    // check that everything is ready to begin buffering in the live
    // scenario
    // 1) the active media playlist is available
    if (media &&
        // 2) the player is not paused
        !this.tech_.paused() &&
        // 3) the player has not started playing
        !this.hasPlayed_()) {

      // when the video is a live stream
      if (!media.endList) {
        this.trigger('firstplay');

        // seek to the latest media position for live videos
        seekable = this.seekable();
        if (seekable.length) {
          this.tech_.setCurrentTime(seekable.end(0));
        }
      }
      this.hasPlayed_ = () => true;
      // now that we are ready, load the segment
      this.load();
      return true;
    }
    return false;
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
      this.tech_.play();
    }

    this.trigger('sourceopen');
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

    let expired = this.syncController_.getExpiredTime(playlist, this.mediaSource.duration);

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
      return absolutePlaylistEnd - currentTime <= Ranges.TIME_FUDGE_FACTOR;
    }
    let bufferedEnd = buffered.end(buffered.length - 1);

    // return true if there is too little buffer left and
    // buffer has reached absolute end of playlist
    return bufferedEnd - currentTime <= Ranges.TIME_FUDGE_FACTOR &&
           absolutePlaylistEnd - bufferedEnd <= Ranges.TIME_FUDGE_FACTOR;
  }

  /**
   * Blacklists a playlist when an error occurs for a set amount of time
   * making it unavailable for selection by the rendition selection algorithm
   * and then forces a new playlist (rendition) selection.
   *
   * @param {Object=} error an optional error that may include the playlist
   * to blacklist
   */
  blacklistCurrentPlaylist(error = {}) {
    let currentPlaylist;
    let nextPlaylist;

    // If the `error` was generated by the playlist loader, it will contain
    // the playlist we were trying to load (but failed) and that should be
    // blacklisted instead of the currently selected playlist which is likely
    // out-of-date in this scenario
    currentPlaylist = error.playlist || this.masterPlaylistLoader_.media();

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

    let isFinalRendition = this.masterPlaylistLoader_.isFinalRendition_();

    if (isFinalRendition) {
      // Never blacklisting this playlist because it's final rendition
      videojs.log.warn('Problem encountered with the current ' +
                       'HLS playlist. Trying again since it is the final playlist.');

      this.tech_.trigger('retryplaylist');
      return this.masterPlaylistLoader_.load(isFinalRendition);
    }
    // Blacklist this playlist
    currentPlaylist.excludeUntil = Date.now() + this.blacklistDuration * 1000;
    this.tech_.trigger('blacklistplaylist');

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
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.pause();
    }
    if (this.subtitlePlaylistLoader_) {
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
    // in buffer seeks
    const isFlash = (this.mode_ === 'flash') ||
                    (this.mode_ === 'auto' && !videojs.MediaSource.supportsNativeMediaSources());

    // if the seek location is already buffered, continue buffering as
    // usual
    if (buffered && buffered.length && !isFlash) {
      return currentTime;
    }

    // cancel outstanding requests so we begin buffering at the new
    // location
    this.mainSegmentLoader_.resetEverything();
    this.mainSegmentLoader_.abort();
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.resetEverything();
      this.audioSegmentLoader_.abort();
    }
    if (this.subtitlePlaylistLoader_) {
      this.subtitleSegmentLoader_.resetEverything();
      this.subtitleSegmentLoader_.abort();
    }

    if (!this.tech_.paused()) {
      this.mainSegmentLoader_.load();
      if (this.audioPlaylistLoader_) {
        this.audioSegmentLoader_.load();
      }
      if (this.subtitlePlaylistLoader_) {
        this.subtitleSegmentLoader_.load();
      }
    }
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

    if (this.audioPlaylistLoader_) {
      media = this.audioPlaylistLoader_.media();
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

    if (this.audioPlaylistLoader_) {
      this.audioPlaylistLoader_.dispose();
    }
    if (this.subtitlePlaylistLoader_) {
      this.subtitlePlaylistLoader_.dispose();
    }
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

    if (media.attributes && media.attributes.CODECS) {
      codecs = parseCodecs(media.attributes.CODECS);
      videoCodec = codecs.videoCodec;
      codecCount = codecs.codecCount;
    }
    master.playlists.forEach(function(variant) {
      let variantCodecs = {
        codecCount: 2,
        videoCodec: null
      };

      if (variant.attributes && variant.attributes.CODECS) {
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
}

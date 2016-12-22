/**
 * @file master-playlist-controller.js
 */
import PlaylistLoader from './playlist-loader';
import SegmentLoader from './segment-loader';
import Ranges from './ranges';
import videojs from 'video.js';
import AdCueTags from './ad-cue-tags';
import SyncController from './sync-controller';
import { translateLegacyCodecs } from 'videojs-contrib-media-sources/es5/codec-utils';

// 5 minute blacklist
const BLACKLIST_DURATION = 5 * 60 * 1000;
let Hls;

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
    codecCount: 0,
    videoCodec: null,
    videoObjectTypeIndicator: null,
    audioProfile: null
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
  let container = 'mp2t';
  let codecs = {
    videoCodec: 'avc1',
    videoObjectTypeIndicator: '.4d400d',
    audioProfile: '2'
  };
  let audioGroup = [];
  let mediaAttributes;
  let previousGroup = null;

  if (!media) {
    // not enough information, return an error
    return [];
  }
  // An initialization segment means the media playlists is an iframe
  // playlist or is using the mp4 container. We don't currently
  // support iframe playlists, so assume this is signalling mp4
  // fragments.
  // the existence check for segments can be removed once
  // https://github.com/videojs/m3u8-parser/issues/8 is closed
  if (media.segments && media.segments.length && media.segments[0].map) {
    container = 'mp4';
  }

  // if the codecs were explicitly specified, use them instead of the
  // defaults
  mediaAttributes = media.attributes || {};
  if (mediaAttributes.CODECS) {
    let parsedCodecs = parseCodecs(mediaAttributes.CODECS);

    Object.keys(parsedCodecs).forEach((key) => {
      codecs[key] = parsedCodecs[key] || codecs[key];
    });
  }

  if (master.mediaGroups.AUDIO) {
    audioGroup = master.mediaGroups.AUDIO[mediaAttributes.AUDIO];
  }

  // if audio could be muxed or unmuxed, use mime types appropriate
  // for both scenarios
  for (let groupId in audioGroup) {
    if (previousGroup && (!!audioGroup[groupId].uri !== !!previousGroup.uri)) {
      // one source buffer with muxed video and audio and another for
      // the alternate audio
      return [
        'video/' + container + '; codecs="' +
          codecs.videoCodec + codecs.videoObjectTypeIndicator + ', mp4a.40.' + codecs.audioProfile + '"',
        'audio/' + container + '; codecs="mp4a.40.' + codecs.audioProfile + '"'
      ];
    }
    previousGroup = audioGroup[groupId];
  }
  // if all video and audio is unmuxed, use two single-codec mime
  // types
  if (previousGroup && previousGroup.uri) {
    return [
      'video/' + container + '; codecs="' +
        codecs.videoCodec + codecs.videoObjectTypeIndicator + '"',
      'audio/' + container + '; codecs="mp4a.40.' + codecs.audioProfile + '"'
    ];
  }

  // all video and audio are muxed, use a dual-codec mime type
  return [
    'video/' + container + '; codecs="' +
      codecs.videoCodec + codecs.videoObjectTypeIndicator +
      ', mp4a.40.' + codecs.audioProfile + '"'
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
      useCueTags
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
    if (this.useCueTags_) {
      this.cueTagsTrack_ = this.tech_.addTextTrack('metadata',
        'ad-cues');
      this.cueTagsTrack_.inBandMetadataTrackDispatchType = '';
      this.tech_.textTracks().addTrack_(this.cueTagsTrack_);
    }

    this.audioTracks_ = [];
    this.requestOptions_ = {
      withCredentials: this.withCredentials,
      timeout: null
    };

    this.audioGroups_ = {};

    this.mediaSource = new videojs.MediaSource({ mode });
    this.audioinfo_ = null;
    this.mediaSource.on('audioinfo', this.handleAudioinfoUpdate_.bind(this));

    // load the media source into the player
    this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen_.bind(this));

    this.seekable_ = videojs.createTimeRanges();
    this.hasPlayed_ = () => false;

    this.syncController_ = new SyncController();

    let segmentLoaderOptions = {
      hls: this.hls_,
      mediaSource: this.mediaSource,
      currentTime: this.tech_.currentTime.bind(this.tech_),
      seekable: () => this.seekable(),
      seeking: () => this.tech_.seeking(),
      setCurrentTime: (a) => this.tech_.setCurrentTime(a),
      hasPlayed: () => this.hasPlayed_(),
      bandwidth,
      syncController: this.syncController_
    };

    // setup playlist loaders
    this.masterPlaylistLoader_ = new PlaylistLoader(url, this.hls_, this.withCredentials);
    this.setupMasterPlaylistLoaderListeners_();
    this.audioPlaylistLoader_ = null;

    // setup segment loaders
    // combined audio/video or just video when alternate audio track is selected
    this.mainSegmentLoader_ = new SegmentLoader(segmentLoaderOptions);
    // alternate audio track
    this.audioSegmentLoader_ = new SegmentLoader(segmentLoaderOptions);
    this.setupSegmentLoaderListeners_();

    this.masterPlaylistLoader_.start();
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

      this.requestOptions_.timeout = requestTimeout;

      // if this isn't a live video and preload permits, start
      // downloading segments
      if (media.endList && this.tech_.preload() !== 'none') {
        this.mainSegmentLoader_.playlist(media, this.requestOptions_);
        this.mainSegmentLoader_.load();
      }

      this.fillAudioTracks_();
      this.setupAudio();

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

      this.tech_.trigger({
        type: 'mediachange',
        bubbles: true
      });
    });
  }

  /**
   * Register event handlers on the segment loaders. A helper function
   * for construction time.
   *
   * @private
   */
  setupSegmentLoaderListeners_() {
    this.mainSegmentLoader_.on('progress', () => {
      // figure out what stream the next segment should be downloaded from
      // with the updated bandwidth information
      this.masterPlaylistLoader_.media(this.selectPlaylist());

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

  /**
   * get the total number of media requests from the `audiosegmentloader_`
   * and the `mainSegmentLoader_`
   *
   * @private
   */
  mediaRequests_() {
    return this.audioSegmentLoader_.mediaRequests +
           this.mainSegmentLoader_.mediaRequests;
  }

  /**
   * get the total time that media requests have spent trnasfering
   * from the `audiosegmentloader_` and the `mainSegmentLoader_`
   *
   * @private
   */
  mediaTransferDuration_() {
    return this.audioSegmentLoader_.mediaTransferDuration +
           this.mainSegmentLoader_.mediaTransferDuration;

  }

  /**
   * get the total number of bytes transfered during media requests
   * from the `audiosegmentloader_` and the `mainSegmentLoader_`
   *
   * @private
   */
  mediaBytesTransferred_() {
    return this.audioSegmentLoader_.mediaBytesTransferred +
           this.mainSegmentLoader_.mediaBytesTransferred;
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
          kind: properties.default ? 'main' : 'alternative',
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
   * Call load on our SegmentLoaders
   */
  load() {
    this.mainSegmentLoader_.load();
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.load();
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
    this.audioPlaylistLoader_.start();

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
      if (this.audiosegmentloader_) {
        this.audioSegmentLoader_.resetLoader();
      }
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

    // if the viewer has paused and we fell out of the live window,
    // seek forward to the earliest available position
    if (this.tech_.duration() === Infinity) {
      if (this.tech_.currentTime() < this.tech_.seekable().start(0)) {
        return this.tech_.setCurrentTime(this.tech_.seekable().start(0));
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
      return this.mediaSource.endOfStream('network');
    }

    // Blacklist this playlist
    currentPlaylist.excludeUntil = Date.now() + BLACKLIST_DURATION;

    // Select a new playlist
    nextPlaylist = this.selectPlaylist();

    if (nextPlaylist) {
      videojs.log.warn('Problem encountered with the current ' +
                       'HLS playlist. Switching to another playlist.');

      return this.masterPlaylistLoader_.media(nextPlaylist);
    }
    videojs.log.warn('Problem encountered with the current ' +
                     'HLS playlist. No suitable alternatives found.');
    // We have no more playlists we can select so we must fail
    this.error = error;
    return this.mediaSource.endOfStream('network');
  }

  /**
   * Pause all segment loaders
   */
  pauseLoading() {
    this.mainSegmentLoader_.pause();
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.pause();
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

    // if the seek location is already buffered, continue buffering as
    // usual
    if (buffered && buffered.length) {
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

    if (!this.tech_.paused()) {
      this.mainSegmentLoader_.load();
      if (this.audioPlaylistLoader_) {
        this.audioSegmentLoader_.load();
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
    let media;
    let mainSeekable;
    let audioSeekable;

    if (!this.masterPlaylistLoader_) {
      return;
    }

    media = this.masterPlaylistLoader_.media();

    if (!media) {
      return;
    }

    mainSeekable = Hls.Playlist.seekable(media);
    if (mainSeekable.length === 0) {
      return;
    }

    if (this.audioPlaylistLoader_) {
      audioSeekable = Hls.Playlist.seekable(this.audioPlaylistLoader_.media());
      if (audioSeekable.length === 0) {
        return;
      }
    }

    if (!audioSeekable) {
      // seekable has been calculated based on buffering video data so it
      // can be returned directly
      this.seekable_ = mainSeekable;
      return;
    }

    this.seekable_ = videojs.createTimeRanges([[
      (audioSeekable.start(0) > mainSeekable.start(0)) ? audioSeekable.start(0) :
                                                         mainSeekable.start(0),
      (audioSeekable.end(0) < mainSeekable.end(0)) ? audioSeekable.end(0) :
                                                     mainSeekable.end(0)
    ]]);
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
    this.masterPlaylistLoader_.dispose();
    this.mainSegmentLoader_.dispose();

    if (this.audioPlaylistLoader_) {
      this.audioPlaylistLoader_.dispose();
    }
    this.audioSegmentLoader_.dispose();
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
    let audioProfile = null;
    let codecs;

    if (media.attributes && media.attributes.CODECS) {
      codecs = parseCodecs(media.attributes.CODECS);
      videoCodec = codecs.videoCodec;
      audioProfile = codecs.audioProfile;
      codecCount = codecs.codecCount;
    }
    master.playlists.forEach(function(variant) {
      let variantCodecs = {
        codecCount: 2,
        videoCodec: null,
        audioProfile: null
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
      // HE-AAC ("mp4a.40.5") is incompatible with all other versions of
      // AAC audio in Chrome 46. Don't mix the two.
      if ((variantCodecs.audioProfile === '5' && audioProfile !== '5') ||
          (audioProfile === '5' && variantCodecs.audioProfile !== '5')) {
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

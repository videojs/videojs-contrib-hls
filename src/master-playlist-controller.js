/**
 * @file master-playlist-controller.js
 */
import PlaylistLoader from './playlist-loader';
import SegmentLoader from './segment-loader';
import Ranges from './ranges';
import videojs from 'video.js';
import HlsAudioTrack from './hls-audio-track';

// 5 minute blacklist
const BLACKLIST_DURATION = 5 * 60 * 1000;
let Hls;

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
  result.audioProfile = (/(^|\s|,)+mp4a.\d+\.(\d+)/i).exec(codecs);
  result.audioProfile = result.audioProfile && result.audioProfile[2];

  return result;
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
 * @private
 */
const mimeTypesForPlaylist = function(master, media) {
  let container = 'mp2t';
  let codecs = {
    videoCodec: 'avc1.4d400d',
    audioProfile: '2'
  };
  let mediaAttributes;
  let audioGroup;

  if (!media) {
    // not enough information, return an error
    return [];
  }
  // An initialization segment means the media playlists is an iframe
  // playlist or is using the mp4 container. We don't currently
  // support iframe playlists, so assume this is signalling mp4
  // fragments.
  if (media.segments.length && media.segments[0].map) {
    container = 'mp4';
  }

  // if the codecs were explicitly specified, use them instead of the
  // defaults
  mediaAttributes = media.attributes || {};
  if (mediaAttributes.CODECS) {
    codecs = parseCodecs(mediaAttributes.CODECS);
  }

  audioGroup = master.mediaGroups.AUDIO[mediaAttributes.AUDIO];
  for (let groupId in audioGroup) {
    if (audioGroup[groupId].uri !== undefined) {
      // separate SourceBuffers for video and audio
      return [
        'video/' + container + '; codecs="' +
          codecs.videoCodec + codecs.videoObjectTypeIndicator + '"',
        'audio/' + container + '; codecs="mp4a.40.' + codecs.audioProfile + '"'
      ];
    }
  }

  // single SourceBuffer with muxed video and audio
  return [
    'video/' + container + '; codecs="' + codecs.videoCodec +
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
export default class MasterPlaylistController extends videojs.EventTarget {
  constructor(options) {
    super();

    let {
      url,
      withCredentials,
      mode,
      tech,
      bandwidth,
      externHls
    } = options;

    if (!url) {
      throw new Error('A non-empty playlist URL is required');
    }

    Hls = externHls;

    this.withCredentials = withCredentials;
    this.tech_ = tech;
    this.hls_ = tech.hls;
    this.mode_ = mode;
    this.audioGroups_ = {};

    this.mediaSource = new videojs.MediaSource({ mode });
    this.mediaSource.on('audioinfo', (e) => this.trigger(e));
    // load the media source into the player
    this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen_.bind(this));

    let segmentLoaderOptions = {
      hls: this.hls_,
      mediaSource: this.mediaSource,
      currentTime: this.tech_.currentTime.bind(this.tech_),
      withCredentials: this.withCredentials,
      seekable: () => this.seekable(),
      seeking: () => this.tech_.seeking(),
      setCurrentTime: (a) => this.tech_.setCurrentTime(a),
      hasPlayed: () => this.tech_.played().length !== 0,
      bandwidth
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

      // if this isn't a live video and preload permits, start
      // downloading segments
      if (media.endList && this.tech_.preload() !== 'none') {
        this.mainSegmentLoader_.playlist(media);
        this.mainSegmentLoader_.expired(this.masterPlaylistLoader_.expired_);
        this.mainSegmentLoader_.load();
      }

      this.setupSourceBuffers_();
      this.setupFirstPlay();
      this.setupAudio();

      this.trigger('selectedinitialmedia');
    });

    this.masterPlaylistLoader_.on('loadedplaylist', () => {
      let updatedPlaylist = this.masterPlaylistLoader_.media();
      let seekable;

      if (!updatedPlaylist) {
        // select the initial variant
        this.initialMedia_ = this.selectPlaylist();
        this.masterPlaylistLoader_.media(this.initialMedia_);
        this.fillAudioTracks_();
        return;
      }

      // TODO: Create a new event on the PlaylistLoader that signals
      // that the segments have changed in some way and use that to
      // update the SegmentLoader instead of doing it twice here and
      // on `mediachange`
      this.mainSegmentLoader_.playlist(updatedPlaylist);
      this.mainSegmentLoader_.expired(this.masterPlaylistLoader_.expired_);
      this.updateDuration();

      // update seekable
      seekable = this.seekable();
      if (!updatedPlaylist.endList && seekable.length !== 0) {
        this.mediaSource.addSeekableRange_(seekable.start(0), seekable.end(0));
      }
    });

    this.masterPlaylistLoader_.on('error', () => {
      this.blacklistCurrentPlaylist(this.masterPlaylistLoader_.error);
    });

    this.masterPlaylistLoader_.on('mediachanging', () => {
      this.mainSegmentLoader_.pause();
    });

    this.masterPlaylistLoader_.on('mediachange', () => {
      let media = this.masterPlaylistLoader_.media();

      this.mainSegmentLoader_.abort();

      // TODO: Create a new event on the PlaylistLoader that signals
      // that the segments have changed in some way and use that to
      // update the SegmentLoader instead of doing it twice here and
      // on `loadedplaylist`
      this.mainSegmentLoader_.playlist(media);
      this.mainSegmentLoader_.expired(this.masterPlaylistLoader_.expired_);
      this.mainSegmentLoader_.load();

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

    this.audioSegmentLoader_.on('error', () => {
      videojs.log.warn('Problem encountered with the current alternate audio track' +
                       '. Switching back to default.');
      this.audioSegmentLoader_.abort();
      this.audioPlaylistLoader_ = null;
      this.setupAudio();
    });
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
    return this.audioGroups_[videoPlaylist.attributes.AUDIO || 'main'];
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
    let track = audioGroup.find((audioTrack) => {
      return audioTrack.properties_.default
    }) || audioTrack[0];

    track.enabled = true;

    // stop downloading segments for the old track
    this.audioSegmentLoader_.pause();

    if (!track.properties_.resolvedUri) {
      // audio is muxed in, no need for a separate playlist and segment loader
      return;
    }

    // startup playlist and segment loaders for the enabled audio
    // track
    if (this.audioPlaylistLoader_) {
      this.audioPlaylistLoader_.dispose();
    }
    this.audioPlaylistLoader_ = new PlaylistLoader(track.properties_.resolvedUri,
                                                   this.hls_,
                                                   this.withCredentials);
    this.audioPlaylistLoader_.start();

    this.audioPlaylistLoader_.on('loadedmetadata', () => {
      let audioPlaylist = this.audioPlaylistLoader_.media();

      this.audioSegmentLoader_.playlist(audioPlaylist);

      // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments
      if (!this.tech_.paused() ||
          (audioPlaylist.endList && this.tech_.preload() !== 'none')) {
        this.audioSegmentLoader_.load();
      }

      if (!audioPlaylist.endList) {
        // trigger the playlist loader to start "expired time"-tracking
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

      this.audioSegmentLoader_.playlist(updatedPlaylist);
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
      this.mainSegmentLoader_.sourceUpdater_.remove(this.tech_.currentTime() + 5,
                                                    Infinity);
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

    this.load();

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

    // check that everything is ready to begin buffering
    // 1) the active media playlist is available
    if (media &&
        // 2) the video is a live stream
        !media.endList &&

        // 3) the player is not paused
        !this.tech_.paused() &&

        // 4) the player has not started playing
        !this.hasPlayed_) {

      this.load();

      // trigger the playlist loader to start "expired time"-tracking
      this.masterPlaylistLoader_.trigger('firstplay');
      this.hasPlayed_ = true;

      // seek to the latest media position for live videos
      seekable = this.seekable();
      if (seekable.length) {
        this.tech_.setCurrentTime(seekable.end(0));
      }

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
    this.setupSourceBuffers_();

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
    this.mainSegmentLoader_.abort();
    if (this.audioPlaylistLoader_) {
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
    let media;
    let mainSeekable;
    let audioSeekable;

    if (!this.masterPlaylistLoader_) {
      return videojs.createTimeRanges();
    }
    media = this.masterPlaylistLoader_.media();
    if (!media) {
      return videojs.createTimeRanges();
    }

    mainSeekable = Hls.Playlist.seekable(media,
                                         this.masterPlaylistLoader_.expired_);
    if (mainSeekable.length === 0) {
      return mainSeekable;
    }

    if (this.audioPlaylistLoader_) {
      audioSeekable = Hls.Playlist.seekable(this.audioPlaylistLoader_.media(),
                                            this.audioPlaylistLoader_.expired_);
      if (audioSeekable.length === 0) {
        return audioSeekable;
      }
    }

    if (!audioSeekable) {
      // seekable has been calculated based on buffering video data so it
      // can be returned directly
      return mainSeekable;
    }

    return videojs.createTimeRanges([[
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

    this.audioGroups_.length = 0;
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

    mimeTypes = mimeTypesForPlaylist(this.masterPlaylistLoader_.master, media);
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
        variantCodecs = parseCodecs(variant.attributes.CODECS);
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
}

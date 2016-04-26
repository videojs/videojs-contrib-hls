import PlaylistLoader from './playlist-loader';
import SegmentLoader from './segment-loader';
import Ranges from './ranges';
import videojs from 'video.js';

// 5 minute blacklist
const BLACKLIST_DURATION = 5 * 60 * 1000;
let Hls;

const parseCodecs = function(codecs) {
  let result = {
    codecCount: 0,
    videoCodec: null,
    audioProfile: null
  };

  result.codecCount = codecs.split(',').length;
  result.codecCount = result.codecCount || 2;

  // parse the video codec but ignore the version
  result.videoCodec = (/(^|\s|,)+(avc1)[^ ,]*/i).exec(codecs);
  result.videoCodec = result.videoCodec && result.videoCodec[2];

  // parse the last field of the audio codec
  result.audioProfile = (/(^|\s|,)+mp4a.\d+\.(\d+)/i).exec(codecs);
  result.audioProfile = result.audioProfile && result.audioProfile[2];

  return result;
};

export default class MasterPlaylistController extends videojs.EventTarget {
  constructor({
    url,
    withCredentials,
    mode,
    tech,
    bandwidth,
    externHls
  }) {
    super();

    Hls = externHls;

    this.withCredentials = withCredentials;
    this.tech_ = tech;

    this.mediaSource = new videojs.MediaSource({ mode });
    // load the media source into the player
    this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen_.bind(this));

    // combined audio/video or just video when alternate audio track is selected
    this.mainSegmentLoader_ = new SegmentLoader({
      mediaSource: this.mediaSource,
      currentTime: this.tech_.currentTime.bind(this.tech_),
      withCredentials: this.withCredentials,
      seekable: () => this.seekable(),
      seeking: () => this.tech_.seeking(),
      setCurrentTime: (a) => this.setCurrentTime(a)
    });
    // pass along the starting bandwidth estimate
    this.mainSegmentLoader_.bandwidth = bandwidth;

    // alternate audio track
    this.audioSegmentLoader_ = new SegmentLoader({
      mediaSource: this.mediaSource,
      currentTime: this.tech_.currentTime.bind(this.tech_),
      withCredentials: this.withCredentials,
      seekable: () => this.seekable(),
      seeking: () => this.tech_.seeking(),
      setCurrentTime: (a) => this.setCurrentTime(a)
    });

    if (!url) {
      throw new Error('A non-empty playlist URL is required');
    }

    this.masterPlaylistLoader_ = new PlaylistLoader(url, this.withCredentials);

    this.masterPlaylistLoader_.on('loadedmetadata', () => {
      let media = this.masterPlaylistLoader_.media();
      let master = this.masterPlaylistLoader_.master;

      // if this isn't a live video and preload permits, start
      // downloading segments
      if (media.endList &&
          this.tech_.preload() !== 'metadata' &&
          this.tech_.preload() !== 'none') {
        this.mainSegmentLoader_.playlist(media);
        this.mainSegmentLoader_.expired(this.masterPlaylistLoader_.expired_);
        this.mainSegmentLoader_.load();
      }

      this.audioPlaylistLoaders_ = {};
      if (master.mediaGroups && master.mediaGroups.AUDIO) {
        for (let groupKey in master.mediaGroups.AUDIO) {
          for (let labelKey in master.mediaGroups.AUDIO[groupKey]) {
            // TODO: use one playlist loader for alternate audio and
            // update the src when it is being used
            let audio = master.mediaGroups.AUDIO[groupKey][labelKey];

            if (!audio.resolvedUri) {
              continue;
            }
            this.audioPlaylistLoaders_[audio.resolvedUri] = new PlaylistLoader(
              audio.resolvedUri, this.withCredentials);
          }
        }
      }

      this.setupSourceBuffer_();
      this.setupFirstPlay();
      this.trigger('loadedmetadata');
    });

    this.masterPlaylistLoader_.on('loadedplaylist', () => {
      let updatedPlaylist = this.masterPlaylistLoader_.media();
      let seekable;

      if (!updatedPlaylist) {
        // select the initial variant
        this.initialMedia_ = this.selectPlaylist();

        this.masterPlaylistLoader_.media(this.initialMedia_);
        this.trigger('selectedinitialmedia');
        return;
      }

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
      this.blacklistCurrentPlaylist_(this.masterPlaylistLoader_.error);
    });

    this.masterPlaylistLoader_.on('mediachanging', () => {
      this.mainSegmentLoader_.pause();
    });

    this.masterPlaylistLoader_.on('mediachange', () => {
      this.mainSegmentLoader_.abort();
      this.mainSegmentLoader_.load();
      this.tech_.trigger({
        type: 'mediachange',
        bubbles: true
      });
    });

    this.mainSegmentLoader_.on('progress', () => {
      // figure out what stream the next segment should be downloaded from
      // with the updated bandwidth information
      this.masterPlaylistLoader_.media(this.selectPlaylist());

      this.trigger('progress');
    });

    this.mainSegmentLoader_.on('error', () => {
      this.blacklistCurrentPlaylist_(this.mainSegmentLoader_.error());
    });

    this.audioSegmentLoader_.on('error', () => {
      videojs.log.warn('Problem encountered with the current alternate audio track' +
                       '. Switching back to default.');
      this.audioSegmentLoader_.abort();
      this.audioPlaylistLoader_ = null;
      this.useAudio();
    });

    this.masterPlaylistLoader_.load();
  }

  load() {
    this.mainSegmentLoader_.load();
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.load();
    }
  }

  useAudio() {
    let media = this.masterPlaylistLoader_.media();
    let master = this.masterPlaylistLoader_.master;

    if (!media || !master) {
      videojs.log.warn('useAudio() was called before playlist was loaded');
      return;
    }

    // We have been called but there is no audio track data so we only have the main one
    // (that we know about). An example of this is when the source URL was a playlist
    // manifest, not a master.
    if (!media.attributes || !media.attributes.AUDIO ||
        !master.mediaGroups || !master.mediaGroups.AUDIO) {
      return;
    }
    let mediaGroupName = media.attributes.AUDIO;

    if (!master.mediaGroups.AUDIO[mediaGroupName]) {
      videojs.log.warn('useAudio() was called with a mediaGroup ' + mediaGroupName +
                       ' that does not exist in the master');
      return;
    }
    let audioEntries = master.mediaGroups.AUDIO[mediaGroupName];

    // Pause any alternative audio
    if (this.audioPlaylistLoader_) {
      this.audioPlaylistLoader_.pause();
      this.audioPlaylistLoader_ = null;
      this.audioSegmentLoader_.pause();
    }

    let label = null;

    // if no label was passed in we are switching to the currently enabled audio
    for (let i = 0; i < this.tech_.audioTracks().length; i++) {
      if (this.tech_.audioTracks()[i].enabled) {
        label = this.tech_.audioTracks()[i].label;
        break;
      }
    }

    // all audio tracks are disabled somehow, safari keeps playing
    // so should we
    if (!label) {
      return;
    }

    let audioEntry = audioEntries[label];

    // the label we are trying to use does not have a resolvedUri
    // this means that it is in a combined stream in the main track
    if (!audioEntry || !audioEntry.resolvedUri) {
      this.mainSegmentLoader_.clearBuffer();
      return;
    }

    this.audioPlaylistLoader_ = this.audioPlaylistLoaders_[audioEntry.resolvedUri];

    if (this.audioPlaylistLoader_.started) {
      this.audioPlaylistLoader_.load();
      this.audioSegmentLoader_.load();
      this.audioSegmentLoader_.clearBuffer();
      return;
    }

    this.audioPlaylistLoader_.on('loadedmetadata', () => {
      /* eslint-disable no-shadow */
      let media = this.audioPlaylistLoader_.media();
      /* eslint-enable no-shadow */

      this.audioSegmentLoader_.playlist(media);
      this.addMimeType_(this.audioSegmentLoader_, 'mp4a.40.2', media);

      // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments
      if (!this.tech_.paused() ||
            (media.endList &&
            this.tech_.preload() !== 'metadata' &&
            this.tech_.preload() !== 'none')) {
        this.audioSegmentLoader_.load();
      }

      if (!media.endList) {
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
      this.audioPlaylistLoader_ = null;
      this.useAudio();
    });

    this.audioSegmentLoader_.clearBuffer();
    this.audioPlaylistLoader_.start();
  }

  /**
   * Re-tune playback quality level for the current player
   * conditions. This method may perform destructive actions, like
   * removing already buffered content, to readjust the currently
   * active playlist quickly.
   */
  fastQualityChange_() {
    let media = this.selectPlaylist();

    if (media !== this.masterPlaylistLoader_.media()) {
      this.masterPlaylistLoader_.media(media);
      this.mainSegmentLoader_.sourceUpdater_.remove(this.currentTimeFunc() + 5, Infinity);
    }
  }

  /**
   * Begin playback.
   */
  play() {
    if (this.tech_.ended()) {
      this.tech_.setCurrentTime(0);
    }

    this.load();

    if (this.tech_.played().length === 0) {
      return this.setupFirstPlay();
    }

    // if the viewer has paused and we fell out of the live window,
    // seek forward to the earliest available position
    if (this.tech_.duration() === Infinity) {
      if (this.tech_.currentTime() < this.tech_.seekable().start(0)) {
        this.tech_.setCurrentTime(this.tech_.seekable().start(0));
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

        // 3) the player has not played before and is not paused
        this.tech_.played().length === 0 &&
        !this.tech_.paused()) {

      this.load();

      // 4) the video element or flash player is in a readyState of
      // at least HAVE_FUTURE_DATA
      if (this.tech_.readyState() >= 1) {

        // trigger the playlist loader to start "expired time"-tracking
        this.masterPlaylistLoader_.trigger('firstplay');

        // seek to the latest media position for live videos
        seekable = this.seekable();
        if (seekable.length) {
          this.tech_.setCurrentTime(seekable.end(0));
        }
      }
    }
  }

  handleSourceOpen_() {
    // Only attempt to create the source buffer if none already exist.
    // handleSourceOpen is also called when we are "re-opening" a source buffer
    // after `endOfStream` has been called (in response to a seek for instance)
    this.setupSourceBuffer_();

    // if autoplay is enabled, begin playback. This is duplicative of
    // code in video.js but is required because play() must be invoked
    // *after* the media source has opened.
    if (this.tech_.autoplay()) {
      this.tech_.play();
    }

    this.trigger('sourceopen');
  }

  /*
   * Blacklists a playlist when an error occurs for a set amount of time
   * making it unavailable for selection by the rendition selection algorithm
   * and then forces a new playlist (rendition) selection.
   */
  blacklistCurrentPlaylist_(error) {
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

  pauseLoading() {
    this.mainSegmentLoader_.pause();
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.pause();
    }
  }

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

  duration() {
    if (!this.masterPlaylistLoader_) {
      return 0;
    }

    if (this.mediaSource) {
      return this.mediaSource.duration;
    }

    return Hls.Playlist.duration(this.masterPlaylistLoader_.media());
  }

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

    mainSeekable = Hls.Playlist.seekable(media);
    if (mainSeekable.length === 0) {
      return mainSeekable;
    }

    if (this.audioPlaylistLoader_) {
      audioSeekable = Hls.Playlist.seekable(this.audioPlaylistLoader_.media());
      if (audioSeekable.length === 0) {
        return audioSeekable;
      }
    }

    // if the seekable start is zero, it may be because the player has
    // been paused for a long time and stopped buffering. in that case,
    // fall back to the playlist loader's running estimate of expired
    // time
    if (mainSeekable.start(0) === 0) {
      mainSeekable = videojs.createTimeRanges([[this.masterPlaylistLoader_.expired_,
                                                this.masterPlaylistLoader_.expired_ +
                                                  mainSeekable.end(0)]]);
    }
    if (!audioSeekable) {
      // seekable has been calculated based on buffering video data so it
      // can be returned directly
      return mainSeekable;
    }

    if (audioSeekable.start(0) === 0) {
      audioSeekable = videojs.createTimeRanges([[this.audioPlaylistLoader_.expired_,
                                                 this.audioPlaylistLoader_.expired_ +
                                                  audioSeekable.end(0)]]);
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

  dispose() {
    this.masterPlaylistLoader_.dispose();
    for (let loader in this.audioPlaylistLoaders_) {
      if (this.audioPlaylistLoaders_.hasOwnProperty(loader)) {
        this.audioPlaylistLoaders_[loader].dispose();
      }
    }
    this.mainSegmentLoader_.dispose();
    this.audioSegmentLoader_.dispose();
  }

  master() {
    return this.masterPlaylistLoader_.master;
  }

  media() {
    // playlist loader will not return media if it has not been fully loaded
    return this.masterPlaylistLoader_.media() || this.initialMedia_;
  }

  setupSourceBuffer_() {
    let media = this.masterPlaylistLoader_.media();

    // wait until a media playlist is available and the Media Source is
    // attached
    if (!media || this.mediaSource.readyState !== 'open') {
      return;
    }

    this.addMimeType_(this.mainSegmentLoader_, 'avc1.4d400d, mp4a.40.2', media);

    // exclude any incompatible variant streams from future playlist
    // selection
    this.excludeIncompatibleVariants_(media);
  }

  addMimeType_(segmentLoader, defaultCodecs, media) {
    let mimeType = 'video/mp2t';

    // if the codecs were explicitly specified, pass them along to the
    // source buffer
    if (media.attributes && media.attributes.CODECS) {
      mimeType += '; codecs="' + media.attributes.CODECS + '"';
    } else {
      mimeType += '; codecs="' + defaultCodecs + '"';
    }
    segmentLoader.mimeType(mimeType);
  }

  /**
   * Blacklist playlists that are known to be codec or
   * stream-incompatible with the SourceBuffer configuration. For
   * instance, Media Source Extensions would cause the video element to
   * stall waiting for video data if you switched from a variant with
   * video and audio to an audio-only one.
   *
   * @param media {object} a media playlist compatible with the current
   * set of SourceBuffers. Variants in the current master playlist that
   * do not appear to have compatible codec or stream configurations
   * will be excluded from the default playlist selection algorithm
   * indefinitely.
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

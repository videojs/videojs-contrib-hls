import PlaylistLoader from './playlist-loader';
import SegmentLoader from './segment-loader';
import Ranges from './ranges';
import videojs from 'video.js';

// 5 minute blacklist
const BLACKLIST_DURATION = 5 * 60 * 1000;

// A fudge factor to apply to advertised playlist bitrates to account for
// temporary flucations in client bandwidth
const BANDWIDTH_VARIANCE = 1.2;

let Hls;

/**
 * Returns the CSS value for the specified property on an element
 * using `getComputedStyle`. Firefox has a long-standing issue where
 * getComputedStyle() may return null when running in an iframe with
 * `display: none`.
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=548397
 */
const safeGetComputedStyle = function(el, property) {
  let result;

  if (!el) {
    return '';
  }

  result = getComputedStyle(el);
  if (!result) {
    return '';
  }

  return result[property];
};

/**
 * Chooses the appropriate media playlist based on the current
 * bandwidth estimate and the player size.
 * @return the highest bitrate playlist less than the currently detected
 * bandwidth, accounting for some amount of bandwidth variance
 */
const selectPlaylist = function() {
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

    if (effectiveBitrate < this.bandwidth) {
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
  constructor({url, withCredentials, currentTimeFunc, mediaSourceMode, hlsHandler,
    externHls}) {
    super();

    Hls = externHls;

    this.withCredentials = withCredentials;
    this.currentTimeFunc = currentTimeFunc;
    this.mediaSourceMode = mediaSourceMode;

    this.mediaSource = new videojs.MediaSource({ mode: this.mediaSourceMode });
    // load the media source into the player
    this.mediaSource.addEventListener('sourceopen', this.handleSourceOpen_.bind(this));

    this.hlsHandler = hlsHandler;
    this.hlsHandler.mediaSource = this.mediaSource;
    this.hlsHandler.selectPlaylist = this.hlsHandler.selectPlaylist || selectPlaylist;

    // combined audio/video or just video when alternate audio track is selected
    this.mainSegmentLoader_ = new SegmentLoader({
      mediaSource: this.mediaSource,
      currentTime: this.currentTimeFunc,
      withCredentials: this.withCredentials,
      seekable: () => this.seekable(),
      seeking: () => this.hlsHandler.tech_.seeking(),
      setCurrentTime: (a) => this.setCurrentTime(a)
    });
    // alternate audio track
    this.audioSegmentLoader_ = new SegmentLoader({
      mediaSource: this.mediaSource,
      currentTime: this.currentTimeFunc,
      withCredentials: this.withCredentials,
      seekable: () => this.seekable(),
      seeking: () => this.hlsHandler.tech_.seeking(),
      setCurrentTime: (a) => this.setCurrentTime(a)
    });

    if (!url) {
      throw new Error('A non-empty playlist URL is required');
    }

    this.masterPlaylistLoader_ = new PlaylistLoader(url, this.withCredentials);
    this.hlsHandler.playlists = this.masterPlaylistLoader_;

    this.masterPlaylistLoader_.on('loadedmetadata', () => {
      let media = this.masterPlaylistLoader_.media();
      let master = this.masterPlaylistLoader_.master;

      // if this isn't a live video and preload permits, start
      // downloading segments
      if (media.endList &&
          this.hlsHandler.tech_.preload() !== 'metadata' &&
          this.hlsHandler.tech_.preload() !== 'none') {
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
        let media = this.hlsHandler.selectPlaylist();

        this.masterPlaylistLoader_.media(media);
        return;
      }

      this.mainSegmentLoader_.playlist(updatedPlaylist);
      this.mainSegmentLoader_.expired(this.masterPlaylistLoader_.expired_);
      this.updateDuration(this.masterPlaylistLoader_.media());

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
      this.hlsHandler.tech_.trigger({
        type: 'mediachange',
        bubbles: true
      });
    });

    this.mainSegmentLoader_.on('progress', () => {
      // figure out what stream the next segment should be downloaded from
      // with the updated bandwidth information
      this.hlsHandler.bandwidth = this.mainSegmentLoader_.bandwidth;
      this.masterPlaylistLoader_.media(this.hlsHandler.selectPlaylist());

      this.hlsHandler.tech_.trigger('progress');
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

    if (!media || !media.attributes || !media.attributes.AUDIO ||
        !master.mediaGroups || !master.mediaGroups.AUDIO) {
      return;
    }
    let mediaGroupName = media.attributes.AUDIO;

    if (!master.mediaGroups.AUDIO[mediaGroupName]) {
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
    for (let i = 0; i < this.hlsHandler.tech_.audioTracks().length; i++) {
      if (this.hlsHandler.tech_.audioTracks()[i].enabled) {
        label = this.hlsHandler.tech_.audioTracks()[i].label;
        break;
      }
    }
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
      if (!this.hlsHandler.tech_.paused() ||
            (media.endList &&
            this.hlsHandler.tech_.preload() !== 'metadata' &&
            this.hlsHandler.tech_.preload() !== 'none')) {
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
        this.hlsHandler.tech_.played().length === 0 &&
        !this.hlsHandler.tech_.paused()) {

      this.load();

      // 4) the video element or flash player is in a readyState of
      // at least HAVE_FUTURE_DATA
      if (this.hlsHandler.tech_.readyState() >= 1) {

        // trigger the playlist loader to start "expired time"-tracking
        this.masterPlaylistLoader_.trigger('firstplay');

        // seek to the latest media position for live videos
        seekable = this.seekable();
        if (seekable.length) {
          this.hlsHandler.tech_.setCurrentTime(seekable.end(0));
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
    if (this.hlsHandler.tech_.autoplay()) {
      this.hlsHandler.play();
    }
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
      this.hlsHandler.error = error;
      return this.mediaSource.endOfStream('network');
    }

    // Blacklist this playlist
    currentPlaylist.excludeUntil = Date.now() + BLACKLIST_DURATION;

    // Select a new playlist
    nextPlaylist = this.hlsHandler.selectPlaylist();

    if (nextPlaylist) {
      videojs.log.warn('Problem encountered with the current ' +
                       'HLS playlist. Switching to another playlist.');

      return this.masterPlaylistLoader_.media(nextPlaylist);
    }
    videojs.log.warn('Problem encountered with the current ' +
                     'HLS playlist. No suitable alternatives found.');
    // We have no more playlists we can select so we must fail
    this.hlsHandler.error = error;
    return this.mediaSource.endOfStream('network');
  }

  pauseLoading() {
    this.mainSegmentLoader_.pause();
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.pause();
    }
  }

  setCurrentTime(currentTime) {
    let buffered = Ranges.findRange(this.hlsHandler.tech_.buffered(), currentTime);

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

    if (!this.hlsHandler.tech_.paused()) {
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
  updateDuration(playlist) {
    let oldDuration = this.mediaSource.duration;
    let newDuration = Hls.Playlist.duration(playlist);
    let buffered = this.hlsHandler.tech_.buffered();
    let setDuration = () => {
      this.mediaSource.duration = newDuration;
      this.hlsHandler.tech_.trigger('durationchange');

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
    this.audioPlaylistLoaders_.forEach((loader) => {
      loader.dispose();
    });
    this.mainSegmentLoader_.dispose();
    this.audioSegmentLoader_.dispose();
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

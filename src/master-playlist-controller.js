import Stream from './stream';
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

export default class MasterPlaylistController extends Stream {
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

    // combined audio/video or just video when alternate audio track is selected
    this.mainSegmentLoader_ = new SegmentLoader({
      mediaSource: this.mediaSource,
      currentTime: this.currentTimeFunc,
      withCredentials: this.withCredentials
    });
    // alternate audio track
    this.audioSegmentLoader_ = new SegmentLoader({
      mediaSource: this.mediaSource,
      currentTime: this.currentTimeFunc,
      withCredentials: this.withCredentials
    });

    this.hlsHandler = hlsHandler;
    this.hlsHandler.selectPlaylist = this.hlsHandler.selectPlaylist || selectPlaylist;

    if (!url) {
      throw new Error('A non-empty playlist URL is required');
    }

    this.masterPlaylistLoader_ = new PlaylistLoader(url, this.withCredentials);
    this.hlsHandler.playlists = this.masterPlaylistLoader_;

    this.masterPlaylistLoader_.on('loadedmetadata', () => {
      // if this isn't a live video and preload permits, start
      // downloading segments
      if (this.masterPlaylistLoader_.media().endList &&
          this.hlsHandler.tech_.preload() !== 'metadata' &&
          this.hlsHandler.tech_.preload() !== 'none') {
        this.mainSegmentLoader_.playlist(this.masterPlaylistLoader_.media());
        this.mainSegmentLoader_.load();
      }

      this.setupFirstPlay();
      this.hlsHandler.tech_.trigger('loadedmetadata');
    });

    this.masterPlaylistLoader_.on('loadedplaylist', () => {
      let updatedPlaylist = this.masterPlaylistLoader_.media();
      let seekable;

      if (!updatedPlaylist) {
        // select the initial variant
        this.masterPlaylistLoader_.media(this.hlsHandler.selectPlaylist());
        return;
      }

      this.mainSegmentLoader_.playlist(updatedPlaylist);
      this.updateDuration(this.masterPlaylistLoader_.media());

      // update seekable
      seekable = this.hlsHandler.seekable();
      if (this.hlsHandler.duration() === Infinity && seekable.length !== 0) {
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
  }

  load() {
    this.mainSegmentLoader_.load();
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.load();
    }
  }

  loadAlternateAudioPlaylist(playlistLoader) {
    this.audioPlaylistLoader_ = playlistLoader;

    this.audioPlaylistLoader_.on('loadedmetadata', () => {
      this.audioSegmentLoader_.playlist(this.audioPlaylistLoader_.media());

      // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments
      if (!this.hlsHandler.tech_.paused() ||
            (this.audioPlaylistLoader_.media().endList &&
            this.hlsHandler.tech_.preload() !== 'metadata' &&
            this.hlsHandler.tech_.preload() !== 'none')) {
        this.audioSegmentLoader_.load();
      }
    });

    this.audioPlaylistLoader_.on('loadedplaylist', () => {
      let updatedPlaylist = this.audioPlaylistLoader_.media();
      let seekable;

      if (!updatedPlaylist) {
        // only one playlist to select
        this.audioPlaylistLoader_.media(
          this.audioPlaylistLoader_.playlists.master.playlists[0]);
        return;
      }

      this.audioSegmentLoader_.playlist(updatedPlaylist);
    });

    this.audioPlaylistLoader_.on('error', () => {
      this.audioSegmentLoader_.abort();
      this.audioPlaylistLoader_ = null;
      // TODO go back to using combined
    });

    this.audioSegmentLoader_.on('error', () => {
      this.audioSegmentLoader_.abort();
      this.audioPlaylistLoader_ = null;
      // TODO go back to using combined
    });
  }

  /**
   * Seek to the latest media position if this is a live video and the
   * player and video are loaded and initialized.
   */
  setupFirstPlay() {
    let seekable;
    let media = this.masterPlaylistLoader_.media();

    // check that everything is ready to begin buffering

    // 1) the video is a live stream of unknown duration
    if (this.hlsHandler.duration() === Infinity &&

        // 2) the player has not played before and is not paused
        this.hlsHandler.tech_.played().length === 0 &&
        !this.hlsHandler.tech_.paused() &&

        // 3) the active media playlist is available
        media) {

      this.load();

      // 4) the video element or flash player is in a readyState of
      // at least HAVE_FUTURE_DATA
      if (this.hlsHandler.tech_.readyState() >= 1) {

        // trigger the playlist loader to start "expired time"-tracking
        this.masterPlaylistLoader_.trigger('firstplay');

        // seek to the latest media position for live videos
        seekable = this.hlsHandler.seekable();
        if (seekable.length) {
          this.hlsHandler.tech_.setCurrentTime(seekable.end(0));
        }
      }
    }
  }

  handleSourceOpen_() {
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

  pause() {
    this.mainSegmentLoader_.pause();
    if (this.audioPlaylistLoader_) {
      this.audioSegmentLoader_.pause();
    }
  }

  setCurrentTime(currentTime) {
    let buffered = Ranges.findRange_(this.hlsHandler.tech_.buffered(), currentTime);

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
    let seekable;

    if (!this.masterPlaylistLoader_) {
      return videojs.createTimeRanges();
    }
    media = this.masterPlaylistLoader_.media();
    if (!media) {
      return videojs.createTimeRanges();
    }

    seekable = Hls.Playlist.seekable(media);
    if (seekable.length === 0) {
      return seekable;
    }

    // if the seekable start is zero, it may be because the player has
    // been paused for a long time and stopped buffering. in that case,
    // fall back to the playlist loader's running estimate of expired
    // time
    if (seekable.start(0) === 0) {
      return videojs.createTimeRanges([[this.masterPlaylistLoader_.expired_,
                                        this.masterPlaylistLoader_.expired_ +
                                          seekable.end(0)]]);
    }

    // seekable has been calculated based on buffering video data so it
    // can be returned directly
    return seekable;
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
    this.mainSegmentLoader_.dispose();
    this.audioSegmentLoader_.dispose();
  }
}

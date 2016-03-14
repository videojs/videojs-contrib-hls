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
  constructor({url, withCredentials, currentTimeFunc, mediaSource, hlsHandler,
    externHls}) {
    super();

    this.segmentLoader_ = new SegmentLoader({
      mediaSource,
      currentTime: currentTimeFunc,
      withCredentials
    });
    this.hlsHandler = hlsHandler;

    Hls = externHls;

    this.hlsHandler.selectPlaylist = this.hlsHandler.selectPlaylist || selectPlaylist;

    if (!url) {
      throw new Error('A non-empty playlist URL is required');
    }

    this.masterPlaylistLoader_ = new PlaylistLoader(url, withCredentials);
    this.hlsHandler.playlists = this.masterPlaylistLoader_;

    this.masterPlaylistLoader_.on('loadedmetadata', () => {
      // if this isn't a live video and preload permits, start
      // downloading segments
      if (this.masterPlaylistLoader_.media().endList &&
          this.hlsHandler.tech_.preload() !== 'metadata' &&
          this.hlsHandler.tech_.preload() !== 'none') {
        this.segmentLoader_.playlist(this.masterPlaylistLoader_.media());
        this.segmentLoader_.load();
      }

      this.hlsHandler.setupSourceBuffer_();
      this.hlsHandler.setupFirstPlay();
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

      this.segmentLoader_.playlist(updatedPlaylist);
      this.hlsHandler.updateDuration(this.masterPlaylistLoader_.media());

      // update seekable
      seekable = this.hlsHandler.seekable();
      if (this.hlsHandler.duration() === Infinity && seekable.length !== 0) {
        this.hlsHandler.mediaSource.addSeekableRange_(seekable.start(0), seekable.end(0));
      }
    });

    this.masterPlaylistLoader_.on('error', () => {
      this.blacklistCurrentPlaylist_(this.masterPlaylistLoader_.error);
    });

    this.masterPlaylistLoader_.on('mediachanging', () => {
      this.segmentLoader_.pause();
    });

    this.masterPlaylistLoader_.on('mediachange', () => {
      this.segmentLoader_.abort();
      this.segmentLoader_.load();
      this.hlsHandler.tech_.trigger({
        type: 'mediachange',
        bubbles: true
      });
    });

    this.segmentLoader_.on('progress', () => {
      // figure out what stream the next segment should be downloaded from
      // with the updated bandwidth information
      this.hlsHandler.bandwidth = this.segmentLoader_.bandwidth;
      this.masterPlaylistLoader_.media(this.hlsHandler.selectPlaylist());

      this.tech_.trigger('progress');
    });

    this.segmentLoader_.on('error', () => {
      this.blacklistCurrentPlaylist_(this.segmentLoader_.error());
    });
  }

  load() {
    this.mainSegmentLoader_.load();
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
      return this.hlsHandler.mediaSource.endOfStream('network');
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
    return this.hlsHandler.mediaSource.endOfStream('network');
  }

  pause() {
    this.segmentLoader_.pause();
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
    this.segmentLoader_.abort();

    if (!this.hlsHandler.tech_.paused()) {
      this.segmentLoader_.load();
    }
  }

  dispose() {
    this.masterPlaylistLoader_.dispose();
    this.segmentLoader_.dispose();
  }
}

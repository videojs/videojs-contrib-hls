import Config from './config';
import Playlist from './playlist';
import { parseCodecs } from './util/codecs.js';

// Utilities

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
 * Resuable stable sort function
 *
 * @param {Playlists} array
 * @param {Function} sortFn Different comparators
 * @function stableSort
 */
const stableSort = function(array, sortFn) {
  let newArray = array.slice();

  array.sort(function(left, right) {
    let cmp = sortFn(left, right);

    if (cmp === 0) {
      return newArray.indexOf(left) - newArray.indexOf(right);
    }
    return cmp;
  });
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
export const comparePlaylistBandwidth = function(left, right) {
  let leftBandwidth;
  let rightBandwidth;

  if (left.attributes.BANDWIDTH) {
    leftBandwidth = left.attributes.BANDWIDTH;
  }
  leftBandwidth = leftBandwidth || window.Number.MAX_VALUE;
  if (right.attributes.BANDWIDTH) {
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
export const comparePlaylistResolution = function(left, right) {
  let leftWidth;
  let rightWidth;

  if (left.attributes.RESOLUTION &&
      left.attributes.RESOLUTION.width) {
    leftWidth = left.attributes.RESOLUTION.width;
  }

  leftWidth = leftWidth || window.Number.MAX_VALUE;

  if (right.attributes.RESOLUTION &&
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

/**
 * Chooses the appropriate media playlist based on bandwidth and player size
 *
 * @param {Object} master
 *        Object representation of the master manifest
 * @param {Number} playerBandwidth
 *        Current calculated bandwidth of the player
 * @param {Number} playerWidth
 *        Current width of the player element
 * @param {Number} playerHeight
 *        Current height of the player element
 * @return {Playlist} the highest bitrate playlist less than the
 * currently detected bandwidth, accounting for some amount of
 * bandwidth variance
 */
export const simpleSelector = function(master,
                                       playerBandwidth,
                                       playerWidth,
                                       playerHeight) {
  // convert the playlists to an intermediary representation to make comparisons easier
  let sortedPlaylistReps = master.playlists.map((playlist) => {
    let width;
    let height;
    let bandwidth;

    width = playlist.attributes.RESOLUTION && playlist.attributes.RESOLUTION.width;
    height = playlist.attributes.RESOLUTION && playlist.attributes.RESOLUTION.height;
    bandwidth = playlist.attributes.BANDWIDTH;

    bandwidth = bandwidth || window.Number.MAX_VALUE;

    return {
      bandwidth,
      width,
      height,
      playlist
    };
  });

  stableSort(sortedPlaylistReps, (left, right) => left.bandwidth - right.bandwidth);

  // filter out any playlists that have been excluded due to
  // incompatible configurations
  sortedPlaylistReps = sortedPlaylistReps.filter(
    (rep) => !Playlist.isIncompatible(rep.playlist)
  );

  // filter out any playlists that have been disabled manually through the representations
  // api or blacklisted temporarily due to playback errors.
  let enabledPlaylistReps = sortedPlaylistReps.filter(
    (rep) => Playlist.isEnabled(rep.playlist)
  );

  if (!enabledPlaylistReps.length) {
    // if there are no enabled playlists, then they have all been blacklisted or disabled
    // by the user through the representations api. In this case, ignore blacklisting and
    // fallback to what the user wants by using playlists the user has not disabled.
    enabledPlaylistReps = sortedPlaylistReps.filter(
      (rep) => !Playlist.isDisabled(rep.playlist)
    );
  }

  // filter out any variant that has greater effective bitrate
  // than the current estimated bandwidth
  let bandwidthPlaylistReps = enabledPlaylistReps.filter(
    (rep) => rep.bandwidth * Config.BANDWIDTH_VARIANCE < playerBandwidth
  );

  let highestRemainingBandwidthRep =
    bandwidthPlaylistReps[bandwidthPlaylistReps.length - 1];

  // get all of the renditions with the same (highest) bandwidth
  // and then taking the very first element
  let bandwidthBestRep = bandwidthPlaylistReps.filter(
    (rep) => rep.bandwidth === highestRemainingBandwidthRep.bandwidth
  )[0];

  // filter out playlists without resolution information
  let haveResolution = bandwidthPlaylistReps.filter((rep) => rep.width && rep.height);

  // sort variants by resolution
  stableSort(haveResolution, (left, right) => left.width - right.width);

  // if we have the exact resolution as the player use it
  let resolutionBestRepList = haveResolution.filter(
    (rep) => rep.width === playerWidth && rep.height === playerHeight
  );

  highestRemainingBandwidthRep = resolutionBestRepList[resolutionBestRepList.length - 1];
  // ensure that we pick the highest bandwidth variant that have exact resolution
  let resolutionBestRep = resolutionBestRepList.filter(
    (rep) => rep.bandwidth === highestRemainingBandwidthRep.bandwidth
  )[0];

  let resolutionPlusOneList;
  let resolutionPlusOneSmallest;
  let resolutionPlusOneRep;

  // find the smallest variant that is larger than the player
  // if there is no match of exact resolution
  if (!resolutionBestRep) {
    resolutionPlusOneList = haveResolution.filter(
      (rep) => rep.width > playerWidth || rep.height > playerHeight
    );

    // find all the variants have the same smallest resolution
    resolutionPlusOneSmallest = resolutionPlusOneList.filter(
      (rep) => rep.width === resolutionPlusOneList[0].width &&
               rep.height === resolutionPlusOneList[0].height
    );

    // ensure that we also pick the highest bandwidth variant that
    // is just-larger-than the video player
    highestRemainingBandwidthRep =
      resolutionPlusOneSmallest[resolutionPlusOneSmallest.length - 1];
    resolutionPlusOneRep = resolutionPlusOneSmallest.filter(
      (rep) => rep.bandwidth === highestRemainingBandwidthRep.bandwidth
    )[0];
  }

  // fallback chain of variants
  let chosenRep = (
    resolutionPlusOneRep ||
    resolutionBestRep ||
    bandwidthBestRep ||
    enabledPlaylistReps[0] ||
    sortedPlaylistReps[0]
  );

  return chosenRep ? chosenRep.playlist : null;
};

// Playlist Selectors

/**
 * Chooses the appropriate media playlist based on the most recent
 * bandwidth estimate and the player size.
 *
 * Expects to be called within the context of an instance of HlsHandler
 *
 * @return {Playlist} the highest bitrate playlist less than the
 * currently detected bandwidth, accounting for some amount of
 * bandwidth variance
 */
export const lastBandwidthSelector = function() {
  return simpleSelector(this.playlists.master,
                        this.systemBandwidth,
                        parseInt(safeGetComputedStyle(this.tech_.el(), 'width'), 10),
                        parseInt(safeGetComputedStyle(this.tech_.el(), 'height'), 10));
};

/**
 * Chooses the appropriate media playlist based on an
 * exponential-weighted moving average of the bandwidth after
 * filtering for player size.
 *
 * Expects to be called within the context of an instance of HlsHandler
 *
 * @param {Number} decay - a number between 0 and 1. Higher values of
 * this parameter will cause previous bandwidth estimates to lose
 * significance more quickly.
 * @return {Function} a function which can be invoked to create a new
 * playlist selector function.
 * @see https://en.wikipedia.org/wiki/Moving_average#Exponential_moving_average
 */
export const movingAverageBandwidthSelector = function(decay) {
  let average = -1;

  if (decay < 0 || decay > 1) {
    throw new Error('Moving average bandwidth decay must be between 0 and 1.');
  }

  return function() {
    if (average < 0) {
      average = this.systemBandwidth;
    }

    average = decay * this.systemBandwidth + (1 - decay) * average;
    return simpleSelector(this.playlists.master,
                          average,
                          parseInt(safeGetComputedStyle(this.tech_.el(), 'width'), 10),
                          parseInt(safeGetComputedStyle(this.tech_.el(), 'height'), 10));
  };
};

/**
 * Chooses the appropriate media playlist based on the potential to rebuffer
 *
 * @param {Object} settings
 *        Object of information required to use this selector
 * @param {Object} settings.master
 *        Object representation of the master manifest
 * @param {Number} settings.currentTime
 *        The current time of the player
 * @param {Number} settings.bandwidth
 *        Current measured bandwidth
 * @param {Number} settings.duration
 *        Duration of the media
 * @param {Number} settings.segmentDuration
 *        Segment duration to be used in round trip time calculations
 * @param {Number} settings.timeUntilRebuffer
 *        Time left in seconds until the player has to rebuffer
 * @param {Number} settings.currentTimeline
 *        The current timeline segments are being loaded from
 * @param {SyncController} settings.syncController
 *        SyncController for determining if we have a sync point for a given playlist
 * @return {Object|null}
 *         {Object} return.playlist
 *         The highest bandwidth playlist with the least amount of rebuffering
 *         {Number} return.rebufferingImpact
 *         The amount of time in seconds switching to this playlist will rebuffer. A
 *         negative value means that switching will cause zero rebuffering.
 */
export const minRebufferMaxBandwidthSelector = function(settings) {
  const {
    master,
    currentTime,
    bandwidth,
    duration,
    segmentDuration,
    timeUntilRebuffer,
    currentTimeline,
    syncController
  } = settings;

  // filter out any playlists that have been excluded due to
  // incompatible configurations
  const compatiblePlaylists = master.playlists.filter(
    playlist => !Playlist.isIncompatible(playlist));

  // filter out any playlists that have been disabled manually through the representations
  // api or blacklisted temporarily due to playback errors.
  let enabledPlaylists = compatiblePlaylists.filter(Playlist.isEnabled);

  if (!enabledPlaylists.length) {
    // if there are no enabled playlists, then they have all been blacklisted or disabled
    // by the user through the representations api. In this case, ignore blacklisting and
    // fallback to what the user wants by using playlists the user has not disabled.
    enabledPlaylists = compatiblePlaylists.filter(
      playlist => !Playlist.isDisabled(playlist));
  }

  const bandwidthPlaylists =
    enabledPlaylists.filter(Playlist.hasAttribute.bind(null, 'BANDWIDTH'));

  const rebufferingEstimates = bandwidthPlaylists.map((playlist) => {
    const syncPoint = syncController.getSyncPoint(playlist,
                                                  duration,
                                                  currentTimeline,
                                                  currentTime);
    // If there is no sync point for this playlist, switching to it will require a
    // sync request first. This will double the request time
    const numRequests = syncPoint ? 1 : 2;
    const requestTimeEstimate = Playlist.estimateSegmentRequestTime(segmentDuration,
                                                                    bandwidth,
                                                                    playlist);
    const rebufferingImpact = (requestTimeEstimate * numRequests) - timeUntilRebuffer;

    return {
      playlist,
      rebufferingImpact
    };
  });

  const noRebufferingPlaylists = rebufferingEstimates.filter(
    (estimate) => estimate.rebufferingImpact <= 0);

  // Sort by bandwidth DESC
  stableSort(noRebufferingPlaylists,
    (a, b) => comparePlaylistBandwidth(b.playlist, a.playlist));

  if (noRebufferingPlaylists.length) {
    return noRebufferingPlaylists[0];
  }

  stableSort(rebufferingEstimates, (a, b) => a.rebufferingImpact - b.rebufferingImpact);

  return rebufferingEstimates[0] || null;
};

/**
 * Chooses the appropriate media playlist, which in this case is the lowest bitrate
 * one with video.  If no renditions with video exist, return the lowest audio rendition.
 *
 * Expects to be called within the context of an instance of HlsHandler
 *
 * @return {Object|null}
 *         {Object} return.playlist
 *         The lowest bitrate playlist that contains a video codec.  If no such rendition
 *         exists pick the lowest audio rendition.
 */
export const lowestBitrateCompatibleVariantSelector = function() {
  // filter out any playlists that have been excluded due to
  // incompatible configurations or playback errors
  const playlists = this.playlists.master.playlists.filter(Playlist.isEnabled);

  // Sort ascending by bitrate
  stableSort(playlists,
    (a, b) => comparePlaylistBandwidth(a, b));

  // Parse and assume that playlists with no video codec have no video
  // (this is not necessarily true, although it is generally true).
  //
  // If an entire manifest has no valid videos everything will get filtered
  // out.
  const playlistsWithVideo = playlists.filter(
    playlist => parseCodecs(playlist.attributes.CODECS).videoCodec
  );

  return playlistsWithVideo[0] || null;
};

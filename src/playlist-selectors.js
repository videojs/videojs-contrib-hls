import Config from './config';
import Playlist from './playlist';

// Utilities

export const crossedLowWaterLine = (currentTime, buffered) => {
  const forwardBuffer = buffered.length ?
    buffered.end(buffered.length - 1) - currentTime : 0;

  return forwardBuffer >= Config.BUFFER_LOW_WATER_LINE;
};

export const getBandwidth = (playlist, useAverageBandwidth) => {
  if (!playlist || !playlist.attributes) {
    return 0;
  }

  let bandwidth;

  if (useAverageBandwidth) {
    bandwidth = playlist.attributes['AVERAGE-BANDWIDTH'];
  }

  if (!bandwidth) {
    bandwidth = playlist.attributes.BANDWIDTH;
  }

  return bandwidth || 0;
};

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
export const comparePlaylistBandwidth = function(useAverageBandwidth, left, right) {
  let leftBandwidth = getBandwidth(left, useAverageBandwidth) || window.Number.MAX_VALUE;
  let rightBandwidth =
    getBandwidth(right, useAverageBandwidth) || window.Number.MAX_VALUE;

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
export const comparePlaylistResolution = function(useAverageBandwidth, left, right) {
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

  const leftBandwidth = getBandwidth(left, useAverageBandwidth);
  const rightBandwidth = getBandwidth(right, useAverageBandwidth);

  // NOTE - Fallback to bandwidth sort as appropriate in cases where multiple renditions
  // have the same media dimensions/ resolution.
  if (leftWidth === rightWidth && leftBandwidth && rightBandwidth) {
    return leftBandwidth - rightBandwidth;
  }
  return leftWidth - rightWidth;
};

const simpleSelector = function(master,
                                bandwidth,
                                width,
                                height,
                                useAverageBandwidth = false) {
  let sortedPlaylists = master.playlists.slice();

  stableSort(sortedPlaylists, comparePlaylistBandwidth.bind(null, useAverageBandwidth));

  // convert the playlists to an intermediary representation to make comparisons easier
  // and prevent us from re-determining bandwidth each time
  let sortedPlaylistReps = sortedPlaylists.map((playlist) => {
    let playlistWidth;
    let playlistHeight;

    if (playlist.attributes && playlist.attributes.RESOLUTION) {
      playlistWidth = playlist.attributes.RESOLUTION.width;
      playlistHeight = playlist.attributes.RESOLUTION.height;
    }

    return {
      bandwidth: getBandwidth(playlist, useAverageBandwidth),
      width: playlistWidth,
      height: playlistHeight,
      playlist
    };
  });

  // filter out any playlists that have been excluded due to
  // incompatible configurations or playback errors
  sortedPlaylistReps = sortedPlaylistReps.filter(
    (rep) => Playlist.isEnabled(rep.playlist));

  // filter out any variant that has greater effective bitrate
  // than the current estimated bandwidth
  let bandwidthPlaylistReps = sortedPlaylistReps.filter(
    (rep) => rep.bandwidth && rep.bandwidth * Config.BANDWIDTH_VARIANCE < bandwidth
  );

  let highestRemainingBandwidthRep =
    bandwidthPlaylistReps[bandwidthPlaylistReps.length - 1];

  // get all of the renditions with the same (highest) bandwidth
  // and then taking the very first element
  let bandwidthBestRep = bandwidthPlaylistReps.filter(
    (rep) => rep.bandwidth === highestRemainingBandwidthRep.bandwidth
  )[0];

  // sort variants by resolution
  stableSort(bandwidthPlaylistReps, (left, right) => {
    const leftWidth = left.width || window.Number.MAX_VALUE;
    const rightWidth = right.width || window.Number.MAX_VALUE;

    return leftWidth - rightWidth;
  });

  // filter out playlists without resolution information
  let haveResolution = bandwidthPlaylistReps.filter((rep) => rep.width && rep.height);

  // if we have the exact resolution as the player use it
  let resolutionBestRepList =
    haveResolution.filter((rep) => rep.width === width && rep.height === height);

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
    resolutionPlusOneList =
      haveResolution.filter((rep) => rep.width > width || rep.height > height);

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
  return (
    resolutionPlusOneRep ||
    resolutionBestRep ||
    bandwidthBestRep ||
    sortedPlaylistReps[0]
  ).playlist;
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
                        parseInt(safeGetComputedStyle(this.tech_.el(), 'height'), 10),
                        crossedLowWaterLine(this.tech_.currentTime(),
                                            this.tech_.buffered()));
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
                          parseInt(safeGetComputedStyle(this.tech_.el(), 'height'), 10),
                          crossedLowWaterLine(this.tech_.currentTime(),
                                              this.tech_.buffered()));
  };
};

import Config from './config';
import Playlist from './playlist';

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

  if (left.attributes && left.attributes.BANDWIDTH) {
    leftBandwidth = left.attributes.BANDWIDTH;
  }
  leftBandwidth = leftBandwidth || window.Number.MAX_VALUE;
  if (right.attributes && right.attributes.BANDWIDTH) {
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

  // NOTE - Fallback to bandwidth sort as appropriate in cases where multiple renditions
  // have the same media dimensions/ resolution
  if (leftWidth === rightWidth &&
      left.attributes.BANDWIDTH &&
      right.attributes.BANDWIDTH) {
    return left.attributes.BANDWIDTH - right.attributes.BANDWIDTH;
  }
  return leftWidth - rightWidth;
};

const simpleSelector = function(master, bandwidth, width, height) {
  let sortedPlaylists = master.playlists.slice();
  let bandwidthPlaylists = [];
  let bandwidthBestVariant;
  let resolutionPlusOne;
  let resolutionBestVariant;
  let haveResolution;
  let resolutionPlusOneList = [];
  let resolutionPlusOneSmallest = [];
  let resolutionBestVariantList = [];

  stableSort(sortedPlaylists, comparePlaylistBandwidth);

  // filter out any playlists that have been excluded due to
  // incompatible configurations or playback errors
  sortedPlaylists = sortedPlaylists.filter(Playlist.isEnabled);
  // filter out any variant that has greater effective bitrate
  // than the current estimated bandwidth
  bandwidthPlaylists = sortedPlaylists.filter(function(elem) {
    return elem.attributes &&
           elem.attributes.BANDWIDTH &&
           elem.attributes.BANDWIDTH * Config.BANDWIDTH_VARIANCE < bandwidth;
  });

  // get all of the renditions with the same (highest) bandwidth
  // and then taking the very first element
  bandwidthBestVariant = bandwidthPlaylists.filter(function(elem) {
    return elem.attributes.BANDWIDTH === bandwidthPlaylists[bandwidthPlaylists.length - 1].attributes.BANDWIDTH;
  })[0];

  // sort variants by resolution
  stableSort(bandwidthPlaylists, comparePlaylistResolution);

  // filter out playlists without resolution information
  haveResolution = bandwidthPlaylists.filter(function(elem) {
    return elem.attributes &&
           elem.attributes.RESOLUTION &&
           elem.attributes.RESOLUTION.width &&
           elem.attributes.RESOLUTION.height;
  });

  // if we have the exact resolution as the player use it
  resolutionBestVariantList = haveResolution.filter(function(elem) {
    return elem.attributes.RESOLUTION.width === width &&
           elem.attributes.RESOLUTION.height === height;
  });
  // ensure that we pick the highest bandwidth variant that have exact resolution
  resolutionBestVariant = resolutionBestVariantList.filter(function(elem) {
    return elem.attributes.BANDWIDTH === resolutionBestVariantList[resolutionBestVariantList.length - 1].attributes.BANDWIDTH;
  })[0];

  // find the smallest variant that is larger than the player
  // if there is no match of exact resolution
  if (!resolutionBestVariant) {
    resolutionPlusOneList = haveResolution.filter(function(elem) {
      return elem.attributes.RESOLUTION.width > width ||
             elem.attributes.RESOLUTION.height > height;
    });
    // find all the variants have the same smallest resolution
    resolutionPlusOneSmallest = resolutionPlusOneList.filter(function(elem) {
      return elem.attributes.RESOLUTION.width === resolutionPlusOneList[0].attributes.RESOLUTION.width &&
             elem.attributes.RESOLUTION.height === resolutionPlusOneList[0].attributes.RESOLUTION.height;
    });
    // ensure that we also pick the highest bandwidth variant that
    // is just-larger-than the video player
    resolutionPlusOne = resolutionPlusOneSmallest.filter(function(elem) {
      return elem.attributes.BANDWIDTH === resolutionPlusOneSmallest[resolutionPlusOneSmallest.length - 1].attributes.BANDWIDTH;
    })[0];
  }

  // fallback chain of variants
  return resolutionPlusOne ||
    resolutionBestVariant ||
    bandwidthBestVariant ||
    sortedPlaylists[0];
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

/**
 * ranges
 *
 * Utilities for working with TimeRanges.
 *
 */

import videojs from 'video.js';

// Fudge factor to account for TimeRanges rounding
const TIME_FUDGE_FACTOR = 1 / 30;

const filterRanges = function(timeRanges, predicate) {
  let results = [];
  let i;

  if (timeRanges && timeRanges.length) {
    // Search for ranges that match the predicate
    for (i = 0; i < timeRanges.length; i++) {
      if (predicate(timeRanges.start(i), timeRanges.end(i))) {
        results.push([timeRanges.start(i), timeRanges.end(i)]);
      }
    }
  }

  return videojs.createTimeRanges(results);
};

/**
 * Attempts to find the buffered TimeRange that contains the specified
 * time.
 * @param buffered {TimeRanges} the TimeRanges object to query
 * @param time {number} the time to filter on.
 * @return a new TimeRanges object.
 */
const findRange = function(buffered, time) {
  return filterRanges(buffered, function(start, end) {
    return start - TIME_FUDGE_FACTOR <= time &&
      end + TIME_FUDGE_FACTOR >= time;
  });
};

/**
 * Returns the TimeRanges that begin at or later than the specified
 * time.
 * @param timeRanges {TimeRanges} the TimeRanges object to query
 * @param time {number} the time to filter on.
 * @return a new TimeRanges object.
 */
const findNextRange = function(timeRanges, time) {
  return filterRanges(timeRanges, function(start) {
    return start - TIME_FUDGE_FACTOR >= time;
  });
};

/**
 * Search for a likely end time for the segment that was just appened
 * based on the state of the `buffered` property before and after the
 * append. If we fin only one such uncommon end-point return it.
 * @param original {TimeRanges} the buffered time ranges before the update
 * @param update {TimeRanges} the buffered time ranges after the update
 * @return the end time added between `original` and `update`, or
 * null if one cannot be unambiguously determined.
 */
const findSoleUncommonTimeRangesEnd = function(original, update) {
  let i;
  let start;
  let end;
  let result = [];
  let edges = [];

  // In order to qualify as a possible candidate, the end point must:
  //  1) Not have already existed in the `original` ranges
  //  2) Not result from the shrinking of a range that already existed
  //     in the `original` ranges
  //  3) Not be contained inside of a range that existed in `original`
  const overlapsCurrentEnd = function(span) {
    return (span[0] <= end && span[1] >= end);
  };

  if (original) {
    // Save all the edges in the `original` TimeRanges object
    for (i = 0; i < original.length; i++) {
      start = original.start(i);
      end = original.end(i);

      edges.push([start, end]);
    }
  }

  if (update) {
    // Save any end-points in `update` that are not in the `original`
    // TimeRanges object
    for (i = 0; i < update.length; i++) {
      start = update.start(i);
      end = update.end(i);

      if (edges.some(overlapsCurrentEnd)) {
        continue;
      }

      // at this point it must be a unique non-shrinking end edge
      result.push(end);
    }
  }

  // we err on the side of caution and return null if didn't find
  // exactly *one* differing end edge in the search above
  if (result.length !== 1) {
    return null;
  }

  return result[0];
};

export default {
  findRange_: findRange,
  findNextRange_: findNextRange,
  findSoleUncommonTimeRangesEnd_: findSoleUncommonTimeRangesEnd,
  TIME_FUDGE_FACTOR
};

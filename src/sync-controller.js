/**
 * @file sync-controller.js
 */

import mp4probe from 'mux.js/lib/mp4/probe';
import {inspect as tsprobe} from 'mux.js/lib/tools/ts-inspector.js';
import {sumDurations} from './playlist';
import videojs from 'video.js';

const c = 'console';
// temporary, switchable debug logging
const log = function() {
  if (window.logit) {
    window[c].log.apply(window[c], arguments);
  }
};

export const syncPointStrategies = [
  // Stategy "VOD": Handle the VOD-case where the sync-point is *always*
  //                the equivalence display-time 0 === segment-index 0
  {
    name: 'VOD',
    run: (syncController, playlist, duration, currentTimeline) => {
      if (duration !== Infinity) {
        let syncPoint = {
          time: 0,
          segmentIndex: 0
        };

        return syncPoint;
      }
      return null;
    }
  },
  // Stategy "ProgramDateTime": We have a program-date-time tag in this playlist
  {
    name: 'ProgramDateTime',
    run: (syncController, playlist, duration, currentTimeline) => {
      if (syncController.datetimeToDisplayTime && playlist.dateTimeObject) {
        let playlistTime = playlist.dateTimeObject.getTime() / 1000;
        let playlistStart = playlistTime + syncController.datetimeToDisplayTime;
        let syncPoint = {
          time: playlistStart,
          segmentIndex: 0
        };

        return syncPoint;
      }
      return null;
    }
  },
  // Stategy "Segment": We have a known time mapping for a timeline and a
  //                    segment in the current timeline with timing data
  {
    name: 'Segment',
    run: (syncController, playlist, duration, currentTimeline) => {
      let segments = playlist.segments;

      for (let i = segments.length - 1; i >= 0; i--) {
        let segment = segments[i];

        if (segment.timeline === currentTimeline &&
            typeof segment.start !== 'undefined') {
          let syncPoint = {
            time: segment.start,
            segmentIndex: i
          };

          return syncPoint;
        }
      }
      return null;
    }
  },

  // Stategy "Discontinuity": We have a discontinuity with a known
  //                          display-time
  {
    name: 'Discontinuity',
    run: (syncController, playlist, duration, currentTimeline) => {
      if (playlist.discontinuityStarts.length) {
        for (let i = 0; i < playlist.discontinuityStarts.length; i++) {
          let segmentIndex = playlist.discontinuityStarts[i];
          let discontinuity = playlist.discontinuitySequence + i + 1;

          if (syncController.discontinuities[discontinuity]) {
            let syncPoint = {
              time: syncController.discontinuities[discontinuity].time,
              segmentIndex
            };

            return syncPoint;
          }
        }
      }
      return null;
    }
  },
  // Stategy "Playlist": We have a playlist with a known mapping of
  //                     segment index to display time
  {
    name: 'Playlist',
    run: (syncController, playlist, duration, currentTimeline) => {
      if (playlist.syncInfo) {
        let syncPoint = {
          time: playlist.syncInfo.time,
          segmentIndex: playlist.syncInfo.mediaSequence - playlist.mediaSequence
        };

        return syncPoint;
      }
      return null;
    }
  }
];

export default class SyncController extends videojs.EventTarget {
  constructor() {
    super();
    // Segment Loader state variables...
    // ...for synching across variants
    this.inspectCache_ = undefined;

    // ...for synching across variants
    this.timelines = [];
    this.discontinuities = [];
    this.datetimeToDisplayTime = null;
  }

  /**
   * Find a sync-point for the playlist specified
   *
   * A sync-point is defined as a known mapping from display-time to
   * a segment-index in the current playlist.
   *
   * @param {Playlist} media - The playlist that needs a sync-point
   * @param {Number} duration - Duration of the MediaSource (Infinite if playing a live source)
   * @param {Number} currentTimeline - The last timeline from which a segment was loaded
   * @returns {Object} - A sync-point object
   */
  getSyncPoint(playlist, duration, currentTimeline) {
    // Try to find a sync-point in by utilizing various strategies...
    for (let i = 0; i < syncPointStrategies.length; i++) {
      let strategy = syncPointStrategies[i];
      let syncPoint = strategy.run(this, playlist, duration, currentTimeline);

      if (syncPoint) {
        log(`syncPoint found via <${strategy.name}>:`, syncPoint);
        return syncPoint;
      }
    }
    // Otherwise, signal that we need to attempt to get a sync-point
    // manually by fetching a segment in the playlist and constructing
    // a sync-point from that information
    return null;
  }

  /**
   * Save any meta-data present on the segments when segments leave
   * the live window to the playlist to allow for synchronization at the
   * playlist level later.
   *
   * @param {Playlist} oldPlaylist - The previous active playlist
   * @param {Playlist} newPlaylist - The updated and most current playlist
   */
  saveExpiredSegmentInfo(oldPlaylist, newPlaylist) {
    let mediaSequenceDiff = newPlaylist.mediaSequence - oldPlaylist.mediaSequence;

    // When a segment expires from the playlist and it has a start time
    // save that information as a possible sync-point reference in future
    for (let i = mediaSequenceDiff - 1; i >= 0; i--) {
      let lastRemovedSegment = oldPlaylist.segments[i];

      if (typeof lastRemovedSegment.start !== 'undefined') {
        newPlaylist.syncInfo = {
          mediaSequence: oldPlaylist.mediaSequence + i,
          time: lastRemovedSegment.start
        };
        log('playlist sync:', newPlaylist.syncInfo);
        this.trigger('syncinfoupdate');
        break;
      }
    }
  }

  /**
   * Save the mapping from playlist's ProgramDateTime to display. This should
   * only ever happen once at the start of playback.
   *
   * @param {Playlist} playlist - The currently active playlist
   */
  setDateTimeMapping(playlist) {
    if (!this.datetimeToDisplayTime && playlist.dateTimeObject) {
      let playlistTimestamp = playlist.dateTimeObject.getTime() / 1000;

      this.datetimeToDisplayTime = -playlistTimestamp;
    }
  }

  /**
   * Reset the state of the inspection cache when we do a rendition
   * switch
   */
  reset() {
    this.inspectCache_ = undefined;
  }

  /**
   * Probe or inspect a fmp4 or an mpeg2-ts segment to determine the start
   * and end of the segment in it's internal "media time". Used to generate
   * mappings from that internal "media time" to the display time that is
   * shown on the player.
   *
   * @param {SegmentInfo} segmentInfo - The current active request information
   */
  probeSegmentInfo(segmentInfo) {
    let segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
    let timingInfo;

    if (segment.map) {
      timingInfo = this.probeMp4Segment_(segmentInfo);
    } else {
      timingInfo = this.probeTsSegment_(segmentInfo);
    }

    if (timingInfo) {
      if (this.calculateSegmentTimeMapping_(segmentInfo, timingInfo)) {
        this.saveDiscontinuitySyncInfo_(segmentInfo);
      }
    }
  }

  /**
   * Probe an fmp4 or an mpeg2-ts segment to determine the start of the segment
   * in it's internal "media time".
   *
   * @private
   * @param {SegmentInfo} segmentInfo - The current active request information
   * @return {object} The start and end time of the current segment in "media time"
   */
  probeMp4Segment_(segmentInfo) {
    let segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
    let timescales = mp4probe.timescale(segment.map.bytes);
    let startTime = mp4probe.startTime(timescales, segmentInfo.bytes);

    if (segmentInfo.timestampOffset !== null) {
      segmentInfo.timestampOffset -= startTime;
    }

    return {
      start: startTime,
      end: startTime + segment.duration
    };
  }

  /**
   * Probe an mpeg2-ts segment to determine the start and end of the segment
   * in it's internal "media time".
   *
   * @private
   * @param {SegmentInfo} segmentInfo - The current active request information
   * @return {object} The start and end time of the current segment in "media time"
   */
  probeTsSegment_(segmentInfo) {
    let timeInfo = tsprobe(segmentInfo.bytes, this.inspectCache_);
    let segmentStartTime;
    let segmentEndTime;

    if (!timeInfo) {
      return null;
    }

    if (timeInfo.video && timeInfo.video.length === 2) {
      this.inspectCache_ = timeInfo.video[1].dts;
      segmentStartTime = timeInfo.video[0].dtsTime;
      segmentEndTime = timeInfo.video[1].dtsTime;
    } else if (timeInfo.audio && timeInfo.audio.length === 2) {
      this.inspectCache_ = timeInfo.audio[1].dts;
      segmentStartTime = timeInfo.audio[0].dtsTime;
      segmentEndTime = timeInfo.audio[1].dtsTime;
    }

    return {
      start: segmentStartTime,
      end: segmentEndTime
    };
  }

  /**
   * Use the "media time" for a segment to generate a mapping to "display time" and
   * save that display time to the segment.
   *
   * @private
   * @param {SegmentInfo} segmentInfo - The current active request information
   * @param {object} timingInfo - The start and end time of the current segment in "media time"
   */
  calculateSegmentTimeMapping_(segmentInfo, timingInfo) {
    let segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
    let mappingObj = this.timelines[segmentInfo.timeline];

    if (segmentInfo.timestampOffset !== null) {
      log('tsO:', segmentInfo.timestampOffset);

      mappingObj = {
        time: segmentInfo.timestampOffset,
        mapping: segmentInfo.timestampOffset - timingInfo.start
      };
      this.timelines[segmentInfo.timeline] = mappingObj;

      segment.start = segmentInfo.timestampOffset;
      segment.end = timingInfo.end + mappingObj.mapping;
    } else if (mappingObj) {
      segment.start = timingInfo.start + mappingObj.mapping;
      segment.end = timingInfo.end + mappingObj.mapping;
    } else {
      return false;
    }
    this.trigger('syncinfoupdate');
    return true;
  }

  /**
   * Each time we have discontinuity in the playlist, attempt to calculate the location
   * in display of the start of the discontinuity and save that. We also save an accuracy
   * value so that we save values with the most accuracy (closest to 0.)
   *
   * @private
   * @param {SegmentInfo} segmentInfo - The current active request information
   */
  saveDiscontinuitySyncInfo_(segmentInfo) {
    let playlist = segmentInfo.playlist;
    let segment = playlist.segments[segmentInfo.mediaIndex];

    // If the current segment is a discontinuity then we know exactly where
    // the start of the range and it's accuracy is 0 (greater accuracy values
    // mean more approximation)
    if (segment.discontinuity) {
      this.discontinuities[segment.timeline] = {
        time: segment.start,
        accuracy: 0
      };
    } else if (playlist.discontinuityStarts.length) {
      // Search for future discontinuities that we can provide better timing
      // information for and save that information for sync purposes
      for (let i = 0; i < playlist.discontinuityStarts.length; i++) {
        let segmentIndex = playlist.discontinuityStarts[i];
        let discontinuity = playlist.discontinuitySequence + i + 1;
        let accuracy = segmentIndex - segmentInfo.mediaIndex;

        if (accuracy > 0 &&
            (!this.discontinuities[discontinuity] ||
             this.discontinuities[discontinuity].accuracy > accuracy)) {

          this.discontinuities[discontinuity] = {
            time: segment.end + sumDurations(playlist, segmentInfo.mediaIndex + 1, segmentIndex),
            accuracy
          };
        }
      }
    }
  }
}

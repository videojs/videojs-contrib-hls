/**
 * @file segment-loader.js
 */
import {getMediaInfoForTime_ as getMediaInfoForTime} from './playlist';
import videojs from 'video.js';
import SourceUpdater from './source-updater';
import Config from './config';
import window from 'global/window';
import removeCuesFromTrack from 'videojs-contrib-media-sources/es5/remove-cues-from-track.js';
import { initSegmentId } from './bin-utils';
import {mediaSegmentRequest, REQUEST_ERRORS} from './media-segment-request';

// in ms
const CHECK_BUFFER_DELAY = 500;

/**
 * Determines if we should call endOfStream on the media source based
 * on the state of the buffer or if appened segment was the final
 * segment in the playlist.
 *
 * @param {Object} playlist a media playlist object
 * @param {Object} mediaSource the MediaSource object
 * @param {Number} segmentIndex the index of segment we last appended
 * @returns {Boolean} do we need to call endOfStream on the MediaSource
 */
const detectEndOfStream = function(playlist, mediaSource, segmentIndex) {
  if (!playlist || !mediaSource) {
    return false;
  }

  let segments = playlist.segments;

  // determine a few boolean values to help make the branch below easier
  // to read
  let appendedLastSegment = segmentIndex === segments.length;

  // if we've buffered to the end of the video, we need to call endOfStream
  // so that MediaSources can trigger the `ended` event when it runs out of
  // buffered data instead of waiting for me
  return playlist.endList &&
    mediaSource.readyState === 'open' &&
    appendedLastSegment;
};

/**
 * An object that manages segment loading and appending.
 *
 * @class SegmentLoader
 * @param {Object} options required and optional options
 * @extends videojs.EventTarget
 */
export default class SegmentLoader extends videojs.EventTarget {
  constructor(options) {
    super();
    // check pre-conditions
    if (!options) {
      throw new TypeError('Initialization options are required');
    }
    if (typeof options.currentTime !== 'function') {
      throw new TypeError('No currentTime getter specified');
    }
    if (!options.mediaSource) {
      throw new TypeError('No MediaSource specified');
    }
    let settings = videojs.mergeOptions(videojs.options.hls, options);

    // public properties
    this.state = 'INIT';
    this.bandwidth = settings.bandwidth;
    this.throughput = {rate: 0, count: 0};
    this.roundTrip = NaN;
    this.resetStats_();
    this.mediaIndex = null;

    // private settings
    this.hasPlayed_ = settings.hasPlayed;
    this.currentTime_ = settings.currentTime;
    this.seekable_ = settings.seekable;
    this.seeking_ = settings.seeking;
    this.duration_ = settings.duration;
    this.mediaSource_ = settings.mediaSource;
    this.hls_ = settings.hls;
    this.loaderType_ = settings.loaderType;
    this.segmentMetadataTrack_ = settings.segmentMetadataTrack;

    // private instance variables
    this.checkBufferTimeout_ = null;
    this.error_ = void 0;
    this.currentTimeline_ = -1;
    this.pendingSegment_ = null;
    this.mimeType_ = null;
    this.sourceUpdater_ = null;
    this.xhrOptions_ = null;

    // Fragmented mp4 playback
    this.activeInitSegmentId_ = null;
    this.initSegments_ = {};

    this.decrypter_ = settings.decrypter;

    // Manages the tracking and generation of sync-points, mappings
    // between a time in the display time and a segment index within
    // a playlist
    this.syncController_ = settings.syncController;
    this.syncPoint_ = {
      segmentIndex: 0,
      time: 0
    };

    this.syncController_.on('syncinfoupdate', () => this.trigger('syncinfoupdate'));

    // ...for determining the fetch location
    this.fetchAtBuffer_ = false;

    if (settings.debug) {
      this.logger_ = videojs.log.bind(videojs, 'segment-loader', this.loaderType_, '->');
    }
  }

  /**
   * reset all of our media stats
   *
   * @private
   */
  resetStats_() {
    this.mediaBytesTransferred = 0;
    this.mediaRequests = 0;
    this.mediaRequestsAborted = 0;
    this.mediaRequestsTimedout = 0;
    this.mediaRequestsErrored = 0;
    this.mediaTransferDuration = 0;
    this.mediaSecondsLoaded = 0;
  }

  /**
   * dispose of the SegmentLoader and reset to the default state
   */
  dispose() {
    this.state = 'DISPOSED';
    this.abort_();
    if (this.sourceUpdater_) {
      this.sourceUpdater_.dispose();
    }
    this.resetStats_();
  }

  /**
   * abort anything that is currently doing on with the SegmentLoader
   * and reset to a default state
   */
  abort() {
    if (this.state !== 'WAITING') {
      if (this.pendingSegment_) {
        this.pendingSegment_ = null;
      }
      return;
    }

    this.abort_();

    // don't wait for buffer check timeouts to begin fetching the
    // next segment
    if (!this.paused()) {
      this.state = 'READY';
      this.monitorBuffer_();
    }
  }

  /**
   * abort all pending xhr requests and null any pending segements
   *
   * @private
   */
  abort_() {
    if (this.pendingSegment_) {
      this.pendingSegment_.abortRequests();
    }

    // clear out the segment being processed
    this.pendingSegment_ = null;
  }

  /**
   * set an error on the segment loader and null out any pending segements
   *
   * @param {Error} error the error to set on the SegmentLoader
   * @return {Error} the error that was set or that is currently set
   */
  error(error) {
    if (typeof error !== 'undefined') {
      this.error_ = error;
    }

    this.pendingSegment_ = null;
    return this.error_;
  }

  /**
   * Indicates which time ranges are buffered
   *
   * @return {TimeRange}
   *         TimeRange object representing the current buffered ranges
   */
  buffered_() {
    if (!this.sourceUpdater_) {
      return videojs.createTimeRanges();
    }

    return this.sourceUpdater_.buffered();
  }

  /**
   * Gets and sets init segment for the provided map
   *
   * @param {Object} map
   *        The map object representing the init segment to get or set
   * @param {Boolean=} set
   *        If true, the init segment for the provided map should be saved
   * @return {Object}
   *         map object for desired init segment
   */
  initSegment(map, set = false) {
    if (!map) {
      return null;
    }

    const id = initSegmentId(map);
    let storedMap = this.initSegments_[id];

    if (set && !storedMap && map.bytes) {
      this.initSegments_[id] = storedMap = {
        resolvedUri: map.resolvedUri,
        byterange: map.byterange,
        bytes: map.bytes
      };
    }

    return storedMap || map;
  }

  /**
   * Returns true if all configuration required for loading is present, otherwise false.
   *
   * @return {Boolean} True if the all configuration is ready for loading
   * @private
   */
  couldBeginLoading_() {
    return this.playlist_ &&
           // the source updater is created when init_ is called, so either having a
           // source updater or being in the INIT state with a mimeType is enough
           // to say we have all the needed configuration to start loading.
           (this.sourceUpdater_ || (this.mimeType_ && this.state === 'INIT')) &&
           !this.paused();
  }

  /**
   * load a playlist and start to fill the buffer
   */
  load() {
    // un-pause
    this.monitorBuffer_();

    // if we don't have a playlist yet, keep waiting for one to be
    // specified
    if (!this.playlist_) {
      return;
    }

    // not sure if this is the best place for this
    this.syncController_.setDateTimeMapping(this.playlist_);

    // if all the configuration is ready, initialize and begin loading
    if (this.state === 'INIT' && this.couldBeginLoading_()) {
      return this.init_();
    }

    // if we're in the middle of processing a segment already, don't
    // kick off an additional segment request
    if (!this.couldBeginLoading_() ||
        (this.state !== 'READY' &&
        this.state !== 'INIT')) {
      return;
    }

    this.state = 'READY';
  }

  /**
   * Once all the starting parameters have been specified, begin
   * operation. This method should only be invoked from the INIT
   * state.
   *
   * @private
   */
  init_() {
    this.state = 'READY';
    this.sourceUpdater_ = new SourceUpdater(this.mediaSource_, this.mimeType_);
    this.resetEverything();
    return this.monitorBuffer_();
  }

  /**
   * set a playlist on the segment loader
   *
   * @param {PlaylistLoader} media the playlist to set on the segment loader
   */
  playlist(newPlaylist, options = {}) {
    if (!newPlaylist) {
      return;
    }

    let oldPlaylist = this.playlist_;
    let segmentInfo = this.pendingSegment_;

    this.playlist_ = newPlaylist;
    this.xhrOptions_ = options;

    // when we haven't started playing yet, the start of a live playlist
    // is always our zero-time so force a sync update each time the playlist
    // is refreshed from the server
    if (!this.hasPlayed_()) {
      newPlaylist.syncInfo = {
        mediaSequence: newPlaylist.mediaSequence,
        time: 0
      };
    }

    // in VOD, this is always a rendition switch (or we updated our syncInfo above)
    // in LIVE, we always want to update with new playlists (including refreshes)
    this.trigger('syncinfoupdate');

    // if we were unpaused but waiting for a playlist, start
    // buffering now
    if (this.state === 'INIT' && this.couldBeginLoading_()) {
      return this.init_();
    }

    if (!oldPlaylist || oldPlaylist.uri !== newPlaylist.uri) {
      if (this.mediaIndex !== null) {
        // we must "resync" the segment loader when we switch renditions and
        // the segment loader is already synced to the previous rendition
        this.resyncLoader();
      }

      // the rest of this function depends on `oldPlaylist` being defined
      return;
    }

    // we reloaded the same playlist so we are in a live scenario
    // and we will likely need to adjust the mediaIndex
    let mediaSequenceDiff = newPlaylist.mediaSequence - oldPlaylist.mediaSequence;

    this.logger_('mediaSequenceDiff', mediaSequenceDiff);

    // update the mediaIndex on the SegmentLoader
    // this is important because we can abort a request and this value must be
    // equal to the last appended mediaIndex
    if (this.mediaIndex !== null) {
      this.mediaIndex -= mediaSequenceDiff;
    }

    // update the mediaIndex on the SegmentInfo object
    // this is important because we will update this.mediaIndex with this value
    // in `handleUpdateEnd_` after the segment has been successfully appended
    if (segmentInfo) {
      segmentInfo.mediaIndex -= mediaSequenceDiff;

      // we need to update the referenced segment so that timing information is
      // saved for the new playlist's segment, however, if the segment fell off the
      // playlist, we can leave the old reference and just lose the timing info
      if (segmentInfo.mediaIndex >= 0) {
        segmentInfo.segment = newPlaylist.segments[segmentInfo.mediaIndex];
      }
    }

    this.syncController_.saveExpiredSegmentInfo(oldPlaylist, newPlaylist);
  }

  /**
   * Prevent the loader from fetching additional segments. If there
   * is a segment request outstanding, it will finish processing
   * before the loader halts. A segment loader can be unpaused by
   * calling load().
   */
  pause() {
    if (this.checkBufferTimeout_) {
      window.clearTimeout(this.checkBufferTimeout_);

      this.checkBufferTimeout_ = null;
    }
  }

  /**
   * Returns whether the segment loader is fetching additional
   * segments when given the opportunity. This property can be
   * modified through calls to pause() and load().
   */
  paused() {
    return this.checkBufferTimeout_ === null;
  }

  /**
   * create/set the following mimetype on the SourceBuffer through a
   * SourceUpdater
   *
   * @param {String} mimeType the mime type string to use
   */
  mimeType(mimeType) {
    if (this.mimeType_) {
      return;
    }

    this.mimeType_ = mimeType;
    // if we were unpaused but waiting for a sourceUpdater, start
    // buffering now
    if (this.state === 'INIT' && this.couldBeginLoading_()) {
      this.init_();
    }
  }

  /**
   * Delete all the buffered data and reset the SegmentLoader
   */
  resetEverything() {
    this.resetLoader();
    this.remove(0, Infinity);
  }

  /**
   * Force the SegmentLoader to resync and start loading around the currentTime instead
   * of starting at the end of the buffer
   *
   * Useful for fast quality changes
   */
  resetLoader() {
    this.fetchAtBuffer_ = false;
    this.resyncLoader();
  }

  /**
   * Force the SegmentLoader to restart synchronization and make a conservative guess
   * before returning to the simple walk-forward method
   */
  resyncLoader() {
    this.mediaIndex = null;
    this.syncPoint_ = null;
  }

  /**
   * Remove any data in the source buffer between start and end times
   * @param {Number} start - the start time of the region to remove from the buffer
   * @param {Number} end - the end time of the region to remove from the buffer
   */
  remove(start, end) {
    if (this.sourceUpdater_) {
      this.sourceUpdater_.remove(start, end);
    }
    removeCuesFromTrack(start, end, this.segmentMetadataTrack_);
  }

  /**
   * (re-)schedule monitorBufferTick_ to run as soon as possible
   *
   * @private
   */
  monitorBuffer_() {
    if (this.checkBufferTimeout_) {
      window.clearTimeout(this.checkBufferTimeout_);
    }

    this.checkBufferTimeout_ = window.setTimeout(this.monitorBufferTick_.bind(this), 1);
  }

  /**
   * As long as the SegmentLoader is in the READY state, periodically
   * invoke fillBuffer_().
   *
   * @private
   */
  monitorBufferTick_() {
    if (this.state === 'READY') {
      this.fillBuffer_();
    }

    if (this.checkBufferTimeout_) {
      window.clearTimeout(this.checkBufferTimeout_);
    }

    this.checkBufferTimeout_ = window.setTimeout(this.monitorBufferTick_.bind(this),
                                                 CHECK_BUFFER_DELAY);
  }

  /**
   * fill the buffer with segements unless the sourceBuffers are
   * currently updating
   *
   * Note: this function should only ever be called by monitorBuffer_
   * and never directly
   *
   * @private
   */
  fillBuffer_() {
    if (this.sourceUpdater_.updating()) {
      return;
    }

    if (!this.syncPoint_) {
      this.syncPoint_ = this.syncController_.getSyncPoint(this.playlist_,
                                                          this.duration_(),
                                                          this.currentTimeline_,
                                                          this.currentTime_());
    }

    // see if we need to begin loading immediately
    let segmentInfo = this.checkBuffer_(this.buffered_(),
                                        this.playlist_,
                                        this.mediaIndex,
                                        this.hasPlayed_(),
                                        this.currentTime_(),
                                        this.syncPoint_);

    if (!segmentInfo) {
      return;
    }

    let isEndOfStream = detectEndOfStream(this.playlist_,
                                          this.mediaSource_,
                                          segmentInfo.mediaIndex);

    if (isEndOfStream) {
      this.mediaSource_.endOfStream();
      return;
    }

    if (segmentInfo.mediaIndex === this.playlist_.segments.length - 1 &&
        this.mediaSource_.readyState === 'ended' &&
        !this.seeking_()) {
      return;
    }

    // We will need to change timestampOffset of the sourceBuffer if either of
    // the following conditions are true:
    // - The segment.timeline !== this.currentTimeline
    //   (we are crossing a discontinuity somehow)
    // - The "timestampOffset" for the start of this segment is less than
    //   the currently set timestampOffset
    if (segmentInfo.timeline !== this.currentTimeline_ ||
        ((segmentInfo.startOfSegment !== null) &&
        segmentInfo.startOfSegment < this.sourceUpdater_.timestampOffset())) {
      this.syncController_.reset();
      segmentInfo.timestampOffset = segmentInfo.startOfSegment;
    }

    this.loadSegment_(segmentInfo);
  }

  /**
   * Determines what segment request should be made, given current playback
   * state.
   *
   * @param {TimeRanges} buffered - the state of the buffer
   * @param {Object} playlist - the playlist object to fetch segments from
   * @param {Number} mediaIndex - the previous mediaIndex fetched or null
   * @param {Boolean} hasPlayed - a flag indicating whether we have played or not
   * @param {Number} currentTime - the playback position in seconds
   * @param {Object} syncPoint - a segment info object that describes the
   * @returns {Object} a segment request object that describes the segment to load
   */
  checkBuffer_(buffered, playlist, mediaIndex, hasPlayed, currentTime, syncPoint) {
    let lastBufferedEnd = 0;
    let startOfSegment;

    if (buffered.length) {
      lastBufferedEnd = buffered.end(buffered.length - 1);
    }

    let bufferedTime = Math.max(0, lastBufferedEnd - currentTime);

    if (!playlist.segments.length) {
      return null;
    }

    // if there is plenty of content buffered, and the video has
    // been played before relax for awhile
    if (bufferedTime >= Config.GOAL_BUFFER_LENGTH) {
      return null;
    }

    // if the video has not yet played once, and we already have
    // one segment downloaded do nothing
    if (!hasPlayed && bufferedTime >= 1) {
      return null;
    }

    this.logger_('checkBuffer_',
      'mediaIndex:', mediaIndex,
      'hasPlayed:', hasPlayed,
      'currentTime:', currentTime,
      'syncPoint:', syncPoint,
      'fetchAtBuffer:', this.fetchAtBuffer_,
      'bufferedTime:', bufferedTime);

    // When the syncPoint is null, there is no way of determining a good
    // conservative segment index to fetch from
    // The best thing to do here is to get the kind of sync-point data by
    // making a request
    if (syncPoint === null) {
      mediaIndex = this.getSyncSegmentCandidate_(playlist);
      this.logger_('getSync', 'mediaIndex:', mediaIndex);
      return this.generateSegmentInfo_(playlist, mediaIndex, null, true);
    }

    // Under normal playback conditions fetching is a simple walk forward
    if (mediaIndex !== null) {
      this.logger_('walkForward', 'mediaIndex:', mediaIndex + 1);
      let segment = playlist.segments[mediaIndex];

      if (segment && segment.end) {
        startOfSegment = segment.end;
      } else {
        startOfSegment = lastBufferedEnd;
      }
      return this.generateSegmentInfo_(playlist, mediaIndex + 1, startOfSegment, false);
    }

    // There is a sync-point but the lack of a mediaIndex indicates that
    // we need to make a good conservative guess about which segment to
    // fetch
    if (this.fetchAtBuffer_) {
      // Find the segment containing the end of the buffer
      let mediaSourceInfo = getMediaInfoForTime(playlist,
                                                lastBufferedEnd,
                                                syncPoint.segmentIndex,
                                                syncPoint.time);

      mediaIndex = mediaSourceInfo.mediaIndex;
      startOfSegment = mediaSourceInfo.startTime;
    } else {
      // Find the segment containing currentTime
      let mediaSourceInfo = getMediaInfoForTime(playlist,
                                                currentTime,
                                                syncPoint.segmentIndex,
                                                syncPoint.time);

      mediaIndex = mediaSourceInfo.mediaIndex;
      startOfSegment = mediaSourceInfo.startTime;
    }
    this.logger_('getMediaIndexForTime',
      'mediaIndex:', mediaIndex,
      'startOfSegment:', startOfSegment);

    return this.generateSegmentInfo_(playlist, mediaIndex, startOfSegment, false);
  }

  /**
   * The segment loader has no recourse except to fetch a segment in the
   * current playlist and use the internal timestamps in that segment to
   * generate a syncPoint. This function returns a good candidate index
   * for that process.
   *
   * @param {Object} playlist - the playlist object to look for a
   * @returns {Number} An index of a segment from the playlist to load
   */
  getSyncSegmentCandidate_(playlist) {
    if (this.currentTimeline_ === -1) {
      return 0;
    }

    let segmentIndexArray = playlist.segments
      .map((s, i) => {
        return {
          timeline: s.timeline,
          segmentIndex: i
        };
      }).filter(s => s.timeline === this.currentTimeline_);

    if (segmentIndexArray.length) {
      return segmentIndexArray[Math.min(segmentIndexArray.length - 1, 1)].segmentIndex;
    }

    return Math.max(playlist.segments.length - 1, 0);
  }

  generateSegmentInfo_(playlist, mediaIndex, startOfSegment, isSyncRequest) {
    if (mediaIndex < 0 || mediaIndex >= playlist.segments.length) {
      return null;
    }

    let segment = playlist.segments[mediaIndex];

    return {
      requestId: 'segment-loader-' + Math.random(),
      // resolve the segment URL relative to the playlist
      uri: segment.resolvedUri,
      // the segment's mediaIndex at the time it was requested
      mediaIndex,
      // whether or not to update the SegmentLoader's state with this
      // segment's mediaIndex
      isSyncRequest,
      startOfSegment,
      // the segment's playlist
      playlist,
      // unencrypted bytes of the segment
      bytes: null,
      // when a key is defined for this segment, the encrypted bytes
      encryptedBytes: null,
      // The target timestampOffset for this segment when we append it
      // to the source buffer
      timestampOffset: null,
      // The timeline that the segment is in
      timeline: segment.timeline,
      // The expected duration of the segment in seconds
      duration: segment.duration,
      // retain the segment in case the playlist updates while doing an async process
      segment
    };
  }

  /**
   * load a specific segment from a request into the buffer
   *
   * @private
   */
  loadSegment_(segmentInfo) {
    this.state = 'WAITING';
    this.pendingSegment_ = segmentInfo;
    this.trimBackBuffer_(segmentInfo);

    segmentInfo.abortRequests = mediaSegmentRequest(this.hls_.xhr,
      this.xhrOptions_,
      this.decrypter_,
      this.createSimplifiedSegmentObj_(segmentInfo),
      // progress callback
      (event, segment) => {
        if (!this.pendingSegment_ || segment.requestId !== this.pendingSegment_.requestId) {
          return;
        }
        // TODO: Use progress-based bandwidth to early abort low-bandwidth situations
        this.trigger('progress');
      },
      this.segmentRequestFinished_.bind(this));
  }

  /**
   * trim the back buffer so that we don't have too much data
   * in the source buffer
   *
   * @private
   *
   * @param {Object} segmentInfo - the current segment
   */
  trimBackBuffer_(segmentInfo) {
    const seekable = this.seekable_();
    const currentTime = this.currentTime_();
    let removeToTime = 0;

    // Chrome has a hard limit of 150mb of
    // buffer and a very conservative "garbage collector"
    // We manually clear out the old buffer to ensure
    // we don't trigger the QuotaExceeded error
    // on the source buffer during subsequent appends

    // If we have a seekable range use that as the limit for what can be removed safely
    // otherwise remove anything older than 1 minute before the current play head
    if (seekable.length &&
        seekable.start(0) > 0 &&
        seekable.start(0) < currentTime) {
      removeToTime = seekable.start(0);
    } else {
      removeToTime = currentTime - 60;
    }

    if (removeToTime > 0) {
      this.remove(0, removeToTime);
    }
  }

  /**
   * created a simplified copy of the segment object with just the
   * information necessary to perform the XHR and decryption
   *
   * @private
   *
   * @param {Object} segmentInfo - the current segment
   * @returns {Object} a simplified segment object copy
   */
  createSimplifiedSegmentObj_(segmentInfo) {
    const segment = segmentInfo.segment;
    const simpleSegment = {
      resolvedUri: segment.resolvedUri,
      byterange: segment.byterange,
      requestId: segmentInfo.requestId
    };

    if (segment.key) {
      // if the media sequence is greater than 2^32, the IV will be incorrect
      // assuming 10s segments, that would be about 1300 years
      const iv = segment.key.iv || new Uint32Array([
        0, 0, 0, segmentInfo.mediaIndex + segmentInfo.playlist.mediaSequence
      ]);

      simpleSegment.key = {
        resolvedUri: segment.key.resolvedUri,
        iv
      };
    }

    if (segment.map) {
      simpleSegment.map = this.initSegment(segment.map);
    }

    return simpleSegment;
  }

  /**
   * Handle the callback from the segmentRequest function and set the
   * associated SegmentLoader state and errors if necessary
   *
   * @private
   */
  segmentRequestFinished_(error, simpleSegment) {
    // every request counts as a media request even if it has been aborted
    // or canceled due to a timeout
    this.mediaRequests += 1;

    if (simpleSegment.stats) {
      this.mediaBytesTransferred += simpleSegment.stats.bytesReceived;
      this.mediaTransferDuration += simpleSegment.stats.roundTripTime;
    }

    // The request was aborted and the SegmentLoader has already been reset
    if (!this.pendingSegment_) {
      this.mediaRequestsAborted += 1;
      return;
    }

    // the request was aborted and the SegmentLoader has already started
    // another request. this can happen when the timeout for an aborted
    // request triggers due to a limitation in the XHR library
    // do not count this as any sort of request or we risk double-counting
    if (simpleSegment.requestId !== this.pendingSegment_.requestId) {
      return;
    }

    // an error occurred from the active pendingSegment_ so reset everything
    if (error) {
      this.pendingSegment_ = null;

      // the requests were aborted just record the aborted stat and exit
      // this is not a true error condition and nothing corrective needs
      // to be done
      if (error.code === REQUEST_ERRORS.ABORTED) {
        this.mediaRequestsAborted += 1;
        return;
      }

      this.state = 'READY';
      this.pause();

      // the error is really just that at least one of the requests timed-out
      // set the bandwidth to a very low value and trigger an ABR switch to
      // take emergency action
      if (error.code === REQUEST_ERRORS.TIMEOUT) {
        this.mediaRequestsTimedout += 1;
        this.bandwidth = 1;
        this.roundTrip = NaN;
        this.trigger('bandwidthupdate');
        return;
      }

      // if control-flow has arrived here, then the error is real
      // emit an error event to blacklist the current playlist
      this.mediaRequestsErrored += 1;
      this.error(error);
      this.trigger('error');
      return;
    }

    // the response was a success so set any bandwidth stats the request
    // generated for ABR purposes
    this.bandwidth = simpleSegment.stats.bandwidth;
    this.roundTrip = simpleSegment.stats.roundTripTime;

    // if this request included an initialization segment, save that data
    // to the initSegment cache
    if (simpleSegment.map) {
      simpleSegment.map = this.initSegment(simpleSegment.map, true);
    }

    this.processSegmentResponse_(simpleSegment);
  }

  /**
   * Move any important data from the simplified segment object
   * back to the real segment object for future phases
   *
   * @private
   */
  processSegmentResponse_(simpleSegment) {
    const segmentInfo = this.pendingSegment_;

    segmentInfo.bytes = simpleSegment.bytes;
    if (simpleSegment.map) {
      segmentInfo.segment.map.bytes = simpleSegment.map.bytes;
    }

    segmentInfo.endOfAllRequests = simpleSegment.endOfAllRequests;
    this.handleSegment_();
  }

  /**
   * append a decrypted segement to the SourceBuffer through a SourceUpdater
   *
   * @private
   */
  handleSegment_() {
    if (!this.pendingSegment_) {
      this.state = 'READY';
      return;
    }

    this.state = 'APPENDING';

    const segmentInfo = this.pendingSegment_;
    const segment = segmentInfo.segment;

    this.syncController_.probeSegmentInfo(segmentInfo);

    if (segmentInfo.isSyncRequest) {
      this.trigger('syncinfoupdate');
      this.pendingSegment_ = null;
      this.state = 'READY';
      return;
    }

    if (segmentInfo.timestampOffset !== null &&
        segmentInfo.timestampOffset !== this.sourceUpdater_.timestampOffset()) {
      this.sourceUpdater_.timestampOffset(segmentInfo.timestampOffset);
    }

    // if the media initialization segment is changing, append it
    // before the content segment
    if (segment.map) {
      const initId = initSegmentId(segment.map);

      if (!this.activeInitSegmentId_ ||
          this.activeInitSegmentId_ !== initId) {
        const initSegment = this.initSegment(segment.map);

        this.sourceUpdater_.appendBuffer(initSegment.bytes, () => {
          this.activeInitSegmentId_ = initId;
        });
      }
    }

    segmentInfo.byteLength = segmentInfo.bytes.byteLength;
    if (typeof segment.start === 'number' && typeof segment.end === 'number') {
      this.mediaSecondsLoaded += segment.end - segment.start;
    } else {
      this.mediaSecondsLoaded += segment.duration;
    }

    this.sourceUpdater_.appendBuffer(segmentInfo.bytes,
                                     this.handleUpdateEnd_.bind(this));
  }

  /**
   * callback to run when appendBuffer is finished. detects if we are
   * in a good state to do things with the data we got, or if we need
   * to wait for more
   *
   * @private
   */
  handleUpdateEnd_() {
    this.logger_('handleUpdateEnd_', 'segmentInfo:', this.pendingSegment_);

    if (!this.pendingSegment_) {
      this.state = 'READY';
      if (!this.paused()) {
        this.monitorBuffer_();
      }
      return;
    }

    const segmentInfo = this.pendingSegment_;
    const segment = segmentInfo.segment;
    const isWalkingForward = this.mediaIndex !== null;

    this.pendingSegment_ = null;
    this.recordThroughput_(segmentInfo);
    this.addSegmentMetadataCue_(segmentInfo);

    this.state = 'READY';

    this.mediaIndex = segmentInfo.mediaIndex;
    this.fetchAtBuffer_ = true;
    this.currentTimeline_ = segmentInfo.timeline;

    // We must update the syncinfo to recalculate the seekable range before
    // the following conditional otherwise it may consider this a bad "guess"
    // and attempt to resync when the post-update seekable window and live
    // point would mean that this was the perfect segment to fetch
    this.trigger('syncinfoupdate');

    // If we previously appended a segment that ends more than 3 targetDurations before
    // the currentTime_ that means that our conservative guess was too conservative.
    // In that case, reset the loader state so that we try to use any information gained
    // from the previous request to create a new, more accurate, sync-point.
    if (segment.end &&
        this.currentTime_() - segment.end > segmentInfo.playlist.targetDuration * 3) {
      this.resetEverything();
      return;
    }

    // Don't do a rendition switch unless we have enough time to get a sync segment
    // and conservatively guess
    if (isWalkingForward) {
      this.trigger('bandwidthupdate');
    }
    this.trigger('progress');

    // any time an update finishes and the last segment is in the
    // buffer, end the stream. this ensures the "ended" event will
    // fire if playback reaches that point.
    const isEndOfStream = detectEndOfStream(segmentInfo.playlist,
                                            this.mediaSource_,
                                            segmentInfo.mediaIndex + 1);

    if (isEndOfStream) {
      this.mediaSource_.endOfStream();
    }

    if (!this.paused()) {
      this.monitorBuffer_();
    }
  }

  /**
   * Records the current throughput of the decrypt, transmux, and append
   * portion of the semgment pipeline. `throughput.rate` is a the cumulative
   * moving average of the throughput. `throughput.count` is the number of
   * data points in the average.
   *
   * @private
   * @param {Object} segmentInfo the object returned by loadSegment
   */
  recordThroughput_(segmentInfo) {
    const rate = this.throughput.rate;
    // Add one to the time to ensure that we don't accidentally attempt to divide
    // by zero in the case where the throughput is ridiculously high
    const segmentProcessingTime =
      Date.now() - segmentInfo.endOfAllRequests + 1;
    // Multiply by 8000 to convert from bytes/millisecond to bits/second
    const segmentProcessingThroughput =
      Math.floor((segmentInfo.byteLength / segmentProcessingTime) * 8 * 1000);

    // This is just a cumulative moving average calculation:
    //   newAvg = oldAvg + (sample - oldAvg) / (sampleCount + 1)
    this.throughput.rate +=
      (segmentProcessingThroughput - rate) / (++this.throughput.count);
  }

  /**
   * A debugging logger noop that is set to console.log only if debugging
   * is enabled globally
   *
   * @private
   */
  logger_() {}

  /**
   * Adds a cue to the segment-metadata track with some metadata information about the
   * segment
   *
   * @private
   * @param {Object} segmentInfo
   *        the object returned by loadSegment
   * @method addSegmentMetadataCue_
   */
  addSegmentMetadataCue_(segmentInfo) {
    if (!this.segmentMetadataTrack_) {
      return;
    }

    const segment = segmentInfo.segment;
    const start = segment.start;
    const end = segment.end;

    removeCuesFromTrack(start, end, this.segmentMetadataTrack_);

    const Cue = window.WebKitDataCue || window.VTTCue;
    const value = {
      uri: segmentInfo.uri,
      timeline: segmentInfo.timeline,
      playlist: segmentInfo.playlist.uri,
      start,
      end
    };
    const data = JSON.stringify(value);
    const cue = new Cue(start, end, data);

    // Attach the metadata to the value property of the cue to keep consistency between
    // the differences of WebKitDataCue in safari and VTTCue in other browsers
    cue.value = value;

    this.segmentMetadataTrack_.addCue(cue);
  }
}

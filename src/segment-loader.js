/**
 * @file segment-loader.js
 */
import Ranges from './ranges';
import {getMediaIndexForTime_ as getMediaIndexForTime, duration} from './playlist';
import videojs from 'video.js';
import SourceUpdater from './source-updater';
import {Decrypter} from 'aes-decrypter';
import Config from './config';
import window from 'global/window';

// in ms
const CHECK_BUFFER_DELAY = 500;

/**
 * Updates segment with information about its end-point in time and, optionally,
 * the segment duration if we have enough information to determine a segment duration
 * accurately.
 *
 * @param {Object} playlist a media playlist object
 * @param {Number} segmentIndex the index of segment we last appended
 * @param {Number} segmentEnd the known of the segment referenced by segmentIndex
 */
const updateSegmentMetadata = function(playlist, segmentIndex, segmentEnd) {
  if (!playlist) {
    return false;
  }

  let segment = playlist.segments[segmentIndex];
  let previousSegment = playlist.segments[segmentIndex - 1];

  if (segmentEnd && segment) {
    segment.end = segmentEnd;

    // fix up segment durations based on segment end data
    if (!previousSegment) {
      // first segment is always has a start time of 0 making its duration
      // equal to the segment end
      segment.duration = segment.end;
    } else if (previousSegment.end) {
      segment.duration = segment.end - previousSegment.end;
    }
    return true;
  }
  return false;
};

/**
 * Determines if we should call endOfStream on the media source based
 * on the state of the buffer or if appened segment was the final
 * segment in the playlist.
 *
 * @param {Object} playlist a media playlist object
 * @param {Object} mediaSource the MediaSource object
 * @param {Number} segmentIndex the index of segment we last appended
 * @param {Object} currentBuffered buffered region that currentTime resides in
 * @returns {Boolean} do we need to call endOfStream on the MediaSource
 */
const detectEndOfStream = function(playlist, mediaSource, segmentIndex, currentBuffered) {
  if (!playlist) {
    return false;
  }

  let segments = playlist.segments;

  // determine a few boolean values to help make the branch below easier
  // to read
  let appendedLastSegment = (segmentIndex === segments.length - 1);
  let bufferedToEnd = (currentBuffered.length &&
    segments[segments.length - 1].end <= currentBuffered.end(0));

  // if we've buffered to the end of the video, we need to call endOfStream
  // so that MediaSources can trigger the `ended` event when it runs out of
  // buffered data instead of waiting for me
  return playlist.endList &&
    mediaSource.readyState === 'open' &&
    (appendedLastSegment || bufferedToEnd);
};

/**
 * Turns segment byterange into a string suitable for use in
 * HTTP Range requests
 */
const byterangeStr = function(byterange) {
  let byterangeStart;
  let byterangeEnd;

  // `byterangeEnd` is one less than `offset + length` because the HTTP range
  // header uses inclusive ranges
  byterangeEnd = byterange.offset + byterange.length - 1;
  byterangeStart = byterange.offset;
  return 'bytes=' + byterangeStart + '-' + byterangeEnd;
};

/**
 * Defines headers for use in the xhr request for a particular segment.
 */
const segmentXhrHeaders = function(segment) {
  let headers = {};

  if ('byterange' in segment) {
    headers.Range = byterangeStr(segment.byterange);
  }
  return headers;
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
    let settings;

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
    settings = videojs.mergeOptions(videojs.options.hls, options);

    // public properties
    this.state = 'INIT';
    this.bandwidth = settings.bandwidth;
    this.roundTrip = NaN;
    this.resetStats_();

    // private properties
    this.hasPlayed_ = settings.hasPlayed;
    this.currentTime_ = settings.currentTime;
    this.seekable_ = settings.seekable;
    this.seeking_ = settings.seeking;
    this.setCurrentTime_ = settings.setCurrentTime;
    this.mediaSource_ = settings.mediaSource;
    this.checkBufferTimeout_ = null;
    this.error_ = void 0;
    this.expired_ = 0;
    this.timeCorrection_ = 0;
    this.currentTimeline_ = -1;
    this.xhr_ = null;
    this.pendingSegment_ = null;
    this.sourceUpdater_ = null;
    this.hls_ = settings.hls;
    this.xhrOptions_ = null;
  }

  /**
   * reset all of our media stats
   *
   * @private
   */
  resetStats_() {
    this.mediaBytesTransferred = 0;
    this.mediaRequests = 0;
    this.mediaTransferDuration = 0;
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
      return;
    }

    this.abort_();

    // don't wait for buffer check timeouts to begin fetching the
    // next segment
    if (!this.paused()) {
      this.state = 'READY';
      this.fillBuffer_();
    }
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
   * load a playlist and start to fill the buffer
   */
  load() {
    this.monitorBuffer_();

    // if we don't have a playlist yet, keep waiting for one to be
    // specified
    if (!this.playlist_) {
      return;
    }

    // if we're in the middle of processing a segment already, don't
    // kick off an additional segment request
    if (!this.sourceUpdater_ ||
        (this.state !== 'READY' &&
        this.state !== 'INIT')) {
      return;
    }

    this.state = 'READY';
    this.fillBuffer_();
  }

  /**
   * set a playlist on the segment loader
   *
   * @param {PlaylistLoader} media the playlist to set on the segment loader
   */
  playlist(media, options = {}) {
    this.playlist_ = media;
    this.xhrOptions_ = options;

    // if we were unpaused but waiting for a playlist, start
    // buffering now
    if (this.sourceUpdater_ &&
        media &&
        this.state === 'INIT' &&
        !this.paused()) {
      this.state = 'READY';
      return this.fillBuffer_();
    }
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
   * setter for expired time on the SegmentLoader
   *
   * @param {Number} expired the exired time to set
   */
  expired(expired) {
    this.expired_ = expired;
  }

  /**
   * create/set the following mimetype on the SourceBuffer through a
   * SourceUpdater
   *
   * @param {String} mimeType the mime type string to use
   */
  mimeType(mimeType) {
    // TODO Allow source buffers to be re-created with different mime-types
    if (!this.sourceUpdater_) {
      this.sourceUpdater_ = new SourceUpdater(this.mediaSource_, mimeType);
      this.clearBuffer();

      // if we were unpaused but waiting for a sourceUpdater, start
      // buffering now
      if (this.playlist_ &&
          this.state === 'INIT' &&
          !this.paused()) {
        this.state = 'READY';
        return this.fillBuffer_();
      }
    }
  }

  /**
   * asynchronously/recursively monitor the buffer
   *
   * @private
   */
  monitorBuffer_() {
    if (this.state === 'READY') {
      this.fillBuffer_();
    }

    if (this.checkBufferTimeout_) {
      window.clearTimeout(this.checkBufferTimeout_);
    }

    this.checkBufferTimeout_ = window.setTimeout(this.monitorBuffer_.bind(this),
                                                 CHECK_BUFFER_DELAY);
  }

  /**
   * Determines what segment request should be made, given current
   * playback state.
   *
   * @param {TimeRanges} buffered - the state of the buffer
   * @param {Object} playlist - the playlist object to fetch segments from
   * @param {Number} currentTime - the playback position in seconds
   * @returns {Object} a segment info object that describes the
   * request that should be made or null if no request is necessary
   */
  checkBuffer_(buffered, playlist, currentTime) {
    let currentBuffered = Ranges.findRange(buffered, currentTime);

    // There are times when MSE reports the first segment as starting a
    // little after 0-time so add a fudge factor to try and fix those cases
    // or we end up fetching the same first segment over and over
    if (currentBuffered.length === 0 && currentTime === 0) {
      currentBuffered = Ranges.findRange(buffered,
                                         currentTime + Ranges.TIME_FUDGE_FACTOR);
    }

    let bufferedTime;
    let currentBufferedEnd;
    let timestampOffset = this.sourceUpdater_.timestampOffset();
    let segment;
    let mediaIndex;

    if (!playlist.segments.length) {
      return;
    }

    if (currentBuffered.length === 0) {
      // find the segment containing currentTime
      mediaIndex = getMediaIndexForTime(playlist,
                                        currentTime + this.timeCorrection_,
                                        this.expired_);
    } else {
      // find the segment adjacent to the end of the current
      // buffered region
      currentBufferedEnd = currentBuffered.end(0);
      bufferedTime = Math.max(0, currentBufferedEnd - currentTime);

      // if the video has not yet played only, and we already have
      // one segment downloaded do nothing
      if (!this.hasPlayed_() && bufferedTime >= 1) {
        return null;
      }

      // if there is plenty of content buffered, and the video has
      // been played before relax for awhile
      if (this.hasPlayed_() && bufferedTime >= Config.GOAL_BUFFER_LENGTH) {
        return null;
      }
      mediaIndex = getMediaIndexForTime(playlist,
                                        currentBufferedEnd + this.timeCorrection_,
                                        this.expired_);
    }

    if (mediaIndex < 0 || mediaIndex === playlist.segments.length) {
      return null;
    }

    segment = playlist.segments[mediaIndex];
    let startOfSegment = duration(playlist,
                                  playlist.mediaSequence + mediaIndex,
                                  this.expired_);

    // We will need to change timestampOffset of the sourceBuffer if either of
    // the following conditions are true:
    // - The segment.timeline !== this.currentTimeline
    //   (we are crossing a discontinuity somehow)
    // - The "timestampOffset" for the start of this segment is less than
    //   the currently set timestampOffset
    if (segment.timeline !== this.currentTimeline_ ||
        startOfSegment < this.sourceUpdater_.timestampOffset()) {
      timestampOffset = startOfSegment;
    }

    return {
      // resolve the segment URL relative to the playlist
      uri: segment.resolvedUri,
      // the segment's mediaIndex at the time it was requested
      mediaIndex,
      // the segment's playlist
      playlist,
      // unencrypted bytes of the segment
      bytes: null,
      // when a key is defined for this segment, the encrypted bytes
      encryptedBytes: null,
      // the state of the buffer before a segment is appended will be
      // stored here so that the actual segment duration can be
      // determined after it has been appended
      buffered: null,
      // The target timestampOffset for this segment when we append it
      // to the source buffer
      timestampOffset,
      // The timeline that the segment is in
      timeline: segment.timeline,
      // The expected duration of the segment in seconds
      duration: segment.duration
    };
  }

  /**
   * abort all pending xhr requests and null any pending segements
   *
   * @private
   */
  abort_() {
    if (this.xhr_) {
      this.xhr_.abort();
    }

    // clear out the segment being processed
    this.pendingSegment_ = null;
  }

  /**
   * fill the buffer with segements unless the
   * sourceBuffers are currently updating
   *
   * @private
   */
  fillBuffer_() {
    if (this.sourceUpdater_.updating()) {
      return;
    }

    // see if we need to begin loading immediately
    let request = this.checkBuffer_(this.sourceUpdater_.buffered(),
                                    this.playlist_,
                                    this.currentTime_(),
                                    this.timestampOffset_);

    if (!request) {
      return;
    }

    if (request.mediaIndex === this.playlist_.segments.length - 1 &&
        this.mediaSource_.readyState === 'ended' &&
        !this.seeking_()) {
      return;
    }

    let segment = this.playlist_.segments[request.mediaIndex];
    let startOfSegment = duration(this.playlist_,
                                  this.playlist_.mediaSequence + request.mediaIndex,
                                  this.expired_);

    // Sanity check the segment-index determining logic by calcuating the
    // percentage of the chosen segment that is buffered. If more than 90%
    // of the segment is buffered then fetching it will likely not help in
    // any way
    let percentBuffered = Ranges.getSegmentBufferedPercent(startOfSegment,
                                                          segment.duration,
                                                          this.currentTime_(),
                                                          this.sourceUpdater_.buffered());

    if (percentBuffered >= 90) {
      // Increment the timeCorrection_ variable to push the fetcher forward
      // in time and hopefully skip any gaps or flaws in our understanding
      // of the media
      let correctionApplied =
        this.incrementTimeCorrection_(this.playlist_.targetDuration / 2, 1);

      if (correctionApplied && !this.paused()) {
        this.fillBuffer_();
      }

      return;
    }

    this.loadSegment_(request);
  }

  /**
   * trim the back buffer so we only remove content
   * on segment boundaries
   *
   * @private
   *
   * @param {Object} segmentInfo - the current segment
   * @returns {Number} removeToTime - the end point in time, in seconds
   * that the the buffer should be trimmed.
   */
  trimBuffer_(segmentInfo) {
    let seekable = this.seekable_();
    let currentTime = this.currentTime_();
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

    // If we are going to remove time from the front of the buffer, make
    // sure we aren't discarding a partial segment to avoid throwing
    // PLAYER_ERR_TIMEOUT while trying to read a partially discarded segment
    for (let i = 0; i <= segmentInfo.playlist.segments.length; i++) {
      // Loop through the segments and calculate the duration to compare
      // against the removeToTime
      let removeDuration = duration(segmentInfo.playlist,
                                    segmentInfo.playlist.mediaSequence + i,
                                    this.expired_);

      // If we are close to next segment begining, remove to end of previous
      // segment instead
      let previousDuration = duration(segmentInfo.playlist,
                                    segmentInfo.playlist.mediaSequence + (i - 1),
                                    this.expired_);

      if (removeDuration >= removeToTime) {
        removeToTime = previousDuration;
        break;
      }
    }
    return removeToTime;
  }

  /**
   * load a specific segment from a request into the buffer
   *
   * @private
   */
  loadSegment_(segmentInfo) {
    let segment;
    let keyXhr;
    let segmentXhr;
    let removeToTime = 0;

    removeToTime = this.trimBuffer_(segmentInfo);

    if (removeToTime > 0) {
      this.sourceUpdater_.remove(0, removeToTime);
    }

    segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

    if (segment.key) {
      let keyRequestOptions = videojs.mergeOptions(this.xhrOptions_, {
        uri: segment.key.resolvedUri,
        responseType: 'arraybuffer'
      });

      keyXhr = this.hls_.xhr(keyRequestOptions, this.handleResponse_.bind(this));
    }

    this.pendingSegment_ = segmentInfo;

    let segmentRequestOptions = videojs.mergeOptions(this.xhrOptions_, {
      uri: segmentInfo.uri,
      responseType: 'arraybuffer',
      headers: segmentXhrHeaders(segment)
    });

    segmentXhr = this.hls_.xhr(segmentRequestOptions, this.handleResponse_.bind(this));

    this.xhr_ = {
      keyXhr,
      segmentXhr,
      abort() {
        if (this.segmentXhr) {
          // Prevent error handler from running.
          this.segmentXhr.onreadystatechange = null;
          this.segmentXhr.abort();
          this.segmentXhr = null;
        }
        if (this.keyXhr) {
          // Prevent error handler from running.
          this.keyXhr.onreadystatechange = null;
          this.keyXhr.abort();
          this.keyXhr = null;
        }
      }
    };

    this.state = 'WAITING';
  }

  /**
   * triggered when a segment response is received
   *
   * @private
   */
  handleResponse_(error, request) {
    let segmentInfo;
    let segment;
    let keyXhrRequest;
    let view;

    // timeout of previously aborted request
    if (!this.xhr_ ||
        (request !== this.xhr_.segmentXhr && request !== this.xhr_.keyXhr)) {
      return;
    }

    segmentInfo = this.pendingSegment_;
    segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

    // if a request times out, reset bandwidth tracking
    if (request.timedout) {
      this.abort_();
      this.bandwidth = 1;
      this.roundTrip = NaN;
      this.state = 'READY';
      return this.trigger('progress');
    }

    // trigger an event for other errors
    if (!request.aborted && error) {
      // abort will clear xhr_
      keyXhrRequest = this.xhr_.keyXhr;
      this.abort_();
      this.error({
        status: request.status,
        message: request === keyXhrRequest ?
          'HLS key request error at URL: ' + segment.key.uri :
          'HLS segment request error at URL: ' + segmentInfo.uri,
        code: 2,
        xhr: request
      });
      this.state = 'READY';
      this.pause();
      return this.trigger('error');
    }

    // stop processing if the request was aborted
    if (!request.response) {
      this.abort_();
      return;
    }

    if (request === this.xhr_.segmentXhr) {
      // the segment request is no longer outstanding
      this.xhr_.segmentXhr = null;

      // calculate the download bandwidth based on segment request
      this.roundTrip = request.roundTripTime;
      this.bandwidth = request.bandwidth;
      this.mediaBytesTransferred += request.bytesReceived || 0;
      this.mediaRequests += 1;
      this.mediaTransferDuration += request.roundTripTime || 0;

      if (segment.key) {
        segmentInfo.encryptedBytes = new Uint8Array(request.response);
      } else {
        segmentInfo.bytes = new Uint8Array(request.response);
      }
    }

    if (request === this.xhr_.keyXhr) {
      keyXhrRequest = this.xhr_.segmentXhr;
      // the key request is no longer outstanding
      this.xhr_.keyXhr = null;

      if (request.response.byteLength !== 16) {
        this.abort_();
        this.error({
          status: request.status,
          message: 'Invalid HLS key at URL: ' + segment.key.uri,
          code: 2,
          xhr: request
        });
        this.state = 'READY';
        this.pause();
        return this.trigger('error');
      }

      view = new DataView(request.response);
      segment.key.bytes = new Uint32Array([
        view.getUint32(0),
        view.getUint32(4),
        view.getUint32(8),
        view.getUint32(12)
      ]);

      // if the media sequence is greater than 2^32, the IV will be incorrect
      // assuming 10s segments, that would be about 1300 years
      segment.key.iv = segment.key.iv || new Uint32Array([
        0, 0, 0, segmentInfo.mediaIndex + segmentInfo.playlist.mediaSequence
      ]);
    }

    if (!this.xhr_.segmentXhr && !this.xhr_.keyXhr) {
      this.xhr_ = null;
      this.processResponse_();
    }
  }

  /**
   * clear anything that is currently in the buffer and throw it away
   */
  clearBuffer() {
    if (this.sourceUpdater_ &&
        this.sourceUpdater_.buffered().length) {
      this.sourceUpdater_.remove(0, Infinity);
    }
  }

  /**
   * Decrypt the segment that is being loaded if necessary
   *
   * @private
   */
  processResponse_() {
    let segmentInfo;
    let segment;

    this.state = 'DECRYPTING';

    segmentInfo = this.pendingSegment_;
    segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

    if (segment.key) {
      // this is an encrypted segment
      // incrementally decrypt the segment
      /* eslint-disable no-new, handle-callback-err */
      new Decrypter(segmentInfo.encryptedBytes,
                    segment.key.bytes,
                    segment.key.iv,
                    (function(err, bytes) {
                      // err always null
                      segmentInfo.bytes = bytes;
                      this.handleSegment_();
                    }).bind(this));
      /* eslint-enable */
    } else {
      this.handleSegment_();
    }
  }

  /**
   * append a decrypted segement to the SourceBuffer through a SourceUpdater
   *
   * @private
   */
  handleSegment_() {
    let segmentInfo;

    this.state = 'APPENDING';
    segmentInfo = this.pendingSegment_;
    segmentInfo.buffered = this.sourceUpdater_.buffered();
    this.currentTimeline_ = segmentInfo.timeline;

    if (segmentInfo.timestampOffset !== this.sourceUpdater_.timestampOffset()) {
      this.sourceUpdater_.timestampOffset(segmentInfo.timestampOffset);
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
    let segmentInfo = this.pendingSegment_;
    let currentTime = this.currentTime_();

    this.pendingSegment_ = null;

    // add segment metadata if it we have gained information during the
    // last append
    let timelineUpdated = this.updateTimeline_(segmentInfo);

    this.trigger('progress');

    let currentMediaIndex = segmentInfo.mediaIndex;

    currentMediaIndex +=
      segmentInfo.playlist.mediaSequence - this.playlist_.mediaSequence;

    let currentBuffered = Ranges.findRange(this.sourceUpdater_.buffered(), currentTime);

    // any time an update finishes and the last segment is in the
    // buffer, end the stream. this ensures the "ended" event will
    // fire if playback reaches that point.
    let isEndOfStream = detectEndOfStream(segmentInfo.playlist,
                                          this.mediaSource_,
                                          currentMediaIndex,
                                          currentBuffered);

    if (isEndOfStream) {
      this.mediaSource_.endOfStream();
    }

    // when seeking to the beginning of the seekable range, it's
    // possible that imprecise timing information may cause the seek to
    // end up earlier than the start of the range
    // in that case, seek again
    let seekable = this.seekable_();
    let next = Ranges.findNextRange(this.sourceUpdater_.buffered(), currentTime);

    if (this.seeking_() &&
        currentBuffered.length === 0) {
      if (seekable.length &&
          currentTime < seekable.start(0)) {

        if (next.length) {
          videojs.log('tried seeking to', currentTime,
                      'but that was too early, retrying at', next.start(0));
          this.setCurrentTime_(next.start(0) + Ranges.TIME_FUDGE_FACTOR);
        }
      }
    }

    this.state = 'READY';

    if (timelineUpdated) {
      this.timeCorrection_ = 0;
      if (!this.paused()) {
        this.fillBuffer_();
      }
      return;
    }

    // the last segment append must have been entirely in the
    // already buffered time ranges. adjust the timeCorrection
    // offset to fetch forward until we find a segment that adds
    // to the buffered time ranges and improves subsequent media
    // index calculations.
    let correctionApplied = this.incrementTimeCorrection_(segmentInfo.duration, 4);

    if (correctionApplied && !this.paused()) {
      this.fillBuffer_();
    }
  }

  /**
   * annotate the segment with any start and end time information
   * added by the media processing
   *
   * @private
   * @param {Object} segmentInfo annotate a segment with time info
   */
  updateTimeline_(segmentInfo) {
    let segment;
    let segmentEnd;
    let timelineUpdated = false;
    let playlist = segmentInfo.playlist;
    let currentMediaIndex = segmentInfo.mediaIndex;

    currentMediaIndex += playlist.mediaSequence - this.playlist_.mediaSequence;
    segment = playlist.segments[currentMediaIndex];

    // Update segment meta-data (duration and end-point) based on timeline
    if (segment &&
        segmentInfo &&
        segmentInfo.playlist.uri === this.playlist_.uri) {
      segmentEnd = Ranges.findSoleUncommonTimeRangesEnd(segmentInfo.buffered,
                                                        this.sourceUpdater_.buffered());
      timelineUpdated = updateSegmentMetadata(playlist,
                                              currentMediaIndex,
                                              segmentEnd);
    }

    return timelineUpdated;
  }

  /**
   * add a number of seconds to the currentTime when determining which
   * segment to fetch in order to force the fetcher to advance in cases
   * where it may get stuck on the same segment due to buffer gaps or
   * missing segment annotation after a rendition switch (especially
   * during a live stream)
   *
   * @private
   * @param {Number} secondsToIncrement number of seconds to add to the
   * timeCorrection_ variable
   * @param {Number} maxSegmentsToWalk maximum number of times we allow this
   * function to walk forward
   */
  incrementTimeCorrection_(secondsToIncrement, maxSegmentsToWalk) {
    // If we have already incremented timeCorrection_ beyond the limit,
    // stop searching for a segment and reset timeCorrection_
    if (this.timeCorrection_ >= this.playlist_.targetDuration * maxSegmentsToWalk) {
      this.timeCorrection_ = 0;
      return false;
    }

    this.timeCorrection_ += secondsToIncrement;
    return true;
  }
}

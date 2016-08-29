/**
 * @file segment-loader.js
 */
import Ranges from './ranges';
import {getMediaIndexForTime_ as getMediaIndexForTime, duration, sumDurations} from './playlist';
import videojs from 'video.js';
import SourceUpdater from './source-updater';
import {Decrypter} from 'aes-decrypter';
import mp4probe from 'mux.js/lib/mp4/probe';
import Config from './config';
import window from 'global/window';
import {inspect as inspectSegment} from 'mux.js/lib/tools/ts-inspector.js';

// in ms
const CHECK_BUFFER_DELAY = 500;

// temporary, switchable debug logging
const log = function () {
  if (window.logit) {
    console.log.apply(console, arguments);
  }
}

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
 * Returns a unique string identifier for a media initialization
 * segment.
 */
const initSegmentId = function(initSegment) {
  let byterange = initSegment.byterange || {
    length: Infinity,
    offset: 0
  };

  return [
    byterange.length, byterange.offset, initSegment.resolvedUri
  ].join(',');
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
    this.mediaIndex = null;

    // private settings
    this.hasPlayed_ = settings.hasPlayed;
    this.currentTime_ = settings.currentTime;
    this.seekable_ = settings.seekable;
    this.seeking_ = settings.seeking;
    this.setCurrentTime_ = settings.setCurrentTime;
    this.mediaSource_ = settings.mediaSource;

    this.hls_ = settings.hls;

    // private instance variables
    this.checkBufferTimeout_ = null;
    this.error_ = void 0;
    this.expired_ = 0;
    this.currentTimeline_ = -1;
    this.zeroOffset_ = NaN;
    this.xhr_ = null;
    this.pendingSegment_ = null;
    this.mimeType_ = null;
    this.sourceUpdater_ = null;
    this.xhrOptions_ = null;

    this.activeInitSegmentId_ = null;
    this.initSegments_ = {};

    // Segment Loader state variables...
    // ...for synching across variants
    this.inspectCache_;
    this.timelines = [];
    this.discontinuities = [];
    this.syncPoint_ = {
      time: 0,
      segmentIndex: 0
    };
    // ...for determining the fetch location
    this.fetchAtBuffer_ = false;

    this.firstPlaylist_ = null;
    this.newSegmentDurations_ = 0;
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
    this.mediaSecondsLoaded_ = 0;
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
    // un-pause
    this.monitorBuffer_();

    // if we don't have a playlist yet, keep waiting for one to be
    // specified
    if (!this.playlist_) {
      return;
    }

    // if all the configuration is ready, initialize and begin loading
    if (this.state === 'INIT' && this.mimeType_) {
      return this.init_();
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

  saveNewSegmentDurations_(oldPlaylist, newPlaylist) {
    let oldEnd = oldPlaylist.segments.length + oldPlaylist.mediaSequence;
    let newEnd = newPlaylist.segments.length + newPlaylist.mediaSequence;

    let mediaSequenceDiff = newEnd - oldEnd;
    let i = newPlaylist.segments.length - mediaSequenceDiff;

    // When a segment expires from the playlist and it has a start time
    // save that information as a possible sync-point reference in future
    for (; i < newPlaylist.segments.length; i++) {
      let newSegment = newPlaylist.segments[i];

      this.newSegmentDurations_ += newSegment.duration;
    }
    console.log('debug', this.newSegmentDurations_, (Date.now() - this.firstPlaylist_) / 1000);
  }

  saveExpiredSegmentInfo_(oldPlaylist, newPlaylist) {
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
        break;
      }
    }
  }

  /**
   * set a playlist on the segment loader
   *
   * @param {PlaylistLoader} media the playlist to set on the segment loader
   */
  playlist(media, options = {}) {
    if (!media) {
      return;
    }

    let oldPlaylist = this.playlist_;

    if (!this.firstPlaylist_) {
      this.firstPlaylist_ = Date.now();
    }

    if (this.mediaIndex !== null) {
      // We reloaded the same playlist so we are in a live scenario
      // and we will likely need to adjust the mediaIndex
      if (oldPlaylist &&
          oldPlaylist.uri === newPlaylist.uri) {
        let mediaSequenceDiff = newPlaylist.mediaSequence - oldPlaylist.mediaSequence;

        this.mediaIndex -= mediaSequenceDiff;
        this.saveNewSegmentDurations_(oldPlaylist, newPlaylist);
        this.saveExpiredSegmentInfo_(oldPlaylist, newPlaylist);
      } else {
        // We "resync" the fetcher when we switch renditions
        this.resyncFetcher();
      }
    }

    this.playlist_ = media;
    this.xhrOptions_ = options;

    // if we were unpaused but waiting for a playlist, start
    // buffering now
    if (this.mimeType_ && this.state === 'INIT' && !this.paused()) {
      return this.init_();
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
    if (this.mimeType_) {
      return;
    }

    this.mimeType_ = mimeType;
    // if we were unpaused but waiting for a sourceUpdater, start
    // buffering now
    if (this.playlist_ &&
        this.state === 'INIT' &&
        !this.paused()) {
      this.init_();
    }
  }

  /**
   * As long as the SegmentLoader is in the READY state, periodically
   * invoke fillBuffer_().
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
  getSyncPoint_(playlist, duration, currentTimeline) {
    let syncPoint = {
      time: 0,
      segmentIndex: 0
    };

    // Try to find a sync-point in by utilizing various strategies...

    // Stategy "VOD": Handle the VOD-case where the sync-point is *always*
    //                the equivalence display-time 0 === segment-index 0
    if (duration !== Infinity) {
      log('sync-found <vod>:', syncPoint);
      return syncPoint;
    }

    // Stategy "Segment": We have a known time mapping for a timeline and a
    //                    segment in the current timeline with timing data
    let segments = playlist.segments;

    for (let i = segments.length - 1; i >= 0; i--) {
      let segment = segments[i];
      if (segment.timeline === currentTimeline &&
          typeof segment.start !== 'undefined') {
        syncPoint = {
          time: segment.start,
          segmentIndex: i
        };
        log('sync-found <segment>:', syncPoint);
        return syncPoint;
      }
    }

    // Stategy "Discontinuity": We have a discontinuity with a known
    //                          display-time
    if (playlist.discontinuityStarts.length) {
      for (let i = 0; i < playlist.discontinuityStarts.length; i++) {
        let segmentIndex = playlist.discontinuityStarts[i];
        let discontinuity = playlist.discontinuitySequence + i + 1;

        if (this.discontinuities[discontinuity]) {
          syncPoint = {
            time: this.discontinuities[discontinuity].time,
            segmentIndex
          };
          log('sync-found <discontinuity>:', syncPoint);
          return syncPoint;
        }
      }
    }

    // Stategy "Playlist": We have a playlist with a known mapping of
    //                     segment index to display time
    if (playlist.syncInfo) {
      if (playlist.discontinuityStarts)
      syncPoint = {
        time: playlist.syncInfo.time,
        segmentIndex: playlist.syncInfo.mediaSequence - playlist.mediaSequence
      };
      log('sync-found <playlist>:', syncPoint);
      return syncPoint;
    }

    // TODO:
    // Stategy "ProgramTime": We have a program-date-time tag in this playlist

    // Otherwise, we need to attempt to get a sync-point manually
    // by fetching a segment in the playlist and constructing a sync-
    // point from that
    return null;
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
    } else {
      return Math.max(playlist.segments.length - 1, 0);
    }
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

    if (buffered.length) {
      lastBufferedEnd = buffered.end(buffered.length - 1);
    }

    let bufferedTime = Math.max(0, lastBufferedEnd - currentTime);

    if (!playlist.segments.length) {
      return;
    }

    log('cB_', 'mediaIndex:', mediaIndex, 'hasPlayed:', hasPlayed, 'currentTime:', currentTime, 'syncPoint:', syncPoint, 'fetchAtBuffer:', this.fetchAtBuffer_);
    log('cB_ 2', 'bufferedTime:', bufferedTime);

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

    // When the syncPoint is null, there is no way of determining a good
    // conservative segment index to fetch from
    // The best thing to do here is to get the kind of sync-point data by
    // making a request
    if (syncPoint === null) {
      mediaIndex = this.getSyncSegmentCandidate_(playlist);
      log('getSync', mediaIndex);
      return this.generateSegmentRequest_(playlist, mediaIndex, true);
    }

    // Under normal playback conditions fetching is a simple walk forward
    if (mediaIndex !== null) {
      log('++', mediaIndex + 1);
      return this.generateSegmentRequest_(playlist, mediaIndex + 1, false);
    }

    // There is a sync-point but the lack of a mediaIndex indicates that
    // we need to make a good conservative guess about which segment to
    // fetch
    if (this.fetchAtBuffer_) {
      // Find the segment containing currentTime
      mediaIndex =  getMediaIndexForTime(playlist, lastBufferedEnd, syncPoint.segmentIndex, syncPoint.time);
    } else {
      // Find the segment containing the end of the buffer
      mediaIndex =  getMediaIndexForTime(playlist, currentTime, syncPoint.segmentIndex, syncPoint.time);
    }
    log('gMIFT', mediaIndex);
    return this.generateSegmentRequest_(playlist, mediaIndex, false);
  }

  generateSegmentRequest_(playlist, mediaIndex, isSyncRequest) {
   if (mediaIndex < 0 || mediaIndex >= playlist.segments.length) {
      return null;
    }

    let segment = playlist.segments[mediaIndex];

    return {
      // resolve the segment URL relative to the playlist
      uri: segment.resolvedUri,
      // the segment's mediaIndex at the time it was requested
      mediaIndex,
      // whether or not to update the SegmentLoader's state with this
      // segment's mediaIndex
      isSyncRequest,
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
   * Once all the starting parameters have been specified, begin
   * operation. This method should only be invoked from the INIT
   * state.
   */
  init_() {
    this.state = 'READY';
    this.sourceUpdater_ = new SourceUpdater(this.mediaSource_, this.mimeType_);
    this.resetEverything();
    return this.fillBuffer_();
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

    if (!this.syncPoint_) {
      this.syncPoint_ = this.getSyncPoint_(this.playlist_,
                                           this.mediaSource_.duration,
                                           this.currentTimeline_);
    }

    // see if we need to begin loading immediately
    let request = this.checkBuffer_(this.sourceUpdater_.buffered(),
                                    this.playlist_,
                                    this.mediaIndex,
                                    this.hasPlayed_(),
                                    this.currentTime_(),
                                    this.syncPoint_);

    if (!request) {
      return;
    }

    if (!request.isSyncRequest) {
      this.mediaIndex = request.mediaIndex;
      this.fetchAtBuffer_ = true;
    }

    let segment = this.playlist_.segments[request.mediaIndex];
    let startOfSegment = duration(this.playlist_,
                                  this.playlist_.mediaSequence + request.mediaIndex,
                                  this.expired_);

    request.timestampOffset = this.sourceUpdater_.timestampOffset();
    // We will need to change timestampOffset of the sourceBuffer if either of
    // the following conditions are true:
    // - The segment.timeline !== this.currentTimeline
    //   (we are crossing a discontinuity somehow)
    // - The "timestampOffset" for the start of this segment is less than
    //   the currently set timestampOffset
    if (segment.timeline !== this.currentTimeline_ ||
        startOfSegment < this.sourceUpdater_.timestampOffset()) {
      request.timestampOffset = startOfSegment;
    }

    this.currentTimeline_ = request.timeline;

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
    let initSegmentXhr;
    let segmentXhr;
    let removeToTime = 0;

    removeToTime = this.trimBuffer_(segmentInfo);

    if (removeToTime > 0) {
      this.sourceUpdater_.remove(0, removeToTime);
    }

    segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

    // optionally, request the decryption key
    if (segment.key) {
      let keyRequestOptions = videojs.mergeOptions(this.xhrOptions_, {
        uri: segment.key.resolvedUri,
        responseType: 'arraybuffer'
      });

      keyXhr = this.hls_.xhr(keyRequestOptions, this.handleResponse_.bind(this));
    }

    // optionally, request the associated media init segment
    if (segment.map &&
        !this.initSegments_[initSegmentId(segment.map)]) {
      let initSegmentOptions = videojs.mergeOptions(this.xhrOptions_, {
        uri: segment.map.resolvedUri,
        responseType: 'arraybuffer',
        headers: segmentXhrHeaders(segment.map)
      });

      initSegmentXhr = this.hls_.xhr(initSegmentOptions,
                                     this.handleResponse_.bind(this));
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
      initSegmentXhr,
      segmentXhr,
      abort() {
        if (this.segmentXhr) {
          // Prevent error handler from running.
          this.segmentXhr.onreadystatechange = null;
          this.segmentXhr.abort();
          this.segmentXhr = null;
        }
        if (this.initSegmentXhr) {
          // Prevent error handler from running.
          this.initSegmentXhr.onreadystatechange = null;
          this.initSegmentXhr.abort();
          this.initSegmentXhr = null;
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
        (request !== this.xhr_.segmentXhr &&
         request !== this.xhr_.keyXhr &&
         request !== this.xhr_.initSegmentXhr)) {
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

    if (request === this.xhr_.initSegmentXhr) {
      // the init segment request is no longer outstanding
      this.xhr_.initSegmentXhr = null;
      segment.map.bytes = new Uint8Array(request.response);
      this.initSegments_[initSegmentId(segment.map)] = segment.map;
    }

    if (!this.xhr_.segmentXhr && !this.xhr_.keyXhr && !this.xhr_.initSegmentXhr) {
      this.xhr_ = null;
      this.processResponse_();
    }
  }

  /**
   * Delete all the buffered data and reset the SegmentLoader
   */
  resetEverything() {
    this.resetFetcher();
    this.remove(0, Infinity);
  }

  /**
   * Force the SegmentLoader to resync and start loading around the currentTime instead
   * of starting at the end of the buffer
   *
   * Useful for fast quality changes
   */
  resetFetcher() {
    this.fetchAtBuffer_ = false;
    this.resyncFetcher();
  }

  /**
   * Force the SegmentLoader to restart synchronization and make a conservative guess
   * before returning to the simple walk-forward method
   */
  resyncFetcher() {
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

    // some videos don't start from presentation time zero
    // if that is the case, set the timestamp offset on the first
    // segment to adjust them so that it is not necessary to seek
    // before playback can begin
    if (segment.map && isNaN(this.zeroOffset_)) {
      let timescales = mp4probe.timescale(segment.map.bytes);
      let startTime = mp4probe.startTime(timescales, segmentInfo.bytes);

      this.zeroOffset_ = startTime;
      segmentInfo.timestampOffset -= startTime;
    }

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
    this.state = 'APPENDING';

    let segmentInfo = this.pendingSegment_;
    let segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

    if (!segment.map) {
      this.getSegmentTimingInfo_(segmentInfo);
    }

    if (segmentInfo.timestampOffset !== null) {
      this.sourceUpdater_.timestampOffset(segmentInfo.timestampOffset);
    }

    // if the media initialization segment is changing, append it
    // before the content segment
    if (segment.map) {
      let initId = initSegmentId(segment.map);

      if (!this.activeInitSegmentId_ ||
          this.activeInitSegmentId_ !== initId) {
        let initSegment = this.initSegments_[initId];

        this.sourceUpdater_.appendBuffer(initSegment.bytes, () => {
          this.activeInitSegmentId_ = initId;
        });
      }
    }

    this.sourceUpdater_.appendBuffer(segmentInfo.bytes,
                                     this.handleUpdateEnd_.bind(this));
  }

  getSegmentTimingInfo_(segmentInfo) {
    let playlist = segmentInfo.playlist;
    let segments = playlist.segments;
    let segment = segments[segmentInfo.mediaIndex];
    let timeInfo = inspectSegment(segmentInfo.bytes, this.inspectCache_);
    let segmentStartTime;
    let segmentEndTime;
    let mappingObj = this.timelines[segmentInfo.timeline];

    if (timeInfo.video && timeInfo.video.length === 2) {
      this.inspectCache_ = timeInfo.video[1].dts;
      segmentStartTime = timeInfo.video[0].dtsTime;
      segmentEndTime = timeInfo.video[1].dtsTime;
    } else if (timeInfo.audio && timeInfo.audio.length === 2) {
      this.inspectCache_ = timeInfo.audio[1].dts;
      segmentStartTime = timeInfo.audio[0].dtsTime;
      segmentEndTime = timeInfo.audio[1].dtsTime;
    }

    if (segmentInfo.timestampOffset !== null) {
      mappingObj = {
        time: segmentInfo.timestampOffset,
        mapping: segmentInfo.timestampOffset - segmentStartTime
      };

      log('tsO:', segmentInfo.timestampOffset);

      this.timelines[segmentInfo.timeline] = mappingObj;
      segment.start = segmentInfo.timestampOffset;
      segment.end = segmentEndTime + mappingObj.mapping;
    } else {
      segment.start = segmentStartTime + mappingObj.mapping;
      segment.end = segmentEndTime + mappingObj.mapping;
    }

    if (segment.discontinuity) {
      this.discontinuities[segment.timeline] = {
        time: segment.start,
        accuracy: 0
      };
    } else if (playlist.discontinuityStarts.length) {
      for (let i = 0; i < playlist.discontinuityStarts.length; i++) {
        let segmentIndex = playlist.discontinuityStarts[i];
        let discontinuity = playlist.discontinuitySequence + i + 1;
        let accuracy = segmentIndex - segmentInfo.mediaIndex;

        if (accuracy > 0 &&
            (!this.discontinuities[discontinuity] ||
             this.discontinuities[discontinuity].accuracy > accuracy)) {

          this.discontinuities[discontinuity] = {
            time: segment.end + sumDurations(playlist, segmentInfo.mediaIndex + 1, segmentIndex),
            accuracy: accuracy
          };
        }
      }
    }

    this.mediaSecondsLoaded_ += segment.end - segment.start;
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

    log('handleUpdateEnd_');

    this.pendingSegment_ = null;

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

    this.state = 'READY';
    this.trigger('progress');

    if (!this.paused()) {
      this.fillBuffer_();
    }
  }
}

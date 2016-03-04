/**
 * segment-loader
 *
 * An object that manages segment loading and appending.
 *
 */

import {
  findRange_ as findRange,
  findSoleUncommonTimeRangesEnd_ as findSoleUncommonTimeRangesEnd
} from './ranges';
import {getMediaIndexForTime_ as getMediaIndexForTime, duration} from './playlist';
import videojs from 'video.js';
import SourceUpdater from './source-updater';
import xhr from './xhr';
import {Decrypter} from './decrypter';

// in ms
const CHECK_BUFFER_DELAY = 500;

// the desired length of video to maintain in the buffer, in seconds
export const GOAL_BUFFER_LENGTH = 30;

export default videojs.extend(videojs.EventTarget, {
  constructor(options) {
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
    this.bandwidth = NaN;
    this.roundTrip = NaN;
    this.bytesReceived = 0;

    // private properties
    this.currentTime_ = settings.currentTime;
    this.mediaSource_ = settings.mediaSource;
    this.withCredentials_ = settings.withCredentials;
    this.checkBufferTimeout_ = null;
    this.error_ = void 0;
    this.timestampOffset_ = 0;
    this.xhr_ = null;
    this.pendingSegment_ = null;
    this.sourceUpdater_ = new SourceUpdater(options.mediaSource, 'video/mp2t');
  },
  dispose() {
    this.abort_();
  },

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
  },
  error(error) {
    if (typeof error !== 'undefined') {
      this.error_ = error;
    }

    this.pendingSegment_ = null;
    return this.error_;
  },
  load() {
    this.monitorBuffer_();

    // if we don't have a playlist yet, keep waiting for one to be
    // specified
    if (!this.playlist_) {
      return;
    }

    // if we're in the middle of processing a segment already, don't
    // kick off an additional segment request
    if (this.state !== 'READY' && this.state !== 'INIT') {
      return;
    }

    this.state = 'READY';
    this.fillBuffer_();
  },
  playlist(media) {
    this.playlist_ = media;

    // if we were unpaused but waiting for a playlist, start
    // buffering now
    if (media && this.state === 'INIT' && !this.paused()) {
      this.state = 'READY';
      return this.fillBuffer_();
    }
  },
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
  },
  /**
   * Returns whether the segment loader is fetching additional
   * segments when given the opportunity. This property can be
   * modified through calls to pause() and load().
   */
  paused() {
    return this.checkBufferTimeout_ === null;
  },
  timestampOffset(offset) {
    this.timestampOffset_ = offset;
  },

  monitorBuffer_() {
    if (this.state === 'READY') {
      this.fillBuffer_();
    }
    this.checkBufferTimeout_ = window.setTimeout(this.monitorBuffer_.bind(this),
                                                 CHECK_BUFFER_DELAY);
  },
  /**
   * Determines what segment request should be made, given current
   * playback state.
   * @param buffered {TimeRanges} the state of the buffer
   * @param playlist {object} the playlist object to fetch segments from
   * @param currentTime {number} the playback position in seconds
   * @param timestampOffset (optional} {number} the duration of
   * content, in seconds, that has been removed from the front of
   * this playlist. If unspecified, it is assumed to be zero.
   * @return {object} a segment info object that describes the
   * request that should be made or null if no request is necessary
   */
  checkBuffer_(buffered, playlist, currentTime, timestampOffset) {
    let currentBuffered = findRange(buffered, currentTime);
    let bufferedTime;
    let currentBufferedEnd;
    let discontinuity;
    let segment;
    let mediaIndex;

    if (!playlist.segments.length) {
      return;
    }

    timestampOffset = timestampOffset || 0;
    if (currentBuffered.length === 0) {
      // find the segment containing currentTime
      mediaIndex = getMediaIndexForTime(playlist, currentTime, timestampOffset);
    } else {
      // find the segment adjacent to the end of the current
      // buffered region
      currentBufferedEnd = currentBuffered.end(0);
      bufferedTime = Math.max(0, currentBufferedEnd - currentTime);

      // if there is plenty of content buffered, relax for awhile
      if (bufferedTime >= GOAL_BUFFER_LENGTH) {
        return null;
      }
      mediaIndex = getMediaIndexForTime(playlist, currentBufferedEnd, timestampOffset);
      if (!mediaIndex || mediaIndex === playlist.segments.length) {
        return null;
      }
    }

    segment = playlist.segments[mediaIndex];

    // if the timestampOffset on the SourceBuffer is different from
    // the timestampOffset for the closest discontinuity before the
    // segment, update the timestampOffset:
    // - find the closest discontinuity before the appended segment
    // - set the SourceBuffer's timestampOffset to the estimated
    //   start time of the first discontinuous segment
    discontinuity = playlist.discontinuityStarts.slice().reverse()
      .find(function(i) {
        return i <= mediaIndex;
      });
    if (discontinuity) {
      timestampOffset += duration(playlist, playlist.mediaSequence + mediaIndex);
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
      timestampOffset
    };
  },

  abort_() {
    if (this.xhr_) {
      this.xhr_.abort();
    }

    // clear out the segment being processed
    this.pendingSegment_ = null;
  },

  fillBuffer_() {
    let request;

    // see if we need to begin loading immediately
    request = this.checkBuffer_(this.sourceUpdater_.buffered(),
                                this.playlist_,
                                this.currentTime_(),
                                this.timestampOffset_);
    if (request) {
      this.loadSegment_(request);
    }
  },
  loadSegment_(segmentInfo) {
    let segment;
    let requestTimeout;
    let keyXhr;
    let segmentXhr;

    segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
    // Set xhr timeout to 150% of the segment duration to allow us
    // some time to switch renditions in the event of a catastrophic
    // decrease in network performance or a server issue.
    requestTimeout = (segment.duration * 1.5) * 1000;

    if (segment.key) {
      keyXhr = xhr({
        uri: segment.key.resolvedUri,
        responseType: 'arraybuffer',
        withCredentials: this.withCredentials_,
        timeout: requestTimeout
      }, this.handleResponse_.bind(this));
    }
    this.pendingSegment_ = segmentInfo;
    segmentXhr = xhr({
      uri: segmentInfo.uri,
      responseType: 'arraybuffer',
      withCredentials: this.withCredentials_,
      timeout: requestTimeout
    }, this.handleResponse_.bind(this));

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
  },
  // triggered when a segment response is received
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
      this.bytesReceived += request.bytesReceived || 0;

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

      view = new DataView(request.response);
      segment.key.bytes = new Uint32Array([
        view.getUint32(0),
        view.getUint32(4),
        view.getUint32(8),
        view.getUint32(12)
      ]);

      // if the media sequence is greater than 2^32, the IV will be incorrect
      // assuming 10s segments, that would be about 1300 years
      segment.key.iv = segment.key.iv || new Uint32Array(
        [0, 0, 0, segmentInfo.mediaIndex + segmentInfo.playlist.mediaSequence]);
    }

    if (!this.xhr_.segmentXhr && !this.xhr_.keyXhr) {
      this.xhr_ = null;
      this.processResponse_();
    }
  },

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
  },

  handleSegment_() {
    let segmentInfo;

    this.state = 'APPENDING';

    segmentInfo = this.pendingSegment_;
    segmentInfo.buffered = this.sourceUpdater_.buffered();

    if (segmentInfo.timestampOffset !== this.sourceUpdater_.timestampOffset()) {
      this.sourceUpdater_.timestampOffset(segmentInfo.timestampOffset);
    }

    this.sourceUpdater_.appendBuffer(segmentInfo.bytes,
                                     this.handleUpdateEnd_.bind(this));
  },

  handleUpdateEnd_() {
    let buffered;
    let end;
    let segments;
    let segmentInfo;

    segmentInfo = this.pendingSegment_;
    this.pendingSegment_ = null;

    // add segment timeline information if we're still using the
    // same playlist
    if (segmentInfo && segmentInfo.playlist.uri === this.playlist_.uri) {
      this.updateTimeline_(segmentInfo);
      this.trigger('progress');
    }

    // any time an update finishes and the last segment is in the
    // buffer, end the stream. this ensures the "ended" event will
    // fire if playback reaches that point.
    buffered = this.sourceUpdater_.buffered();
    end = buffered.length - 1;
    segments = segmentInfo.playlist.segments;
    if (segmentInfo.playlist.endList &&
        buffered.length &&
        segments[segments.length - 1].end <= buffered.end(end) &&
        this.mediaSource_.readyState === 'open') {
      this.mediaSource_.endOfStream();
    }

    this.state = 'READY';

    if (!this.paused()) {
      this.fillBuffer_();
    }
  },
  // annotate the segment with any start and end time information
  // added by the media processing
  updateTimeline_(segmentInfo) {
    let currentMediaIndex;
    let segment;
    let timelineUpdate;

    currentMediaIndex = segmentInfo.mediaIndex;
    currentMediaIndex +=
      segmentInfo.playlist.mediaSequence - this.playlist_.mediaSequence;
    segment = segmentInfo.playlist.segments[currentMediaIndex];

    if (!segment) {
      return;
    }

    timelineUpdate = findSoleUncommonTimeRangesEnd(segmentInfo.buffered,
                                                   this.sourceUpdater_.buffered());

    if (timelineUpdate) {
      segment.end = timelineUpdate;
      return;
    }

    // the last segment append must have been entirely in the
    // already buffered time ranges. adjust the timestamp offset to
    // fetch forward until we find a segment that adds to the
    // buffered time ranges and improves subsequent media index
    // calculations.
    this.timestampOffset_ -= segment.duration;
  }
});

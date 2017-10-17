/**
 * @file source-updater.js
 */
import videojs from 'video.js';

const noop = function() {};

/**
 * A queue of callbacks to be serialized and applied when a
 * MediaSource and its associated SourceBuffers are not in the
 * updating state. It is used by the segment loader to update the
 * underlying SourceBuffers when new data is loaded, for instance.
 *
 * @class SourceUpdater
 * @param {MediaSource} mediaSource the MediaSource to create the
 * SourceBuffer from
 * @param {String} mimeType the desired MIME type of the underlying
 * SourceBuffer
 */
export default class SourceUpdater {
  constructor(mediaSource, mimeType) {
    let createSourceBuffer = () => {
      this.sourceBuffer_ = mediaSource.addSourceBuffer(mimeType);

      // run completion handlers and process callbacks as updateend
      // events fire
      this.onUpdateendCallback_ = () => {
        let pendingCallback = this.pendingCallback_;

        this.pendingCallback_ = null;

        if (pendingCallback) {
          pendingCallback();
        }

        this.runCallback_();
      };

      this.sourceBuffer_.addEventListener('updateend', this.onUpdateendCallback_);

      this.runCallback_();
    };

    this.callbacks_ = [];
    this.pendingCallback_ = null;
    this.timestampOffset_ = 0;
    this.mediaSource = mediaSource;
    this.processedAppend_ = false;

    this.bufferItemsList_ = [];

    if (mediaSource.readyState === 'closed') {
      mediaSource.addEventListener('sourceopen', createSourceBuffer);
    } else {
      createSourceBuffer();
    }
  }

  appendToBufferInfoQueue_(timestampOffset, duration, byteLength) {
    const timestamOffset = this.timestampOffset_;
    const bufferedTimeRanges = this.sourceBuffer_.buffered;
    const bufferedEnd = bufferedTimeRanges.length ?
        bufferedTimeRanges.end(bufferedTimeRanges.length - 1) : 0;

    const bufferItem = {
      start: bufferedEnd + timestampOffset,
      duration,
      byteLength,
      removed: false
    };

    this.bufferItemsList_.push(bufferItem);
  }

  removeFromBufferInfoQueue_(start, end) {

    this.bufferItemsList_.forEach((bufferItem) => {

      if (start <= bufferItem.start
        && end >= bufferItem.start + bufferItem.duration) {
        bufferItem.removed = true; // flag for removal
      }

    });

    this.bufferItemsList_ =
      this.bufferItemsList_.filter(
        (bufferItem) => ! bufferItem.removed
      );
  }

  totalBytesInBuffer() {
    return this.bufferItemsList_.reduce((sum, bufferItem) => {
      return sum + bufferItem.byteLength;
    }, 0);
  }

  /**
   * Aborts the current segment and resets the segment parser.
   *
   * @param {Function} done function to call when done
   * @see http://w3c.github.io/media-source/#widl-SourceBuffer-abort-void
   */
  abort(done) {
    if (this.processedAppend_) {
      this.queueCallback_(() => {
        this.sourceBuffer_.abort();
      }, done);
    }
  }

  /**
   * Queue an update to append an ArrayBuffer.
   *
   * @param {ArrayBuffer} bytes
   * @param {number} duration the media duration of this piece of buffer
   * @param {Function} done the function to call when done
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-appendBuffer-void-ArrayBuffer-data
   */
  appendBuffer(bytes, duration, done) {
    this.processedAppend_ = true;
    this.queueCallback_(() => {

      // we don't want to track initialization segments
      // only payload with actual media duration
      if (duration !== null) {
        this.appendToBufferInfoQueue_(this.sourceBuffer_.timestampOffset,
          duration, bytes.byteLength);
      }

      this.sourceBuffer_.appendBuffer(bytes);

    }, done);
  }

  /**
   * Indicates what TimeRanges are buffered in the managed SourceBuffer.
   *
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-buffered
   */
  buffered() {
    if (!this.sourceBuffer_) {
      return videojs.createTimeRanges();
    }
    return this.sourceBuffer_.buffered;
  }

  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {Number} start where to start the removal
   * @param {Number} end where to end the removal
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  remove(start, end) {
    if (this.processedAppend_) {
      this.queueCallback_(() => {
        this.sourceBuffer_.remove(start, end);
        this.removeFromBufferInfoQueue_(start, end);
      }, noop);
    }
  }

  /**
   * Whether the underlying sourceBuffer is updating or not
   *
   * @return {Boolean} the updating status of the SourceBuffer
   */
  updating() {
    return !this.sourceBuffer_ || this.sourceBuffer_.updating || this.pendingCallback_;
  }

  /**
   * Set/get the timestampoffset on the SourceBuffer
   *
   * @return {Number} the timestamp offset
   */
  timestampOffset(offset) {

    if (typeof offset !== 'undefined') {
      this.queueCallback_(() => {
        this.sourceBuffer_.timestampOffset = offset;
      });
      this.timestampOffset_ = offset;
    }
    return this.timestampOffset_;
  }

  /**
   * Queue a callback to run
   */
  queueCallback_(callback, done) {
    this.callbacks_.push([callback.bind(this), done]);
    this.runCallback_();
  }

  /**
   * Run a queued callback
   */
  runCallback_() {
    let callbacks;

    if (!this.updating() &&
        this.callbacks_.length) {
      callbacks = this.callbacks_.shift();
      this.pendingCallback_ = callbacks[1];
      callbacks[0]();
    }
  }

  /**
   * dispose of the source updater and the underlying sourceBuffer
   */
  dispose() {
    this.sourceBuffer_.removeEventListener('updateend', this.onUpdateendCallback_);
    if (this.sourceBuffer_ && this.mediaSource.readyState === 'open') {
      this.sourceBuffer_.abort();
    }
  }
}

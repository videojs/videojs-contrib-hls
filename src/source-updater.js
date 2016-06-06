/**
 * @file source-updater.js
 */
import videojs from 'video.js';

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

    if (mediaSource.readyState === 'closed') {
      mediaSource.addEventListener('sourceopen', createSourceBuffer);
    } else {
      createSourceBuffer();
    }
  }

  /**
   * Aborts the current segment and resets the segment parser.
   *
   * @param {Function} done function to call when done
   * @see http://w3c.github.io/media-source/#widl-SourceBuffer-abort-void
   */
  abort(done) {
    this.queueCallback_(() => {
      this.sourceBuffer_.abort();
    }, done);
  }

  /**
   * Queue an update to append an ArrayBuffer.
   *
   * @param {ArrayBuffer} bytes
   * @param {Function} done the function to call when done
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-appendBuffer-void-ArrayBuffer-data
   */
  appendBuffer(bytes, done) {
    this.queueCallback_(() => {
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
   * Queue an update to set the duration.
   *
   * @param {Double} duration what to set the duration to
   * @see http://www.w3.org/TR/media-source/#widl-MediaSource-duration
   */
  duration(duration) {
    this.queueCallback_(() => {
      this.sourceBuffer_.duration = duration;
    });
  }

  /**
   * Queue an update to remove a time range from the buffer.
   *
   * @param {Number} start where to start the removal
   * @param {Number} end where to end the removal
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  remove(start, end) {
    this.queueCallback_(() => {
      this.sourceBuffer_.remove(start, end);
    });
  }

  /**
   * wether the underlying sourceBuffer is updating or not
   *
   * @return {Boolean} the updating status of the SourceBuffer
   */
  updating() {
    return !this.sourceBuffer_ || this.sourceBuffer_.updating;
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
   * que a callback to run
   */
  queueCallback_(callback, done) {
    this.callbacks_.push([callback.bind(this), done]);
    this.runCallback_();
  }

  /**
   * run a queued callback
   */
  runCallback_() {
    let callbacks;

    if (this.sourceBuffer_ &&
        !this.sourceBuffer_.updating &&
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

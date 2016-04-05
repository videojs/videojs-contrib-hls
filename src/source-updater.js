/**
 * source-updater
 *
 * A queue of callbacks to be serialized and applied when a
 * MediaSource and its associated SourceBuffers are not in the
 * updating state. It is used by the segment loader to update the
 * underlying SourceBuffers when new data is loaded, for instance.
 *
 */
import videojs from 'video.js';

/**
 * Construct a new SourceUpdater using the specified MediaSource.
 * @param mediaSource {MediaSource} the MediaSource to create the
 * SourceBuffer from
 * @param mimeType {string} the desired MIME type of the underlying
 * SourceBuffer
 */
export default class SourceUpdater {
  constructor(mediaSource, mimeType) {
    let createSourceBuffer = () => {
      this.sourceBuffer_ = mediaSource.addSourceBuffer(mimeType);

      // run completion handlers and process callbacks as updateend
      // events fire
      this.sourceBuffer_.addEventListener('updateend', () => {
        let pendingCallback = this.pendingCallback_;

        this.pendingCallback_ = null;

        if (pendingCallback) {
          pendingCallback();
        }
      });
      this.sourceBuffer_.addEventListener('updateend',
                                          this.runCallback_.bind(this));

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
   * @see http://w3c.github.io/media-source/#widl-SourceBuffer-abort-void
   */
  abort(done) {
    this.queueCallback_(() => {
      this.sourceBuffer_.abort();
    }, done);
  }

  /**
   * Queue an update to append an ArrayBuffer.
   * @see http://www.w3.org/TR/media-source/
   *      #widl-SourceBuffer-appendBuffer-void-ArrayBuffer-data
   */
  appendBuffer(bytes, done) {
    this.queueCallback_(() => {
      this.sourceBuffer_.appendBuffer(bytes);
    }, done);
  }

  /**
   * Indicates what TimeRanges are buffered in the managed SourceBuffer.
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
   * @see http://www.w3.org/TR/media-source/#widl-MediaSource-duration
   */
  duration(duration) {
    this.queueCallback_(() => {
      this.sourceBuffer_.duration = duration;
    });
  }

  /**
   * Queue an update to remove a time range from the buffer.
   * @see http://www.w3.org/TR/media-source/
   *      #widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
   */
  remove(start, end) {
    this.queueCallback_(() => {
      this.sourceBuffer_.remove(start, end);
    });
  }

  updating() {
    return !this.sourceBuffer_ || this.sourceBuffer_.updating;
  }

  timestampOffset(offset) {
    if (typeof offset !== 'undefined') {
      this.queueCallback_(() => {
        this.sourceBuffer_.timestampOffset = offset;
      });
      this.timestampOffset_ = offset;
    }
    return this.timestampOffset_;
  }

  queueCallback_(callback, done) {
    this.callbacks_.push([callback.bind(this), done]);
    this.runCallback_();
  }

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

  dispose() {
    if (this.sourceBuffer_ && this.mediaSource.readyState === 'open') {
      this.sourceBuffer_.abort();
    }
  }
}

/**
 * @file source-updater.js
 */
import videojs from 'video.js';

const noop = function() {};

const ADD_SOURCE_BUFFER_RETRY_DEFER_MS = 40;

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

    let createSourceBufferDeferred;

    const createSourceBuffer = () => {

      if (this.sourceBuffer_) {
        videojs.log.
          warn('SourceBuffer creation attempt blocked:',
            'already called `addSourceBuffer` for this SourceUpdater');
        return;
      }

      try {
        this.sourceBuffer_ = mediaSource.addSourceBuffer(mimeType);
      } catch (e) {
        // notify about failed attempt
        videojs.log.warn('Failed attempt to call `addSourceBuffer` (not fatal)',
          e.message, e);
        // make sure this is reset to initial value
        this.sourceBuffer_ = null;
        // try again asap
        // It seems the underlying virtual MediaSource is sometimes
        // unreliable in the way it advertises it's readiness.
        // The only way we can deal with this here to make our
        // task fulfillment reliable is by having a layer of retrial
        // that will re-schedule this is a reasonable frequency.
        // See comment below on issue #963.
        createSourceBufferDeferred();
        return;
      }

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

    // Fixes https://github.com/videojs/videojs-contrib-hls/issues/963
    // We run this on the next tick as it seems
    // that sometimes when the `sourceopen` event is triggered, or when
    // the readyState indicates open, the
    // MediaSource is actually not ready yet to accept
    // calls to its `addSourceBuffer` method.
    // This seems to happen especially for when we need to create SourceBuffers
    // for seperate audio streams (A/V not muxed into the "main" stream).
    // However when state is settled on the next tick,
    // it seems safe to do so.
    createSourceBufferDeferred =
      (() => setTimeout(createSourceBuffer, ADD_SOURCE_BUFFER_RETRY_DEFER_MS));

    /**
     * @private
     * @member {Array<function>}
     */
    this.callbacks_ = [];

    /**
     * @private
     * @member {function}
     */
    this.pendingCallback_ = null;

    /**
     * @private
     * @member {number}
     */
    this.timestampOffset_ = 0;

    /**
     * @public
     * @member {MediaSource}
     */
    this.mediaSource = mediaSource;

    /**
     * @public
     * @member {boolean}
     */
    this.processedAppend_ = false;

    /**
     * @private
     * @member {SourceBuffer} sourceBuffer_
     */
    this.sourceBuffer_ = null;

    if (mediaSource.readyState === 'ended') {
      throw new Error('Cant create SourceBuffers on ended MediaSource');
    }

    if (mediaSource.readyState === 'open') {
      // Deferring fixes issue #963
      createSourceBufferDeferred();
    } else if (mediaSource.readyState === 'closed') {
      mediaSource.addEventListener('sourceopen', createSourceBufferDeferred);
    } else {
      throw new Error('MediaSource in illegal ready-state: ' + mediaSource.readyState)
    }
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
   * @param {Function} done the function to call when done
   * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-appendBuffer-void-ArrayBuffer-data
   */
  appendBuffer(bytes, done) {
    this.processedAppend_ = true;
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

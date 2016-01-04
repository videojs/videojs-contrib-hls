/**
 * source-updater
 *
 * A queue of callbacks to be serialized and applied when a
 * MediaSource and its associated SourceBuffers are not in the
 * updating state.
 *
 */
(function(window, videojs) {
  'use strict';

  /**
   * Construct a new SourceUpdater using the specified MediaSource.
   * @param mediaSource {MediaSource} the MediaSource to create the
   * SourceBuffer from
   * @param mimeType {string} the desired MIME type of the underlying
   * SourceBuffer
   */
  videojs.Hls.SourceUpdater = videojs.extend(null, {
    constructor: function(mediaSource, mimeType) {
      var createSourceBuffer = function() {
        this.sourceBuffer_ = mediaSource.addSourceBuffer(mimeType);

        // process callbacks as updateend events fire
        this.sourceBuffer_.addEventListener('updateend',
                                            this.runCallback_.bind(this));

        this.runCallback_();
      }.bind(this);

      this.callbacks_ = [];

      if (mediaSource.readyState === 'closed') {
        mediaSource.addEventListener('sourceopen', createSourceBuffer);
      } else {
        createSourceBuffer();
      }
    },

    /**
     * Queue an update to append an ArrayBuffer.
     * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-appendBuffer-void-ArrayBuffer-data
     */
    appendBuffer: function(bytes) {
      this.queueCallback_(function() {
        this.sourceBuffer_.appendBuffer(bytes);
      });
    },

    /**
     * Queue an update to remove a time range from the buffer.
     * @see http://www.w3.org/TR/media-source/#widl-SourceBuffer-remove-void-double-start-unrestricted-double-end
     */
    remove: function(start, end) {
      this.queueCallback_(function() {
        this.sourceBuffer_.remove(start, end);
      });
    },

    /**
     * Queue an update to set the duration.
     * @see http://www.w3.org/TR/media-source/#widl-MediaSource-duration
     */
    updateDuration: function(duration) {
      this.queueCallback_(function() {
        this.sourceBuffer_.updateDuration(duration);
      });
    },

    queueCallback_: function(callback) {
      this.callbacks_.push(callback.bind(this));
      this.runCallback_();
    },

    runCallback_: function() {
      if (this.sourceBuffer_ &&
          !this.sourceBuffer_.updating &&
          this.callbacks_.length) {
        this.callbacks_.shift()();
      }
    }
  });
})(window, window.videojs);

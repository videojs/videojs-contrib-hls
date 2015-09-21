/**
 * segment-loader
 * Objects that manage fetching segments from one or more media
 * playlists to keep the buffer full for playback.
 *
 * Copyright 2015 Brightcove; Licensed Apache2
 */
(function(window, videojs, undefined) {
  'use strict';

  var resolveUrl = videojs.Hls.resolveUrl;

  var SegmentLoader = videojs.extends(videojs.EventTarget, {
    constructor: function(options) {
      this.bytesReceived = 0;

      this.settings_ = videojs.mergeOptions(videojs.options.hls, options);
      this.playlist_ = null;
      this.mediaIndex_ = 0;
      this.offset_ = 0;
      this.buffer_ = [];
      this.xhr_ = null;
      this.checkBufferTimeout_ = null;
      this.baseUrl_ = window.location.href;
    },
    /**
     * Clean up any resources currently held by this segment loader so
     * it can be safely garbage collected.
     */
    dispose: function() {
      this.cancelXhr_();
    },

    /**
     * Set the path that relative segment URLs will be resolved against.
     */
    baseUrl: function(url) {
      this.baseUrl_ = url;
    },

    /**
     * The number of seconds of content this segment loader
     * anticipates it needs in addition to the current buffer to be
     * able to support uninterrupted playback.
     */
    desiredBuffer: function() {
      var segment;

      // if no segments are available, no need to buffer
      if (!this.playlist_ ||
          !this.playlist_.segments) {
        return 0;
      }

      // if the video has finished downloading, no need to buffer
      segment = this.playlist_.segments[this.mediaIndex_];
      if (!segment) {
        return 0;
      }

      // otherwise, try to keep one target duration ready
      return (this.playlist_.targetDuration || 10) - this.bufferedSeconds();
    },
    /**
     * The approximate number of seconds currently downloaded and
     * available.
     */
    bufferedSeconds: function() {
      var result = 0, i, segmentInfo;

      i = this.buffer_.length;
      while (i--) {
        segmentInfo = this.buffer_[i];
        result += segmentInfo.playlist.segments[segmentInfo.mediaIndex].duration ||
          segmentInfo.playlist.targetDuration;
      }
      return result;
    },
    /**
     * Request the next segment in the currently active playlist.
     */
    fetch: function() {
      var offset = this.offset_, segment;

      segment = this.playlist_.segments[this.mediaIndex_];
      if (!segment) {
        return;
      }

      // reset the offset for subsequent requests
      this.offset_ = 0;

      // request the next segment
      this.xhr_ = videojs.Hls.xhr({
        uri: resolveUrl(this.baseUrl_, segment.uri),
        responseType: 'arraybuffer',
        withCredentials: this.settings_.withCredentials
      }, function(error, request) {
        var segmentInfo;

        // whether it suceeded or not, the request is done
        this.xhr_ = null;

        if (error) {
          // if a segment request times out, reset bandwidth tracking
          if (request.timedout) {
            this.bandwidth = 1;
            this.trigger('timeout');
            return;
          }
          // otherwise, try jumping ahead to the next segment
          this.error = {
            status: request.status,
            message: 'HLS segment request error at URL: ' + request.uri,
            code: (request.status >= 500) ? 4 : 2
          };
          this.trigger('error', this.error);

          // try moving on to the next segment
          this.mediaIndex_++;
          return;
        }

        // stop processing if the request was aborted
        if (!request.response) {
          return;
        }

        // calculate the download bandwidth
        this.segmentXhrTime = request.roundTripTime;
        this.bandwidth = request.bandwidth;
        this.bytesReceived += request.bytesReceived || 0;

        // package up all the work to append the segment
        segmentInfo = {
          // the segment's mediaIndex at the time it was received
          mediaIndex: this.mediaIndex_,
          // the requested offset into the segment's timeline in seconds
          offset: offset,
          // the segment's playlist
          playlist: this.playlist_,
          // unencrypted bytes of the segment
          bytes: null,
          // when a key is defined for this segment, the encrypted bytes
          encryptedBytes: null,
          // optionally, the decrypter that is unencrypting the segment
          decrypter: null,
          // metadata events discovered during muxing that need to be
          // translated into cue points
          pendingMetadata: []
        };

        if (segmentInfo.playlist.segments[segmentInfo.mediaIndex].key) {
          segmentInfo.encryptedBytes = new Uint8Array(request.response);
        } else {
          segmentInfo.bytes = new Uint8Array(request.response);
        }
        this.buffer_.push(segmentInfo);
        this.mediaIndex_++;
        this.trigger('progress');
      }.bind(this));

      return this.xhr_;
    },
    /**
     * The number of segments currently downloaded and available.
     */
    length: function() {
      return this.buffer_.length;
    },
    /**
     * Returns the oldest segment currently downloaded without
     * removing it from the buffer.
     */
    peek: function() {
      return this.buffer_[0];
    },
    /**
     * Set or update the current media playlist being used to fetch
     * segments.
     */
    load: function(playlist, index) {
      if (index !== undefined) {
        // when loading a different variant playlist, the segmentation
        // may have changed and the correct segment to continue
        // buffering on must be supplied explicitly
        this.mediaIndex_ = this.xhr_? index - 1 : index;
      } else if (playlist && this.playlist_) {
        // when a media playlist is refreshed during a live stream,
        // the two versions can be synced based on media sequence
        // numbers
        this.mediaIndex_ -= playlist.mediaSequence - this.playlist_.mediaSequence;
      }
      this.playlist_ = playlist;

      this.trigger('change');
    },
    /**
     * The index of the next segment to be downloaded in the current
     * media playlist. When the current media playlist is live with
     * expiring segments, it may be a different value from the media
     * sequence number for a segment.
     *
     * When called with arguments, the buffer is cleared and segment
     * loading resumes from the newly specified location.
     *
     * Examples:
     * ```
     * // return the current media index:
     * segmentLoader.mediaIndex();
     *
     * // change the current media index to 4:
     * segmentLoader.mediaIndex(4);
     *
     * // update the current playlist and begin downloading the third
     * // segment, 7.5 seconds in:
     * segmentLoader.mediaIndex(playlist, 3, 7.5);
     * ```
     *
     * @param playlist {object} (optional) the playlist object to load
     * from
     * @param index {integer} (optional) the index of the next segment
     * to download
     * @param offset {number} (optional) the offset, in seconds, into
     * the first downloaded segment. If this is provided, `index` must
     * be as well.
     * @return {integer} the index of the next segment to be buffered
     */
    mediaIndex: function(playlist, index, offset) {
      if (playlist !== undefined) {
        // seeking to a different playlist and location
        this.cancelXhr_();
        this.buffer_ = [];
        this.playlist_ = playlist;
        this.mediaIndex_ = index;
        this.offset_ = offset;

        this.trigger('change');
      }
      return this.mediaIndex_;
    },
    /**
     * Remove and return the least-recently downloaded segment.
     */
    shift: function() {
      var result = this.buffer_.shift();
      this.trigger('change');
      return result;
    },

    cancelXhr_: function() {
      if (this.xhr_) {
        // Prevent error handler from running.
        this.xhr_.onreadystatechange = null;
        this.xhr_.abort();
        this.xhr_ = null;
      }
    },
    checkBuffer_: function(offset) {
      // reset any outstanding buffer checks
      if (this.checkBufferTimeout_) {
        window.clearTimeout(this.checkBufferTimeout_);
        this.checkBufferTimeout_ = null;
      }

      this.fillBuffer_(offset);

      // wait awhile and try again
      this.checkBufferTimeout_ = window.setTimeout((this.checkBuffer_).bind(this),
                                                   videojs.Hls.BUFFER_CHECK_INTERVAL);
    },
    fillBuffer_: function(offset) {
      var segment;

      // if there is a request already in flight, do nothing
      if (this.xhr_) {
        return;
      }

      // if no segments are available, do nothing
      if (!this.playlist_ ||
          !this.playlist_.segments) {
        return;
      }

      // if the video has finished downloading, stop trying to buffer
      segment = this.playlist_.segments[this.mediaIndex_];
      if (!segment) {
        return;
      }

      // if there is plenty of content in the buffer and we're not
      // seeking, relax for awhile
      if (typeof offset !== 'number' &&
          this.bufferedSeconds() >= videojs.Hls.GOAL_BUFFER_LENGTH) {
        return;
      }

      return this.fetch(resolveUrl(this.baseUrl_, segment.uri));
    },
    cancelXhr_: function() {
      if (this.xhr_) {
        // Prevent error handler from running.
        this.xhr_.onreadystatechange = null;
        this.xhr_.abort();
        this.xhr_ = null;
      }
    }
  });

  var byDesiredBuffer = function(left, right) {
    return right.desiredBuffer() - left.desiredBuffer();
  };

  var SegmentMultiLoader = videojs.extends(videojs.EventTarget, {
    constructor: function() {
      this.loaders_ = [];
    },
    dispose: function() {
      var i = this.loaders_.length;
      while (i--) {
        this.loaders_[i].dispose();
      }
    },

    addLoader: function() {
      var segmentLoader = new SegmentLoader(), self = this;
      segmentLoader.on('change', function() {
        self.checkBuffers_();
      });
      segmentLoader.on(['progress', 'timeout', 'error'], function() {
        self.checkBuffers_();
      });
      return this.loaders_.push(segmentLoader);
    },
    loader: function(index) {
      return this.loaders_[index];
    },
    checkBuffers_: function() {
      var lowestBuffer;

      // if there is a request already in flight do nothing
      if (this.loading_()) {
        return;
      }

      // fetch a new segment from the loader that needs the most
      // content
      lowestBuffer = this.loaders_.slice().sort(byDesiredBuffer)[0];
      if (lowestBuffer.desiredBuffer() > 0) {
        this.xhr_ = lowestBuffer.fetch();
      }
    },

    loading_: function() {
      var i = this.loaders_.length;
      while (i--) {
        if (this.loaders_[i].xhr_) {
          return true;
        }
      }
      return false;
    }
  });

  // exports
  videojs.Hls.SegmentLoader = SegmentLoader;
  videojs.Hls.SegmentMultiLoader = SegmentMultiLoader;

})(window, window.videojs);

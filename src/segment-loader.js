/**
 * segment-loader
 * An object that manages fetching segments from one or more media
 * playlists to keep the buffer full for playback.
 *
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
      this.buffer_ = [];
      this.checkBufferTimeout_ = null;
      this.baseUrl_ = window.location.href;
    },
    /**
     * Set the path that relative segment URLs will be resolved against.
     */
    baseUrl: function(url) {
      this.baseUrl_ = url;
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
     * Clean up any resources currently held by this segment loader so
     * it can be safely garbage collected.
     */
    dispose: function() {
      this.cancelXhr_();
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
      this.checkBuffer_();
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
        this.checkBuffer_(offset);
      }
      return this.mediaIndex_;
    },
    /**
     * Remove and return the least-recently downloaded segment.
     */
    shift: function() {
      var result = this.buffer_.shift();
      this.checkBuffer_();
      return result;
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

      return this.loadNextSegment_(resolveUrl(this.baseUrl_, segment.uri),
                                   offset);
    },
    loadNextSegment_: function(uri, offset) {
      // request the next segment
      this.xhr_ = videojs.Hls.xhr({
        uri: uri,
        responseType: 'arraybuffer',
        withCredentials: this.settings_.withCredentials
      }, function(error, request) {
        var segmentInfo;

        // the segment request is no longer outstanding
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
            message: 'HLS segment request error at URL: ' + uri,
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
        if (offset !== undefined) {
          segmentInfo.offset = offset;
        }
        if (segmentInfo.playlist.segments[segmentInfo.mediaIndex].key) {
          segmentInfo.encryptedBytes = new Uint8Array(request.response);
        } else {
          segmentInfo.bytes = new Uint8Array(request.response);
        }
        this.buffer_.push(segmentInfo);
        this.mediaIndex_++;
        this.trigger('progress');

        this.checkBuffer_();
      }.bind(this));
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

  // exports
  videojs.Hls.SegmentLoader = SegmentLoader;

})(window, window.videojs);

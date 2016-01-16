/**
 * segment-loader
 *
 * An object that manages segment loading and appending.
 *
 */
(function(window, videojs) {
  'use strict';

  var findRange = videojs.Hls.Ranges.findRange_;
  var findSoleUncommonTimeRangesEnd = videojs.Hls.Ranges.findSoleUncommonTimeRangesEnd_;
  var getMediaIndexForTime = videojs.Hls.Playlist.getMediaIndexForTime_;
  var duration = videojs.Hls.Playlist.duration;

  var CHECK_BUFFER_DELAY = 500; // ms

  videojs.Hls.SegmentLoader = videojs.extend(videojs.EventTarget, {
    constructor: function(options) {
      var settings;
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
      this.error_ = undefined;
      this.timestampOffset_ = 0;
      this.xhr_ = null;
      this.pendingSegment_ = null;
      this.sourceUpdater_ = new videojs.Hls.SourceUpdater(options.mediaSource,
                                                          'video/mp2t');
    },
    dispose: function() {
      this.abort_();
    },

    abort: function() {
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
    error: function(error) {
      if (error !== undefined) {
        this.error_ = error;
      }

      this.pendingSegment_ = null;
      return this.error_;
    },
    load: function() {
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
    playlist: function(media) {
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
    pause: function() {
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
    paused: function() {
      return this.checkBufferTimeout_ === null;
    },
    timestampOffset: function(offset) {
      this.timestampOffset_ = offset;
    },

    monitorBuffer_: function() {
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
    checkBuffer_: function(buffered, playlist, currentTime, timestampOffset) {
      var currentBuffered = findRange(buffered, currentTime),
          bufferedTime, currentBufferedEnd, discontinuity, segment, mediaIndex;

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
        if (bufferedTime >= videojs.Hls.GOAL_BUFFER_LENGTH) {
          return null;
        }
        mediaIndex = getMediaIndexForTime(playlist, currentBufferedEnd, timestampOffset);
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
        mediaIndex: mediaIndex,
        // the segment's playlist
        playlist: playlist,
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
        timestampOffset: timestampOffset
      };
    },

    abort_: function() {
      if (this.xhr_) {
        this.xhr_.abort();
      }

      // clear out the segment being processed
      this.pendingSegment_ = null;
    },

    fillBuffer_: function() {
      var request;

      // see if we need to begin loading immediately
      request = this.checkBuffer_(this.sourceUpdater_.buffered(),
                                  this.playlist_,
                                  this.currentTime_(),
                                  this.timestampOffset_);
      if (request) {
        this.loadSegment_(request);
      }
    },
    loadSegment_: function(segmentInfo) {
      var segment, requestTimeout, keyXhr, segmentXhr;

      segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
      // Set xhr timeout to 150% of the segment duration to allow us
      // some time to switch renditions in the event of a catastrophic
      // decrease in network performance or a server issue.
      requestTimeout = (segment.duration * 1.5) * 1000;

      if (segment.key) {
        keyXhr = videojs.Hls.xhr({
          uri: segment.key.resolvedUri,
          responseType: 'arraybuffer',
          withCredentials: this.withCredentials_,
          timeout: requestTimeout
        }, this.handleResponse_.bind(this));
      }
      this.pendingSegment_ = segmentInfo;
      segmentXhr = videojs.Hls.xhr({
        uri: segmentInfo.uri,
        responseType: 'arraybuffer',
        withCredentials: this.withCredentials_,
        timeout: requestTimeout
      }, this.handleResponse_.bind(this));

      this.xhr_ = {
        keyXhr: keyXhr,
        segmentXhr: segmentXhr,
        abort: function() {
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
    handleResponse_: function(error, request) {
      var segmentInfo, segment, segmentXhrRequest, keyXhrRequest, view;

      segmentInfo = this.pendingSegment_;
      segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

      // timeout of previously aborted request
      if (!this.xhr_ ||
          (request !== this.xhr_.segmentXhr && request !== this.xhr_.keyXhr)) {
        return;
      }

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
        segmentXhrRequest = this.xhr_.segmentXhr;
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
      }

      if (!this.xhr_.segmentXhr && !this.xhr_.keyXhr) {
        this.xhr_ = null;
        this.processResponse_();
      }
    },

    processResponse_: function() {
      var segmentInfo, playlist, segment, mediaIndex, segIv;

      this.state = 'DECRYPTING';

      segmentInfo = this.pendingSegment_;
      playlist = segmentInfo.playlist;
      mediaIndex = segmentInfo.mediaIndex;
      segment = playlist.segments[mediaIndex];

      if (segment.key) {
        // this is an encrypted segment
        // if the media sequence is greater than 2^32, the IV will be incorrect
        // assuming 10s segments, that would be about 1300 years
        segIv = segment.key.iv || new Uint32Array([0, 0, 0, mediaIndex + playlist.mediaSequence]);

        // incrementally decrypt the segment
        new videojs.Hls.Decrypter(segmentInfo.encryptedBytes,
                                  segment.key.bytes,
                                  segIv,
                                  (function(err, bytes) {
                                    segmentInfo.bytes = bytes;
                                    this.handleSegment_();
                                  }).bind(this));
      } else {
        this.handleSegment_();
      }
    },

    handleSegment_: function() {
      var segmentInfo;
      this.state = 'APPENDING';

      segmentInfo = this.pendingSegment_;
      segmentInfo.buffered = this.sourceUpdater_.buffered();

      if (segmentInfo.timestampOffset !== this.sourceUpdater_.timestampOffset()) {
        this.sourceUpdater_.timestampOffset(segmentInfo.timestampOffset);
      }

      this.sourceUpdater_.appendBuffer(segmentInfo.bytes,
                                       this.handleUpdateEnd_.bind(this));
    },

    handleUpdateEnd_: function() {
      var buffered, end, segments, segmentInfo;

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
    updateTimeline_: function(segmentInfo) {
      var currentMediaIndex, currentBuffered, segment, timelineUpdate;

      currentMediaIndex = segmentInfo.mediaIndex;
      currentMediaIndex += segmentInfo.playlist.mediaSequence - this.playlist_.mediaSequence;
      segment = segmentInfo.playlist.segments[currentMediaIndex];

      if (!segment) {
        return;
      }

      // !!The order of the next two assignments is important!!
      // `currentTime` must be equal-to or greater-than the start of the
      // buffered range. Flash executes out-of-process so, every value can
      // change behind the scenes from line-to-line. By reading `currentTime`
      // after `buffered`, we ensure that it is always a current or later
      // value during playback.
      currentBuffered = findRange(this.sourceUpdater_.buffered(),
                                  this.currentTime_());

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

})(window, window.videojs);

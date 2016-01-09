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
      this.paused_ = true;
      this.error_ = undefined;
      this.timestampOffset_ = 0;
      this.xhr_ = null;
      this.pendingSegment_ = null;
      this.sourceUpdater_ = new videojs.Hls.SourceUpdater(options.mediaSource);
    },
    dispose: function() {},

    abort: function() {
      if (this.state !== 'WAITING') {
        return;
      }

      if (this.xhr_) {
        // Prevent error handler from running.
        this.xhr_.onreadystatechange = null;
        this.xhr_.abort();
        this.xhr_ = null;
      }

      // clear out the segment being processed
      this.pendingSegment_ = null;

      // don't wait for buffer check timeouts to begin fetching the
      // next segment
      if (!this.paused_) {
        this.load();
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
      var request;
      if (!this.playlist_) {
        throw new TypeError('No playlist specified');
      }

      this.state = 'READY';
      this.paused_ = false;

      // see if we need to begin loading immediately
      request = this.checkBuffer_(this.sourceUpdater_.buffered(),
                                  this.playlist_,
                                  this.currentTime_(),
                                  this.timestampOffset_);
      if (request) {
        this.loadSegment_(request);
      }
    },
    playlist: function(media) {
      this.playlist_ = media;
    },
    pause: function() {
      this.paused_ = true;
    },
    paused: function() {
      return this.paused_;
    },
    timestampOffset: function(offset) {
      this.timestampOffset_ = offset;
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
        // optionally, the decrypter that is unencrypting the segment
        decrypter: null,
        // the state of the buffer before a segment is appended will be
        // stored here so that the actual segment duration can be
        // determined after it has been appended
        buffered: null,
        // The target timestampOffset for this segment when we append it
        // to the source buffer
        timestampOffset: timestampOffset
      };
    },

    loadSegment_: function(segmentInfo) {
      var segment;

      segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
      this.pendingSegment_ = segmentInfo;
      this.xhr_ = videojs.Hls.xhr({
        uri: segmentInfo.uri,
        responseType: 'arraybuffer',
        withCredentials: this.withCredentials_,
        // Set xhr timeout to 150% of the segment duration to allow us
        // some time to switch renditions in the event of a catastrophic
        // decrease in network performance or a server issue.
        timeout: (segment.duration * 1.5) * 1000
      }, this.handleResponse_.bind(this));

      this.state = 'WAITING';
    },
    // triggered when a segment response is received
    handleResponse_: function(error, request) {
      var segmentInfo, segment;

      // this is a timeout of a previously aborted segment request
      // so simply ignore it
      if (!this.xhr_ || request !== this.xhr_) {
        return;
      }

      // the segment request is no longer outstanding
      this.xhr_ = null;

      // if a segment request times out, reset bandwidth tracking
      if (request.timedout) {
        this.bandwidth = 1;
        this.roundTrip = NaN;
        this.pendingSegment_ = null;
        this.state = 'READY';
        return;
      }

      // trigger an event for other errors
      segmentInfo = this.pendingSegment_;
      if (!request.aborted && error) {
        this.error({
          status: request.status,
          message: 'HLS segment request error at URL: ' + segmentInfo.uri,
          code: 2,
          xhr: request
        });
        this.state = 'READY';
        this.pause();
        return this.trigger('error');
      }

      // stop processing if the request was aborted
      if (!request.response) {
        return;
      }

      // calculate the download bandwidth
      this.roundTrip = request.roundTripTime;
      this.bandwidth = request.bandwidth;
      this.bytesReceived += request.bytesReceived || 0;

      segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];
      if (segment.key) {
        segmentInfo.encryptedBytes = new Uint8Array(request.response);
      } else {
        segmentInfo.bytes = new Uint8Array(request.response);
      }

      this.processResponse_();
    },

    processResponse_: function() {
      this.state = 'DECRYPTING';

      this.handleSegment_();
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

      if (!this.paused_) {
        this.load();
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

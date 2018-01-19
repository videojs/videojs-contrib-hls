/**
 * @file playback-watcher.js
 *
 * Playback starts, and now my watch begins. It shall not end until my death. I shall
 * take no wait, hold no uncleared timeouts, father no bad seeks. I shall wear no crowns
 * and win no glory. I shall live and die at my post. I am the corrector of the underflow.
 * I am the watcher of gaps. I am the shield that guards the realms of seekable. I pledge
 * my life and honor to the Playback Watch, for this Player and all the Players to come.
 */

import window from 'global/window';
import Ranges from './ranges';
import videojs from 'video.js';

// Set of events that reset the playback-watcher time check logic and clear the timeout
const timerCancelEvents = [
  'seeking',
  'seeked',
  'pause',
  'playing',
  'error'
];

/**
 * @class PlaybackWatcher
 */
export default class PlaybackWatcher {
  /**
   * Represents an PlaybackWatcher object.
   * @constructor
   * @param {object} options an object that includes the tech and settings
   */
  constructor(options) {
    this.tech_ = options.tech;
    this.seekable = options.seekable;

    this.consecutiveUpdates = 0;
    this.lastRecordedTime = null;
    this.timer_ = null;
    this.checkCurrentTimeTimeout_ = null;

    if (options.debug) {
      this.logger_ = videojs.log.bind(videojs, 'playback-watcher ->');
    }
    this.logger_('initialize');

    let canPlayHandler = () => this.monitorCurrentTime_();
    let waitingHandler = () => this.techWaiting_();
    let cancelTimerHandler = () => this.cancelTimer_();
    let fixesBadSeeksHandler = () => this.fixesBadSeeks_();

    this.tech_.on('seekablechanged', fixesBadSeeksHandler);
    this.tech_.on('waiting', waitingHandler);
    this.tech_.on(timerCancelEvents, cancelTimerHandler);
    this.tech_.on('canplay', canPlayHandler);

    // Define the dispose function to clean up our events
    this.dispose = () => {
      this.logger_('dispose');
      this.tech_.off('seekablechanged', fixesBadSeeksHandler);
      this.tech_.off('waiting', waitingHandler);
      this.tech_.off(timerCancelEvents, cancelTimerHandler);
      this.tech_.off('canplay', canPlayHandler);
      if (this.checkCurrentTimeTimeout_) {
        window.clearTimeout(this.checkCurrentTimeTimeout_);
      }
      this.cancelTimer_();
    };
  }

  /**
   * Periodically check current time to see if playback stopped
   *
   * @private
   */
  monitorCurrentTime_() {
    this.checkCurrentTime_();

    if (this.checkCurrentTimeTimeout_) {
      window.clearTimeout(this.checkCurrentTimeTimeout_);
    }

    // 42 = 24 fps // 250 is what Webkit uses // FF uses 15
    this.checkCurrentTimeTimeout_ =
      window.setTimeout(this.monitorCurrentTime_.bind(this), 250);
  }

  /**
   * The purpose of this function is to emulate the "waiting" event on
   * browsers that do not emit it when they are waiting for more
   * data to continue playback
   *
   * @private
   */
  checkCurrentTime_() {
    if (this.tech_.seeking() && this.fixesBadSeeks_()) {
      this.consecutiveUpdates = 0;
      this.lastRecordedTime = this.tech_.currentTime();
      return;
    }

    if (this.tech_.paused() || this.tech_.seeking()) {
      return;
    }

    let currentTime = this.tech_.currentTime();
    let buffered = this.tech_.buffered();

    if (this.lastRecordedTime === currentTime &&
        (!buffered.length ||
         currentTime + Ranges.SAFE_TIME_DELTA >= buffered.end(buffered.length - 1))) {
      // If current time is at the end of the final buffered region, then any playback
      // stall is most likely caused by buffering in a low bandwidth environment. The tech
      // should fire a `waiting` event in this scenario, but due to browser and tech
      // inconsistencies (e.g. The Flash tech does not fire a `waiting` event when the end
      // of the buffer is reached and has fallen off the live window). Calling
      // `techWaiting_` here allows us to simulate responding to a native `waiting` event
      // when the tech fails to emit one.
      return this.techWaiting_();
    }

    if (this.consecutiveUpdates >= 5 &&
        currentTime === this.lastRecordedTime) {
      this.consecutiveUpdates++;
      this.waiting_();
    } else if (currentTime === this.lastRecordedTime) {
      this.consecutiveUpdates++;
    } else {
      this.consecutiveUpdates = 0;
      this.lastRecordedTime = currentTime;
    }
  }

  /**
   * Cancels any pending timers and resets the 'timeupdate' mechanism
   * designed to detect that we are stalled
   *
   * @private
   */
  cancelTimer_() {
    this.consecutiveUpdates = 0;

    if (this.timer_) {
      this.logger_('cancelTimer_');
      clearTimeout(this.timer_);
    }

    this.timer_ = null;
  }

  /**
   * Fixes situations where there's a bad seek
   *
   * @return {Boolean} whether an action was taken to fix the seek
   * @private
   */
  fixesBadSeeks_() {
    const seeking = this.tech_.seeking();
    const seekable = this.seekable();
    const currentTime = this.tech_.currentTime();
    let seekTo;

    if (seeking && this.afterSeekableWindow_(seekable, currentTime)) {
      const seekableEnd = seekable.end(seekable.length - 1);

      // sync to live point (if VOD, our seekable was updated and we're simply adjusting)
      seekTo = seekableEnd;
    }

    if (seeking && this.beforeSeekableWindow_(seekable, currentTime)) {
      const seekableStart = seekable.start(0);

      // sync to the beginning of the live window
      // provide a buffer of .1 seconds to handle rounding/imprecise numbers
      seekTo = seekableStart + Ranges.SAFE_TIME_DELTA;
    }

    if (typeof seekTo !== 'undefined') {
      this.logger_(`Trying to seek outside of seekable at time ${currentTime} with ` +
                  `seekable range ${Ranges.printableRange(seekable)}. Seeking to ` +
                  `${seekTo}.`);

      this.tech_.setCurrentTime(seekTo);
      return true;
    }

    return false;
  }

  /**
   * Handler for situations when we determine the player is waiting.
   *
   * @private
   */
  waiting_() {
    if (this.techWaiting_()) {
      return;
    }

    // All tech waiting checks failed. Use last resort correction
    let currentTime = this.tech_.currentTime();
    let buffered = this.tech_.buffered();
    let currentRange = Ranges.findRange(buffered, currentTime);

    // Sometimes the player can stall for unknown reasons within a contiguous buffered
    // region with no indication that anything is amiss (seen in Firefox). Seeking to
    // currentTime is usually enough to kickstart the player. This checks that the player
    // is currently within a buffered region before attempting a corrective seek.
    // Chrome does not appear to continue `timeupdate` events after a `waiting` event
    // until there is ~ 3 seconds of forward buffer available. PlaybackWatcher should also
    // make sure there is ~3 seconds of forward buffer before taking any corrective action
    // to avoid triggering an `unknownwaiting` event when the network is slow.
    if (currentRange.length && currentTime + 3 <= currentRange.end(0)) {
      this.cancelTimer_();
      this.tech_.setCurrentTime(currentTime);

      this.logger_(`Stopped at ${currentTime} while inside a buffered region ` +
        `[${currentRange.start(0)} -> ${currentRange.end(0)}]. Attempting to resume ` +
        `playback by seeking to the current time.`);

      // unknown waiting corrections may be useful for monitoring QoS
      this.tech_.trigger({type: 'usage', name: 'hls-unknown-waiting'});
      return;
    }
  }

  /**
   * Handler for situations when the tech fires a `waiting` event
   *
   * @return {Boolean}
   *         True if an action (or none) was needed to correct the waiting. False if no
   *         checks passed
   * @private
   */
  techWaiting_() {
    let seekable = this.seekable();
    let currentTime = this.tech_.currentTime();

    if (this.tech_.seeking() && this.fixesBadSeeks_()) {
      // Tech is seeking or bad seek fixed, no action needed
      return true;
    }

    if (this.tech_.seeking() || this.timer_ !== null) {
      // Tech is seeking or already waiting on another action, no action needed
      return true;
    }

    if (this.beforeSeekableWindow_(seekable, currentTime)) {
      let livePoint = seekable.end(seekable.length - 1);

      this.logger_(`Fell out of live window at time ${currentTime}. Seeking to ` +
                   `live point (seekable end) ${livePoint}`);
      this.cancelTimer_();
      this.tech_.setCurrentTime(livePoint);

      // live window resyncs may be useful for monitoring QoS
      this.tech_.trigger({type: 'usage', name: 'hls-live-resync'});
      return true;
    }

    let buffered = this.tech_.buffered();
    let nextRange = Ranges.findNextRange(buffered, currentTime);

    if (this.videoUnderflow_(nextRange, buffered, currentTime)) {
      // Even though the video underflowed and was stuck in a gap, the audio overplayed
      // the gap, leading currentTime into a buffered range. Seeking to currentTime
      // allows the video to catch up to the audio position without losing any audio
      // (only suffering ~3 seconds of frozen video and a pause in audio playback).
      this.cancelTimer_();
      this.tech_.setCurrentTime(currentTime);

      // video underflow may be useful for monitoring QoS
      this.tech_.trigger({type: 'usage', name: 'hls-video-underflow'});
      return true;
    }

    // check for gap
    if (nextRange.length > 0) {
      let difference = nextRange.start(0) - currentTime;

      this.logger_(
        `Stopped at ${currentTime}, setting timer for ${difference}, seeking ` +
        `to ${nextRange.start(0)}`);

      this.timer_ = setTimeout(this.skipTheGap_.bind(this),
                               difference * 1000,
                               currentTime);
      return true;
    }

    // All checks failed. Returning false to indicate failure to correct waiting
    return false;
  }

  afterSeekableWindow_(seekable, currentTime) {
    if (!seekable.length) {
      // we can't make a solid case if there's no seekable, default to false
      return false;
    }

    if (currentTime > seekable.end(seekable.length - 1) + Ranges.SAFE_TIME_DELTA) {
      return true;
    }

    return false;
  }

  beforeSeekableWindow_(seekable, currentTime) {
    if (seekable.length &&
        // can't fall before 0 and 0 seekable start identifies VOD stream
        seekable.start(0) > 0 &&
        currentTime < seekable.start(0) - Ranges.SAFE_TIME_DELTA) {
      return true;
    }

    return false;
  }

  videoUnderflow_(nextRange, buffered, currentTime) {
    if (nextRange.length === 0) {
      // Even if there is no available next range, there is still a possibility we are
      // stuck in a gap due to video underflow.
      let gap = this.gapFromVideoUnderflow_(buffered, currentTime);

      if (gap) {
        this.logger_(`Encountered a gap in video from ${gap.start} to ${gap.end}. ` +
                     `Seeking to current time ${currentTime}`);

        return true;
      }
    }

    return false;
  }

  /**
   * Timer callback. If playback still has not proceeded, then we seek
   * to the start of the next buffered region.
   *
   * @private
   */
  skipTheGap_(scheduledCurrentTime) {
    let buffered = this.tech_.buffered();
    let currentTime = this.tech_.currentTime();
    let nextRange = Ranges.findNextRange(buffered, currentTime);

    this.cancelTimer_();

    if (nextRange.length === 0 ||
        currentTime !== scheduledCurrentTime) {
      return;
    }

    this.logger_('skipTheGap_:',
                 'currentTime:', currentTime,
                 'scheduled currentTime:', scheduledCurrentTime,
                 'nextRange start:', nextRange.start(0));

    // only seek if we still have not played
    this.tech_.setCurrentTime(nextRange.start(0) + Ranges.TIME_FUDGE_FACTOR);

    this.tech_.trigger({type: 'usage', name: 'hls-gap-skip'});
  }

  gapFromVideoUnderflow_(buffered, currentTime) {
    // At least in Chrome, if there is a gap in the video buffer, the audio will continue
    // playing for ~3 seconds after the video gap starts. This is done to account for
    // video buffer underflow/underrun (note that this is not done when there is audio
    // buffer underflow/underrun -- in that case the video will stop as soon as it
    // encounters the gap, as audio stalls are more noticeable/jarring to a user than
    // video stalls). The player's time will reflect the playthrough of audio, so the
    // time will appear as if we are in a buffered region, even if we are stuck in a
    // "gap."
    //
    // Example:
    // video buffer:   0 => 10.1, 10.2 => 20
    // audio buffer:   0 => 20
    // overall buffer: 0 => 10.1, 10.2 => 20
    // current time: 13
    //
    // Chrome's video froze at 10 seconds, where the video buffer encountered the gap,
    // however, the audio continued playing until it reached ~3 seconds past the gap
    // (13 seconds), at which point it stops as well. Since current time is past the
    // gap, findNextRange will return no ranges.
    //
    // To check for this issue, we see if there is a gap that starts somewhere within
    // a 3 second range (3 seconds +/- 1 second) back from our current time.
    let gaps = Ranges.findGaps(buffered);

    for (let i = 0; i < gaps.length; i++) {
      let start = gaps.start(i);
      let end = gaps.end(i);

      // gap is starts no more than 4 seconds back
      if (currentTime - start < 4 && currentTime - start > 2) {
        return {
          start,
          end
        };
      }
    }

    return null;
  }

  /**
   * A debugging logger noop that is set to console.log only if debugging
   * is enabled globally
   *
   * @private
   */
  logger_() {}
}

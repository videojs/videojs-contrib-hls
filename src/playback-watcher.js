/**
 * @file playback-watcher.js
 */
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

    let waitingHandler = () => this.waiting_();
    let cancelTimerHandler = () => this.cancelTimer_();

    this.tech_.on('waiting', waitingHandler);
    this.tech_.on(timerCancelEvents, cancelTimerHandler);
    this.monitorCurrentTime_();

    // Define the dispose function to clean up our events
    this.dispose = () => {
      this.logger_('dispose');
      this.tech_.off('waiting', waitingHandler);
      this.tech_.off(timerCancelEvents, cancelTimerHandler);
      if (this.checkCurrentTimeTimeout_) {
        clearTimeout(this.checkCurrentTimeTimeout_);
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
      clearTimeout(this.checkCurrentTimeTimeout_);
    }

    // 42 = 24 fps // 250 is what Webkit uses // FF uses 15
    this.checkCurrentTimeTimeout_ = setTimeout(this.monitorCurrentTime_.bind(this), 250);
  }

  /**
   * The purpose of this function is to emulate the "waiting" event on
   * browsers that do not emit it when they are waiting for more
   * data to continue playback
   *
   * @private
   */
  checkCurrentTime_() {
    if (this.tech_.paused() || this.tech_.seeking()) {
      return;
    }

    let currentTime = this.tech_.currentTime();

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
   * Handler for situations when we determine the player is waiting
   *
   * @private
   */
  waiting_() {
    let seekable = this.seekable();
    let currentTime = this.tech_.currentTime();

    if (this.tech_.seeking() || this.timer_ !== null) {
      return;
    }

    if (this.fellOutOfLiveWindow_(seekable, currentTime)) {
      let livePoint = seekable.end(seekable.length - 1);

      this.logger_(`Fell out of live window at time ${currentTime}. Seeking to ` +
                   `live point (seekable end) ${livePoint}`);
      this.cancelTimer_();
      this.tech_.setCurrentTime(livePoint);

      return;
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
      return;
    }

    // check for gap
    if (nextRange.length > 0) {
      let difference = nextRange.start(0) - currentTime;

      this.logger_(`Stopped at ${currentTime}, setting timer for ${difference}, seeking ` +
                   `to ${nextRange.start(0)}`);

      this.timer_ = setTimeout(this.skipTheGap_.bind(this),
                               difference * 1000,
                               currentTime);
    }
  }

  fellOutOfLiveWindow_(seekable, currentTime) {
    if (seekable.length &&
        // can't fall before 0 and 0 seekable start identifies VOD stream
        seekable.start(0) > 0 &&
        currentTime < seekable.start(0)) {
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

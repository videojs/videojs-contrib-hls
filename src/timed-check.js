/**
 * @file timed-check.js
 */
import videojs from 'video.js';

// Set of events that reset the timed-check logic and clear the timeout
const timerCancelEvents = [
  'seeking',
  'seeked',
  'pause',
  'playing',
  'error'
];

/**
 * Timed Check
 *
 * Timed Checks provide a mechanism for performing an action after playback has stopped
 * for a non-user reason.
 *
 * @class TimedCheck
 */
export default class TimedCheck {
  /**
   * Represents a TimedCheck object.
   * @constructor
   * @param {object} options an object that includes the tech and settings
   */
  constructor(options) {
    this.tech_ = options.tech;
    this.consecutiveUpdates = 0;
    this.lastRecordedTime = null;
    this.timer_ = null;
    this.checkCurrentTimeTimeout_ = null;

    if (options.debug) {
      this.logger_ = videojs.log.bind(videojs, 'timed-check ->');
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
   * Periodically check for timeupdates
   *
   * @private
   */
  monitorCurrentTime_() {
    if (!this.tech_.el_) {
      return;
    }

    this.checkCurrentTime_();

    if (this.checkCurrentTimeTimeout_) {
      clearTimeout(this.checkCurrentTimeTimeout_);
    }

    // 42 = 24 fps // 250 is what Webkit uses // FF uses 15
    this.checkCurrentTimeTimeout_ = setTimeout(this.monitorCurrentTime_.bind(this), 250);
  }

  /**
   * Handler for `waiting` events from the player
   *
   * @private
   */
  waiting_() {
    // implement in inheritors
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
   * A debugging logger noop that is set to console.log only if debugging
   * is enabled globally
   *
   * @private
   */
  logger_() {}
}

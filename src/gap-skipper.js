/**
 * @file gap-skipper.js
 */
import Ranges from './ranges';
import videojs from 'video.js';

/**
 * the gap skipper object handles all scenarios
 * where the player runs into the end of a buffered
 * region and there is a buffered region ahead.
 * It then handles the skipping behavior.
 *
 * @class GapSkipper
 */
export default class GapSkipper {
  /**
   * Represents a GapSKipper object.
   * @constructor
   * @param {object} options an object that includes the tech and settings
   */
  constructor(options) {
    if (!options.tech.options_.playerId) {
      return;
    }

    this.player_ = videojs(options.tech.options_.playerId);
    this.tech_ = options.tech;
    this.consecutiveUpdates = 0;
    this.lastRecordedTime = null;
    this.timer_ = null;

    if (options.debug) {
      this.logger_ = videojs.log.bind(videojs, '<gap-skipper>');
    }
    this.logger_('<initialize>');

    let waitingHandler = () => {
      if (!this.tech_.seeking()) {
        this.setTimer_();
      }
    };

    // The purpose of this function is to emulate the "waiting" event on
    // browsers that do not emit it when they are waiting for more
    // data to continue playback
    let timeupdateHandler = () => {
      if (this.player_.paused() || this.player_.seeking()) {
        return;
      }

      let currentTime = this.player_.currentTime();

      if (this.consecutiveUpdates === 5 &&
          currentTime === this.lastRecordedTime) {
        this.consecutiveUpdates++;
        waitingHandler();
      } else if (currentTime === this.lastRecordedTime) {
        this.consecutiveUpdates++;
      } else {
        this.consecutiveUpdates = 0;
        this.lastRecordedTime = currentTime;
      }
    };

    // Set of events that reset the gap-skipper logic and clear the timeout
    let timerCancelEvents = [
      'seeking',
      'seeked',
      'pause',
      'playing',
      'error'
    ];

    let cancelTimerHandler = this.cancelTimer_.bind(this);

    this.player_.on('waiting', waitingHandler);
    this.player_.on('timeupdate', timeupdateHandler);
    this.player_.on(timerCancelEvents, cancelTimerHandler);

    this.dispose = () => {
      this.logger_('<dispose>');
      this.player_.off('waiting', waitingHandler);
      this.player_.off('timeupdate', timeupdateHandler);
      this.player_.off(timerCancelEvents, cancelTimerHandler);
      this.cancelTimer_();
    };
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
      this.logger_('<cancelTimer_> clearing timer');
      clearTimeout(this.timer_);
    }

    this.timer_ = null;
  }

  /**
   * Timer callback. If playback still has not proceeded, then we seek
   * to the start of the next buffered region.
   *
   * @private
   */
  skipTheGap_(scheduledCurrentTime) {
    let buffered = this.player_.buffered();
    let currentTime = this.player_.currentTime();
    let nextRange = Ranges.findNextRange(buffered, currentTime);

    this.consecutiveUpdates = 0;
    this.timer_ = null;

    if (nextRange.length === 0 ||
        currentTime !== scheduledCurrentTime) {
      return;
    }

    this.logger_('<skipTheGap_>',
                 'currentTime:', currentTime,
                 'scheduled currentTime:', scheduledCurrentTime,
                 'nextRange start:', nextRange.start(0));

    // only seek if we still have not played
    this.player_.currentTime(nextRange.start(0) + Ranges.TIME_FUDGE_FACTOR);
  }

  /**
   * Set a timer to skip the unbuffered region.
   *
   * @private
   */
  setTimer_() {
    let buffered = this.player_.buffered();
    let currentTime = this.player_.currentTime();
    let nextRange = Ranges.findNextRange(buffered, currentTime);

    if (nextRange.length === 0 ||
        this.timer_ !== null) {
      return;
    }

    let difference = nextRange.start(0) - currentTime;

    this.logger_('<setTimer_>',
                 'stopped at:', currentTime,
                 'setting timer for:', difference,
                 'seeking to:', nextRange.start(0));

    this.timer_ = setTimeout(this.skipTheGap_.bind(this),
                             difference * 1000,
                             currentTime);
  }

  /**
   * A debugging logger noop that is set to console.log only if debugging
   * is enabled globally
   *
   * @private
   */
  logger_() {}

  /**
   * A noop to ensure there is always have a dispose function even if there
   * was no playerId in the global options and therefore the gapSkipper was
   * never properly initialized
   *
   * @private
   */
  dispose() {}
}

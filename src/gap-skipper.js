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

    this.player = videojs(options.tech.options_.playerId);
    this.tech_ = options.tech;
    this.consecutiveUpdates = 0;
    this.timer = null;
    this.lastRecordedTime = null;

    if (options.debug) {
      this.logger_ = videojs.log.bind(videojs, '<gap-skipper>');
    }

    this.player.one('canplaythrough', () => {
      this.player.on('waiting', () => {
        this.setTimer_();
      });

      // The purpose of this function is to emulate the "waiting" event on
      // browsers that do not emit it when they are stalled waiting for
      // more data
      this.player.on('timeupdate', () => {
        if (this.player.paused()) {
          return;
        }

        let currentTime = this.player.currentTime();

        if (this.consecutiveUpdates === 5 &&
            currentTime === this.lastRecordedTime) {

          // trigger waiting
          this.player.trigger('waiting');
          this.consecutiveUpdates++;
        } else if (currentTime === this.lastRecordedTime) {
          this.consecutiveUpdates++;
        } else {
          this.consecutiveUpdates = 0;
          this.lastRecordedTime = currentTime;
        }
      });

      // Set of conditions that reset the gap-skipper logic
      [
        'seeking',
        'seeked',
        'pause',
        'playing',
        'error'
      ].forEach((event) => {
        this.player.on(event, () => {
          this.cancelTimer_();
        });
      });
    });
  }

  /**
  * Cancels any pending timers and resets the 'timeupdate' mechanism
  * designed to detect that we are stalled
  *
  * @private
  */
  cancelTimer_() {
    this.consecutiveUpdates = 0;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = null;
  }

  /**
  * Timer callback. If playback still has not proceeded, then we seek
  * to the start of the next buffered region.
  *
  * @private
  */
  skipTheGap_(scheduledCurrentTime) {
    let buffered = this.player.buffered();
    let currentTime = this.player.currentTime();
    let nextRange = Ranges.findNextRange(buffered, currentTime);

    this.consecutiveUpdates = 0;
    this.timer = null;

    this.logger_('timer triggered');

    if (nextRange.length === 0) {
      return;
    }

    this.logger_('currentTime:', currentTime, 'scheduled currentTime:', scheduledCurrentTime, 'nextRange start:', nextRange.start(0));

    if (currentTime !== scheduledCurrentTime) {
      return;
    }

    this.logger_('seeking to', nextRange.start(0) + Ranges.TIME_FUDGE_FACTOR);

    // only seek if we still have not played
    this.player.currentTime(nextRange.start(0) + Ranges.TIME_FUDGE_FACTOR);
  }

  /**
  * Set a timer to skip the unbuffered region.
  *
  * @private
  */
  setTimer_() {
    this.logger_('triggered. currentTime:', this.player.currentTime());

    let buffered = this.player.buffered();
    let currentTime = this.player.currentTime();
    let nextRange = Ranges.findNextRange(buffered, currentTime);

    if (nextRange.length === 0) {
      return;
    }

    this.logger_('nextRange start:', nextRange.start(0));

    if (this.timer !== null) {
      return;
    }

    let difference = nextRange.start(0) - currentTime;

    this.logger_('setting timer for', difference, 'seconds');
    this.timer = setTimeout(this.skipTheGap_.bind(this), difference * 1000, currentTime);
  }

  /**
  * A logger_ noop that is set to console.log if debugging is enabled globally.
  *
  * @private
  */
  logger_() {}
}

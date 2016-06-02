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
  */
  constructor(options) {
    if (!options.tech.options_.playerId) {
      return;
    }

    this.player = videojs(options.tech.options_.playerId);
    this.tech_ = options.tech;
    this.seeking = false;
    this.consecutiveUpdates = 0;
    this.timer = null;
    this.playerState = null;
    this.lastRecordedTime = null;

    this.player.on('timeupdate', () => {
      if (this.player.paused()) {
        return;
      }
      let currentTime = this.player.currentTime();

      if (this.consecutiveUpdates === 5 &&
          currentTime === this.lastRecordedTime) {
        // trigger waiting
        if (this.playerState !== 'waiting') {
          this.consecutiveUpdates = 0;
          this.playerState = 'waiting';
          this.skipTheGap();
        }
      } else if (currentTime === this.lastRecordedTime) {
        this.consecutiveUpdates++;
      } else {
        this.consecutiveUpdates = 0;
        this.lastRecordedTime = currentTime;
      }
    });

    // Don't listen for waiting while seeking
    this.player.on('seeking', () => {
      this.seeking = true;
    });

    // Listen for waiting when finished seeking
    this.player.on('seeked', () => {
      this.seeking = false;
    });

    this.player.on('playing', () => {
      this.player.on('waiting', this.skipTheGap);
    });

    this.player.on('error', () => {
      if (this.timer) {
        clearTimeout(this.timer);
      }
    });
  }

  /**
  * Set a timer to skip the unbuffered region.
  *
  * @private
  */
  skipTheGap() {

    if (this.seeking) {
      return;
    }

    let buffered = this.player.buffered();
    let currentTime = this.player.currentTime();
    let nextRange = Ranges.findNextRange(buffered, currentTime);

    if (nextRange.length === 0) {
      return;
    }

    let difference = nextRange.start(0) - currentTime;

    this.timer = setTimeout(() => {
      if (this.player.currentTime() === currentTime) {
        // only seek if we still have not played
        this.player.currentTime(nextRange.start(0) + Ranges.TIME_FUDGE_FACTOR);
        this.playerState = 'playing';
      }
    }, difference * 1000);
  }
}

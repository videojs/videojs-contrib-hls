import Ranges from './ranges';
import videojs from 'video.js';

export default class gapSkipper extends videojs.EventTarget {
  constructor(options) {
    super();
    if (options.tech.options_.playerId) {
      let self = this;

      this.player = videojs(options.tech.options_.playerId);
      this.tech_ = options.tech;
      this.seeking = false;
      this.consecutiveUpdates = 0;
      this.timer = null;
      this.playerState = null;
      this.lastRecordedTime = null;

      this.player.on('timeupdate', function() {
        if (self.player.paused()) {
          return;
        }
        let currentTime = self.player.currentTime();

        if (self.consecutiveUpdates === 5 &&
            currentTime === self.lastRecordedTime) {
          // trigger waiting
          if (self.playerState !== 'waiting') {
            self.consecutiveUpdates = 0;
            self.playerState = 'waiting';
            self.skipTheGap();
          }
        } else if (currentTime === self.lastRecordedTime) {
          self.consecutiveUpdates++;
        } else {
          self.consecutiveUpdates = 0;
          self.lastRecordedTime = currentTime;
        }
      });

      // Don't listen for waiting while seeking
      this.player.on('seeking', function() {
        self.seeking = true;
      });

      // Listen for waiting when finished seeking
      this.player.on('seeked', function() {
        self.seeking = false;
      });

      this.player.on('playing', function() {
        self.player.on('waiting', self.skipTheGap);
      });

      this.player.on('error', function() {
        if (self.timer) {
          clearTimeout(self.timer);
        }
      });
    }
  }

  skipTheGap() {
    let self = this;

    if (!this.seeking) {
      let buffered = this.player.buffered();
      let currentTime = this.player.currentTime();

      if (buffered.length > 0) {
        let nextRange = Ranges.findNextRange(buffered, currentTime);

        if (nextRange.length > 0) {
          let difference = nextRange.start(0) - currentTime;

          this.timer = setTimeout(function() {
            if (self.player.currentTime() === currentTime) {
              // only seek if we still have not played
              self.player.currentTime(nextRange.start(0) + Ranges.TIME_FUDGE_FACTOR);
              self.playerState = 'playing';
            }
          }, difference * 1000);
        }
      }
    }
  }
}

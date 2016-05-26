import Ranges from './ranges';

let seekingObject;

const gapSkipper = function() {
  this.ready(() => {
    seekingObject = { player: this,
                      tech: this.tech_,
                      seeking: false,
                      consecutiveUpdates: 0,
                      timer: null,
                      playerState: null,
                      lastRecordedTime: null,
                      adaptiveSeeking: null };

    seekingObject.skipTheGap = function() {
      if (!seekingObject.seeking) {
        let buffered = seekingObject.player.buffered();
        let currentTime = seekingObject.player.currentTime();

        if (buffered.length > 0) {
          let nextRange = Ranges.findNextRange(buffered, currentTime);

          if (nextRange.length > 0) {
            let difference = nextRange.start(0) - currentTime;

            seekingObject.timer = setTimeout(function() {
              if (seekingObject.player.currentTime() === currentTime) {
                // only seek if we still have not played
                seekingObject.player.currentTime(nextRange.start(0));
                seekingObject.playerState = 'playing';
              }
            }, difference * 1000);
          }
        }
      }
    };

    // Allows us to mimic a waiting event in chrome
    seekingObject.player.on('timeupdate', function() {
      if (seekingObject.player.paused()) {
        return;
      }
      let currentTime = seekingObject.player.currentTime();

      if (seekingObject.consecutiveUpdates === 5 &&
          currentTime === seekingObject.lastRecordedTime) {
        // trigger waiting
        if (seekingObject.playerState !== 'waiting') {
          seekingObject.consecutiveUpdates = 0;
          seekingObject.playerState = 'waiting';
          seekingObject.skipTheGap();
        }
      } else if (currentTime === seekingObject.lastRecordedTime) {
        seekingObject.consecutiveUpdates++;
      } else {
        seekingObject.consecutiveUpdates = 0;
        seekingObject.lastRecordedTime = currentTime;
      }
    });

    // Don't listen for waiting while seeking
    seekingObject.player.on('seeking', function() {
      seekingObject.seeking = true;
    });

    // Listen for waiting when finished seeking
    seekingObject.player.on('seeked', function() {
      seekingObject.seeking = false;
    });

    seekingObject.player.on('playing', function() {
      seekingObject.player.on('waiting', seekingObject.skipTheGap);
    });

    seekingObject.player.on('error', function() {
      if (seekingObject.timer) {
        clearTimeout(seekingObject.timer);
      }
    });
  });
};

export default gapSkipper;

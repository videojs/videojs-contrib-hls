import videojs from 'video.js';
import Ranges from './ranges';

let seeking = false;
let consecutiveUpdates = 0;
let timer = null;
let playerState;
let lastRecordedTime;
let adaptiveSeeking;
let player;

const gapSkipper = function(playerId, tech) {
  if (playerId) {
    player = videojs(playerId);

    // Allows us to mimic a waiting event in chrome
    player.on('timeupdate', function() {
      if (player.paused()) {
        return;
      }
      let currentTime = player.currentTime();

      if (consecutiveUpdates === 5 && currentTime === lastRecordedTime) {
        // trigger waiting
        if (playerState !== 'waiting') {
          consecutiveUpdates = 0;
          playerState = 'waiting';
          tech.trigger('adaptive-seeking');
        }
      } else if (currentTime === lastRecordedTime) {
        consecutiveUpdates++;
      } else {
        consecutiveUpdates = 0;
        lastRecordedTime = currentTime;
      }
    });

    // Don't listen for waiting while seeking
    player.on('seeking', function() {
      seeking = true;
    });

    // Listen for waiting when finished seeking
    player.on('seeked', function() {
      seeking = false;
    });

    tech.on('playing', function() {
      tech.on('waiting', adaptiveSeeking);
    });

    tech.on('adaptive-seeking', adaptiveSeeking);

    tech.on('error', function() {
      if (timer) {
        clearTimeout(timer);
      }
    });
  }
};

adaptiveSeeking = function() {
  if (!seeking) {
    let buffered = player.buffered();
    let currentTime = player.currentTime();

    if (buffered.length > 0) {
      let nextRange = Ranges.findNextRange(buffered, currentTime);

      if (nextRange.length > 0) {
        let difference = nextRange.start(0) - currentTime;

        timer = setTimeout(function() {
          if (player.currentTime() === currentTime) {
            // only seek if we still have not played
            player.currentTime(nextRange.start(0));
            playerState = 'playing';
          }
        }, difference * 1000);
      }
    }
  }
};

export default gapSkipper;

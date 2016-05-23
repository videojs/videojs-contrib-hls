import Ranges from './ranges';

let adaptiveSeeking;
let gapSkipper;
let seekingObject;

gapSkipper = function(options) {
  seekingObject = { player: this,
                    tech: options.tech,
                    seeking: false,
                    consecutiveUpdates: 0,
                    timer: null,
                    playerState: null,
                    lastRecordedTime: null,
                    adaptiveSeeking: null };

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
        seekingObject.tech.trigger('adaptive-seeking');
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

  seekingObject.tech.on('playing', function() {
    seekingObject.tech.on('waiting', adaptiveSeeking);
  });

  seekingObject.tech.on('adaptive-seeking', adaptiveSeeking);

  seekingObject.tech.on('error', function() {
    if (seekingObject.timer) {
      clearTimeout(seekingObject.timer);
    }
  });
};

adaptiveSeeking = function() {
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

export default gapSkipper;

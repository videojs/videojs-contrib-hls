/**
 * Reload the source when an error is detected as long as there
 * wasn't an error previously within the last 30 seconds
 */
const reloadSourceOnError = function() {
  const player = this;
  let lastCalled = 0;
  const reloadSource = function() {
    let sourceObj = player.currentSource();
    let seekTo = (player.duration() !== Infinity && player.currentTime()) || 0;

    if (Date.now() - lastCalled < 30 * 1000) {
      return;
    }
    lastCalled = Date.now();

    if (seekTo) {
      player.one('loadedmetadata', () => {
        player.currentTime(seekTo);
      });
    }

    player.src(sourceObj);
    player.play();
  };

  player.on('error', reloadSource);
  player.on('dispose', () => {
    player.off('error', reloadSource);
  });
};

export default reloadSourceOnError;

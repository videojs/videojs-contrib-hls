import videojs from 'video.js';

const defaultOptions = {
  errorInterval: 30
};

const initPlugin = function(player, options) {
  let lastCalled = 0;
  let seekTo = 0;
  let localOptions = videojs.mergeOptions(defaultOptions, options);

  const loadedMetadataHandler = function() {
    if (seekTo) {
      player.currentTime(seekTo);
    }
  };

  const getSource = function(next) {
    let tech = player.tech({ IWillNotUseThisInPlugins: true });
    let sourceObj = tech.currentSource_;

    return next(sourceObj);
  };

  const setSource = function(sourceObj) {
    seekTo = (player.duration() !== Infinity && player.currentTime()) || 0;

    // Do not attempt to reload the source if a source-reload occurred before
    // 'errorInterval' time has elapsed since the last source-reload
    if (Date.now() - lastCalled < localOptions.errorInterval * 1000) {
      return;
    }
    lastCalled = Date.now();

    player.one('loadedmetadata', loadedMetadataHandler);

    player.src(sourceObj);
    player.play();
  };

  const reloadSource = function() {
    if (localOptions.getSource &&
        typeof localOptions.getSource === 'function') {
      return localOptions.getSource(setSource);
    }

    return getSource(setSource);
  };

  const cleanupEvents = function() {
    player.off('loadedmetadata', loadedMetadataHandler);
    player.off('error', reloadSource);
    player.off('dispose', cleanupEvents);
  };

  const reinitPlugin = function(newOptions) {
    cleanupEvents();
    initPlugin(player, newOptions);
  };

  player.on('error', reloadSource);
  player.on('dispose', cleanupEvents);
  player.reloadSourceOnError = reinitPlugin;
};

/**
 * Reload the source when an error is detected as long as there
 * wasn't an error previously within the last 30 seconds
 */
const reloadSourceOnError = function(options) {
  initPlugin(this, options);
};

export default reloadSourceOnError;

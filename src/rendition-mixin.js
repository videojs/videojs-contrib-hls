let enableFunction = (playlist, changePlaylistFn, enable) => {
  let currentlyEnabled = typeof playlist.excludeUntil === 'undefined' ||
                         playlist.excludeUntil <= Date.now();

  if (typeof enable === 'undefined') {
    return currentlyEnabled;
  }

  if (enable !== currentlyEnabled) {
    if (enable) {
      delete playlist.excludeUntil;
    } else {
      playlist.excludeUntil = Infinity;
    }

    // Ensure the outside world knows about our changes
    changePlaylistFn();
  }

  return enable;
};

class Representation {
  constructor(hlsHandler, playlist, id) {
    let fastChangeFunction = hlsHandler
                              .masterPlaylistController_
                              .fastQualityChange_
                              .bind(hlsHandler.masterPlaylistController_);

    if (playlist.attributes) {
      let attributes = playlist.attributes;

      if (attributes.RESOLUTION) {
        let resolution = attributes.RESOLUTION;

        this.width = resolution.width;
        this.height = resolution.height;
      }

      this.bandwidth = attributes.BANDWIDTH;
    }

    // The id is simply the ordinality of the media playlist
    // within the master playlist
    this.id = id;

    // Partially-apply the enableFunction to create a playlist-
    // specific variant
    this.enabled = enableFunction.bind(this, playlist, fastChangeFunction);
  }
}

let renditionSelectionMixin = function(hlsHandler) {
  let playlists = hlsHandler.playlists;

  // Add a single API-specific function to the HlsHandler instance
  hlsHandler.representations = () => {
    return playlists
      .master
      .playlists
      .map((e, i) => new Representation(hlsHandler, e, i));
  };
};

export default renditionSelectionMixin;

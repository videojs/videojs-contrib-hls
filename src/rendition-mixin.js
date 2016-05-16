export default function RenditionSelectionMixin(hlsHandler) {
  let playlists = hlsHandler.playlists;

  hlsHandler.representations = () => {
    return playlists
      .master
      .playlists
      .map((e, i) => new Representation(hlsHandler, e, i));
  }
};

class Representation {
  constructor (hlsHandler, playlist, id) {
    if (playlist.attributes) {
      let attributes = playlist.attributes;

      if (attributes.RESOLUTION) {
        let resolution = attributes.RESOLUTION;

        this.width = resolution.width;
        this.height = resolution.height;
      }

      this.bandwidth = attributes.BANDWIDTH;
    }
    this.id = id;

    this.enabled = (enable) => {
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

        // Change quality as soon as possible
        hlsHandler.masterPlaylistController_.fastQualityChange_();
      }

      return enable;
    };
  }
}

import { isBlacklisted, isEnabled } from './playlist.js';
/**
 * Enable/disable playlist function. It is intended to have the first two
 * arguments partially-applied in order to create the final per-playlist
 * function.
 *
 * @param {PlaylistLoader} playlist - The rendition or media-playlist
 * @param {Function} changePlaylistFn - A function to be called after a
 * playlist's enabled-state has been changed. Will NOT be called if a
 * playlist's enabled-state is unchanged
 * @param {Boolean=} enable - Value to set the playlist enabled-state to
 * or if undefined returns the current enabled-state for the playlist
 * @return {Boolean} The current enabled-state of the playlist
 */
const enableFunction = (loader, playlistUri, changePlaylistFn, enable) => {
  const playlist = loader.master.playlists[playlistUri];
  const blacklisted = isBlacklisted(playlist);
  const currentlyEnabled = isEnabled(playlist);

  if (typeof enable === 'undefined') {
    return currentlyEnabled;
  }

  if (enable) {
    delete playlist.disabled;
  } else {
    playlist.disabled = true;
  }

  if (enable !== currentlyEnabled && !blacklisted) {
    // Ensure the outside world knows about our changes
    changePlaylistFn();
  }

  return enable;
};

/**
 * The representation object encapsulates the publicly visible information
 * in a media playlist along with a setter/getter-type function (enabled)
 * for changing the enabled-state of a particular playlist entry
 *
 * @class Representation
 */
class Representation {
  constructor(hlsHandler, playlist, id) {
    // Get a reference to a bound version of fastQualityChange_
    let fastChangeFunction = hlsHandler
                              .masterPlaylistController_
                              .fastQualityChange_
                              .bind(hlsHandler.masterPlaylistController_);

    // Carefully descend into the playlist's attributes since most
    // properties are optional
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
    this.enabled = enableFunction.bind(this,
                                       hlsHandler.playlists,
                                       playlist.uri,
                                       fastChangeFunction);
  }
}

/**
 * A mixin function that adds the `representations` api to an instance
 * of the HlsHandler class
 * @param {HlsHandler} hlsHandler - An instance of HlsHandler to add the
 * representation API into
 */
let renditionSelectionMixin = function(hlsHandler) {
  let playlists = hlsHandler.playlists;

  // Add a single API-specific function to the HlsHandler instance
  hlsHandler.representations = () => {
    return playlists
      .master
      .playlists
      .filter((media) => !isBlacklisted(media))
      .map((e, i) => new Representation(hlsHandler, e, e.uri));
  };
};

export default renditionSelectionMixin;

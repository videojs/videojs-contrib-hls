import { isBlacklisted, isEnabled } from './playlist.js';

/**
 * The representation object encapsulates the publicly visible information
 * in a media playlist along with a setter/getter-type function (enabled)
 * for changing the enabled-state of a particular playlist entry
 *
 * @class Representation
 */
class Representation {
  constructor(hlsHandler, playlist, id) {

    this.hls_ = hlsHandler;
    this.playlist_ = playlist;

    // Get a reference to a bound version of fastQualityChange_
    this.fastChangeFunc_ = hlsHandler
                              .masterPlaylistController_
                              .fastQualityChange_
                              .bind(hlsHandler.masterPlaylistController_);

    this.smoothChangeFunc_ = hlsHandler
                              .masterPlaylistController_
                              .smoothQualityChange_
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
  }

  flush() {
    this.flushing_ = true;
  }

  /**
   * Enable/disable playlist function.
   *
   * @return {Boolean} The current enabled-state of the playlist
   */
  enabled(enable) {

    const hlsHandler = this.hls_;

    const playlistUri = this.playlist_.uri;
    const loader = hlsHandler.playlists;

    const playlist = loader.master.playlists[playlistUri];
    const blacklisted = isBlacklisted(playlist);
    const currentlyEnabled = isEnabled(playlist);
    const smoothChangeFunction = this.smoothChangeFunc_;
    const fastChangeFunction = this.fastChangeFunc_;

    if (typeof enable === 'undefined') {
      return currentlyEnabled;
    }

    let changePlaylistFn = hlsHandler.options_.smoothQualitySwitch ?
        smoothChangeFunction : fastChangeFunction;

    if (hlsHandler.options_.disableImmediateQualityChange) {
      changePlaylistFn = null;
    }

    if (this.flushing_) {
      changePlaylistFn = this.fastChangeFunc_;
      this.flushing_ = false;
    }

    if (enable) {
      delete playlist.disabled;
    } else {
      playlist.disabled = true;
    }

    if (enable !== currentlyEnabled && !blacklisted) {
      // Ensure the outside world knows about our changes
      if (changePlaylistFn) {
        changePlaylistFn();
      }
      if (enable) {
        loader.trigger('renditionenabled');
      } else {
        loader.trigger('renditiondisabled');
      }
    }

    return enable;
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

/**
 * @file hls-audio-track.js
 */
import {AudioTrack} from 'video.js';
import PlaylistLoader from './playlist-loader';

/**
 * HlsAudioTrack extends video.js audio tracks but adds HLS
 * specific data storage such as playlist loaders, mediaGroups
 * and default/autoselect
 *
 * @param {Object} options options to create HlsAudioTrack with
 * @class HlsAudioTrack
 * @extends AudioTrack
 */
export default class HlsAudioTrack extends AudioTrack {
  constructor(options) {
    super({
      kind: options.default ? 'main' : 'alternative',
      enabled: options.default || false,
      language: options.language,
      label: options.label
    });

    this.hls = options.hls;
    this.autoselect = options.autoselect || false;
    this.default = options.default || false;
    this.withCredentials = options.withCredentials || false;
    this.mediaGroups_ = [];
    this.addLoader(options.mediaGroup, options.resolvedUri);
  }

  /**
   * get a PlaylistLoader from this track given a mediaGroup name
   *
   * @param {String} mediaGroup the mediaGroup to get the loader for
   * @return {PlaylistLoader|Null} the PlaylistLoader or null
   */
  getLoader(mediaGroup) {
    for (let i = 0; i < this.mediaGroups_.length; i++) {
      let mgl = this.mediaGroups_[i];

      if (mgl.mediaGroup === mediaGroup) {
        return mgl.loader;
      }
    }
  }

  /**
   * add a PlaylistLoader given a mediaGroup, and a uri. for a combined track
   * we store null for the playlistloader
   *
   * @param {String} mediaGroup the mediaGroup to get the loader for
   * @param {String} uri the uri to get the audio track/mediaGroup from
   */
  addLoader(mediaGroup, uri = null) {
    let loader = null;

    if (uri) {
      // TODO: this should probably happen upstream in Master Playlist
      // Controller when we can switch PlaylistLoader sources
      // then we can just store the uri here instead
      loader = new PlaylistLoader(uri, this.hls, this.withCredentials);
    }
    this.mediaGroups_.push({mediaGroup, loader});
  }

  /**
   * remove a playlist loader from a track given the mediaGroup
   *
   * @param {String} mediaGroup the mediaGroup to remove
   */
  removeLoader(mediaGroup) {
    for (let i = 0; i < this.mediaGroups_.length; i++) {
      let mgl = this.mediaGroups_[i];

      if (mgl.mediaGroup === mediaGroup) {
        if (mgl.loader) {
          mgl.loader.dispose();
        }
        this.mediaGroups_.splice(i, 1);
        return;
      }
    }
  }

  /**
   * Dispose of this audio track and
   * the playlist loader that it holds inside
   */
  dispose() {
    let i = this.mediaGroups_.length;

    while (i--) {
      this.removeLoader(this.mediaGroups_[i].mediaGroup);
    }
  }
}

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

    let trackProps = {
      autoselect: options.autoselect || false,
      default: options.default || false,
      withCredentials: options.withCredentials || false
    };

    /* eslint-disable no-loop-func */
    for (let key in trackProps) {
      Object.defineProperty(this, key, {
        get: () => trackProps[key],
        set: () => {}
      });
    }
    /* eslint-enable no-loop-func */

    this.mediaGroups = {};
    this.addLoader(options.mediaGroup, options.resolvedUri);
  }

  /**
   * get a playlistloader from this track given a mediaGroup
   *
   * @param {String} mediaGroup the mediaGroup to get the loader for
   * @return {PlaylistLoader|Null} the PlaylistLoader or null
   */
  getLoader(mediaGroup) {
    if (!this.mediaGroups[mediaGroup]) {
      return;
    }

    return this.mediaGroups[mediaGroup];
  }

  /**
   * add a playlistLoader given a mediaGroup, and a uri. for a combined track
   * we store null for the playlistloader
   *
   * @param {String} mediaGroup the mediaGroup to get the loader for
   * @param {String} uri the uri to get the audio track/mediaGroup from
   */
  addLoader(mediaGroup, uri = null) {
    this.mediaGroups[mediaGroup] = null;

    if (uri) {
      this.mediaGroups[mediaGroup] = new PlaylistLoader(uri, this.withCredentials);
    }
  }

  /**
   * remove a playlist loader from a track given the mediaGroup
   *
   * @param {String} mediaGroup the mediaGroup to remove
   */
  removeLoader(mediaGroup) {
    delete this.mediaGroups[mediaGroup];
  }

  /**
   * Dispose of this audio track and
   * the playlist loader that it holds inside
   */
  dispose() {
    if (this.loader) {
      this.loader.dispose();
    }
  }
}

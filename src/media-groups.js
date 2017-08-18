import videojs from 'video.js';
import PlaylistLoader from './playlist-loader';

const setupListeners = {
  /**
   * Setup event listeners for audio playlist loader
   */
  AUDIO: (playlistLoader, masterPlaylistController) => {
    const segmentLoader = masterPlaylistController.audioSegmentLoader_;
    const tech = masterPlaylistController.tech_;
    const options = masterPlaylistController.requestOptions_;

    playlistLoader.on('loadedmetadata', () => {
      const media = playlistLoader.media();

      segmentLoader.playlist(media, options);

      // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments
      if (!tech.paused() || (media.endList && tech.preload() !== 'none')) {
        segmentLoader.load();
      }
    });

    playlistLoader.on('loadedplaylist', () => {
      segmentLoader.playlist(playlistLoader.media(), options);
    });

    playlistLoader.on('error', () => {
      videojs.log.warn('Problem encountered loading the alternate audio track' +
                         '. Switching back to default.');
      segmentLoader.abort();
    });
  },
  /**
   * Setup event listeners for subtitle playlist loader
   */
  SUBTITLES: (playlistLoader, masterPlaylistController) => {
    const segmentLoader = masterPlaylistController.subtitleSegmentLoader_;
    const tech = masterPlaylistController.tech_;
    const options = masterPlaylistController.requestOptions_;

    playlistLoader.on('loadedmetadata', () => {
      const media = playlistLoader.media();

      segmentLoader.playlist(media, options);
      segmentLoader.track(masterPlaylistController.activeSubtitleTrack_());

      // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments
      if (!tech.paused() || (media.endList && tech.preload() !== 'none')) {
        segmentLoader.load();
      }
    });

    playlistLoader.on('loadedplaylist', () => {
      segmentLoader.playlist(playlistLoader.media(), options);
    });

    playlistLoader.on('error', () => {
      masterPlaylistController.handleSubtitleError_();
    });
  }
};

/**
 * Convert the properties of an HLS track into an audioTrackKind.
 *
 * @private
 */
const audioTrackKind_ = (properties) => {
  let kind = properties.default ? 'main' : 'alternative';

  if (properties.characteristics &&
      properties.characteristics.indexOf('public.accessibility.describes-video') >= 0) {
    kind = 'main-desc';
  }

  return kind;
};

const initialize = {
  /**
   * Setup playlist loaders and tracks for audio groups
   */
  AUDIO: (masterGroups, mediaGroups, mediaTracks, masterPlaylistController) => {
    // force a default if we have none or we are not
    // in html5 mode (the only mode to support more than one
    // audio track)
    if (!masterGroups.AUDIO ||
        Object.keys(masterGroups.AUDIO).length ==== 0 ||
        mode !== 'html5') {
      masterGroups.AUDIO = { main: { default: { defualt: true } } };
    }

    for (let masterGroup in masterGroups.AUDIO) {
      if (!mediaGroups[masterGroup]) {
        mediaGroups[masterGroup] = [];
      }

      for (let label in masterGroups.AUDIO[masterGroup]) {
        const properties = videojs.mergeOptions({
          id: label,
          playlistLoader: new PlaylistLoader(properties.resolvedUri,
                                             masterPlaylistController.hls_,
                                             masterPlaylistController.withCredentials)
        }, masterGroups.AUDIO[masterGroup][label]);

        setupListeners.AUDIO(properties.playlistLoader, masterPlaylistController);

        mediaGroups[masterGroup].push(properties);

        if (typeof mediaTracks[label] === 'undefined') {
          const track = new videojs.AudioTrack({
            id: label,
            kind: audioTrackKind_(properties),
            enabled: false,
            language: properties.language,
            label
          });

          mediaTracks[label] = track;
        }
      }
    }
  },
  /**
   * Setup playlist loaders and tracks for subtitle groups
   */
  SUBTITLES: (masterGroups, mediaGroups, mediaTracks, masterPlaylistController) => {
    for (let masterGroup in masterGroups.SUBTITLES) {
      if (!mediaGroups[masterGroup]) {
        mediaGroups[masterGroup] = [];
      }

      for (let label in masterGroups.SUBTITLES[masterGroup]) {
        if (masterGroups.SUBTITLES[masterGroup][label].forced) {
          continue;
        }

        const properties = videojs.mergeOptions({
          id: label,
          playlistLoader: new PlaylistLoader(properties.resolvedUri,
                                             masterPlaylistController.hls_,
                                             masterPlaylistController.withCredentials)
        }, masterGroups.SUBTITLES[masterGroup][label]);

        setupListeners.SUBTITLES(properties.playlistLoader, masterPlaylistController);

        if (typeof mediaTracks[label] === 'undefined') {
          const track = masterPlaylistController.tech_.addRemoteTextTrack({
            id: label,
            kind: 'subtitles',
            enabled: false,
            language: properties.language,
            label
          }, false).track;

          mediaTracks[label] = track;
        }
      }
    }
  }
};

export const initializeMediaGroup = (
  type,
  master,
  mediaGroup,
  masterPlaylistController
) => {
  const masterGroups = master.mediaGroups || {};

  return initialize[type](masterGroups,
                          mediaGroup.groups,
                          mediaGroup.tracks,
                          masterPlaylistController);
};

import videojs from 'video.js';
import PlaylistLoader from './playlist-loader';

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

const setupListeners = {
  /**
   * Setup event listeners for audio playlist loader
   */
  AUDIO: (type, playlistLoader, settings) => {
    if (!playlistLoader) {
      // no playlist loader means audio will be muxed with the video
      return;
    }

    const {
      tech,
      requestOptions,
      segmentLoaders: { [type]: segmentLoader }
    } = settings;

    playlistLoader.on('loadedmetadata', () => {
      const media = playlistLoader.media();

      segmentLoader.playlist(media, requestOptions);

      // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments
      if (!tech.paused() || (media.endList && tech.preload() !== 'none')) {
        segmentLoader.load();
      }
    });

    playlistLoader.on('loadedplaylist', () => {
      segmentLoader.playlist(playlistLoader.media(), requestOptions);
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
  SUBTITLES: (type, playlistLoader, settings) => {
    const {
      tech,
      requestOptions,
      segmentLoaders: { [type]: segmentLoader }
    } = settings;

    playlistLoader.on('loadedmetadata', () => {
      const media = playlistLoader.media();

      segmentLoader.playlist(media, requestOptions);
      segmentLoader.track(masterPlaylistController.activeSubtitleTrack_());

      // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments
      if (!tech.paused() || (media.endList && tech.preload() !== 'none')) {
        segmentLoader.load();
      }
    });

    playlistLoader.on('loadedplaylist', () => {
      segmentLoader.playlist(playlistLoader.media(), requestOptions);
    });

    playlistLoader.on('error', () => {
      // masterPlaylistController.handleSubtitleError_();
    });
  }
};

const initialize = {
  /**
   * Setup playlist loaders and tracks for audio groups
   */
  AUDIO: (type, settings) => {
    const {
      mode,
      hls,
      requestOptions: { withCredentials },
      master: { mediaGroups: masterGroups},
      mediaGroups: {
        [type]: {
          groups,
          tracks
        }
      }
    } = settings;

    // force a default if we have none or we are not
    // in html5 mode (the only mode to support more than one
    // audio track)
    if (!masterGroups[type] ||
        Object.keys(masterGroups[type]).length === 0 ||
        mode !== 'html5') {
      masterGroups[type] = { main: { default: { defualt: true } } };
    }

    for (let masterGroup in masterGroups[type]) {
      if (!groups[masterGroup]) {
        groups[masterGroup] = [];
      }

      for (let label in masterGroups[type][masterGroup]) {
        let properties = masterGroups[type][masterGroup][label];
        let playlistLoader;

        if (properties.resolvedUri) {
          playlistLoader = new PlaylistLoader(properties.resolvedUri,
                                              hls,
                                              withCredentials);
        } else {
          // no resolvedUri means the audio is muxed with the video when using this
          // audio track
          playlistLoader = null;
        }

        properties = videojs.mergeOptions({ id: label, playlistLoader }, properties);

        setupListeners[type](type, properties.playlistLoader, settings);

        groups[masterGroup].push(properties);

        if (typeof tracks[label] === 'undefined') {
          const track = new videojs.AudioTrack({
            id: label,
            kind: audioTrackKind_(properties),
            enabled: false,
            language: properties.language,
            default: properties.default,
            label
          });

          tracks[label] = track;
        }
      }
    }
  },
  /**
   * Setup playlist loaders and tracks for subtitle groups
   */
  SUBTITLES: (type, settings) => {
    const {
      tech,
      hls,
      requestOptions: { withCredentials },
      master: { mediaGroups: masterGroups},
      mediaGroups: {
        [type]: {
          groups,
          tracks
        }
      }
    } = settings;

    for (let masterGroup in masterGroups[type]) {
      if (!groups[masterGroup]) {
        groups[masterGroup] = [];
      }

      for (let label in masterGroups[type][masterGroup]) {
        if (masterGroups[type][masterGroup][label].forced) {
          continue;
        }

        let properties = masterGroups[type][masterGroup][label];

        properties = videojs.mergeOptions({
          id: label,
          playlistLoader: new PlaylistLoader(properties.resolvedUri,
                                             hls,
                                             withCredentials)
        }, properties);

        setupListeners[type](type, properties.playlistLoader, settings);

        groups[masterGroup].push(properties);

        if (typeof tracks[label] === 'undefined') {
          const track = tech.addRemoteTextTrack({
            id: label,
            kind: 'subtitles',
            enabled: false,
            language: properties.language,
            label
          }, false).track;

          tracks[label] = track;
        }
      }
    }
  },
  /**
   * Setup tracks for closed-caption groups
   */
  'CLOSED-CAPTIONS': (type, settings) => {
    const {
      tech,
      master: { mediaGroups: masterGroups},
      mediaGroups: {
        [type]: {
          groups,
          tracks
        }
      }
    } = settings;

    for (let masterGroup in masterGroups[type]) {
      if (!groups[masterGroup]) {
        groups[masterGroup] = [];
      }

      for (let label in masterGroups[type][masterGroup]) {
        let properties = masterGroups[type][masterGroup][label];

        // We only support CEA608 captions for now, so ignore anything that
        // doesn't use a CCx INSTREAM-ID
        if (properties.instreamId.match(/CC\d/)) {
          continue;
        }

        groups[masterGroup].push(videojs.mergeOptions({ id: label }, properties));

        if (typeof tracks[label] === 'undefined') {
          const track = tech.addRemoteTextTrack({
            id: properties.instreamId,
            kind: 'captions',
            enabled: false,
            language: properties.language,
            label
          }, false).track;

          tracks[label] = track;
        }
      }
    }
  }
};

/**
 * Returns a function used to get the active group of type provided
 */
const activeGroup = (type, settings) => (track) => {
  const {
    masterPlaylistLoader,
    mediaGroups: { [type]: { groups } }
  } = settings;

  const media = masterPlaylistLoader.media();

  if (!media) {
    return null;
  }

  let result;

  if (media.attributes[type]) {
    result = groups[media.attributes[type]];
  }

  result = result || groups.main;

  if (typeof track === 'undefined') {
    return result;
  }

  if (track === null) {
    // An active track was specified so a corresponding group is expected. track === null
    // means no track is currently active so there is no corresponding group
    return null;
  }

  return result.reduce((final, props) => props.id === track.id ? props : final, null);
};

const activeTrack = {
  /**
   * Returns a function used to get the active audio track
   */
  AUDIO: (type, settings) => () => {
    const { mediaGroups: [type]: { tracks } } = settings;

    for (let id in tracks) {
      if (tracks[id].enabled) {
        return tracks[id];
      }
    }

    return null;
  },
  /**
   * Returns a function used to get the active audio track
   */
  SUBTITLES: (type, settings) => () => {
    const { mediaGroups: { [type]: { tracks } } = settings;

    for (let id in tracks) {
      if (tracks[id].mode === 'showing') {
        return tracks[id];
      }
    }

    return null;
  }
};

const stopLoaders = (segmentLoader, mediaGroup) => {
  segmentLoader.pause();

  if (mediaGroup && mediaGroup.activePlaylistLoader) {
    mediaGroup.activePlaylistLoader.pause();
    mediaGroup.activePlaylistLoader = null;
  }
};

const startLoaders = (segmentLoader, playlistLoader, mediaGroup) => {
  mediaGroup.activePlaylistLoader = playlistLoader;

  if (playlistLoader.media()) {
    // only begin loading in the segment loader if the playlist loader has loaded its
    // media
    segmentLoader.load();
  }

  playlistLoader.load();
}

/**
 * Non-destructive resync of the segmentLoaders to prepare to continue appending new
 * audio data at the end of the current buffered region
 */
const onGroupChanged = (type, settings) => () => {
  const {
    segmentLoaders: { [type]: segmentLoader },
    mediaGroups: { [type]: mediaGroup }
  } = settings;
  const activeTrack = mediaGroup.activeTrack();
  const activeGroup = mediaGroup.activeGroup(activeTrack);

  stopLoaders(segmentLoader, mediaGroup);

  if (!activeGroup) {
    // there is no group active so we do not want to restart loaders
    return;
  }

  // Non-destructive resync
  segmentLoader.resyncLoader();

  startLoaders(segmentLoader, activeGroup.playlistLoader, mediaGroup);
};

const onTrackChanged = (type, settings) => () => {
  const {
    segmentLoaders: {
      [type]: segmentLoader,
      main: mainSegmentLoader
    },
    mediaGroups: { [type]: mediaGroup }
  } = settings;
  const activeTrack = mediaGroup.activeTrack();
  const activeGroup = mediaGroup.activeGroup(activeTrack);

  stopLoaders(segmentLoader, mediaGroup);

  if (!activeGroup) {
    // there is no group active so we do not want to restart loaders
    return;
  }

  if (!activeGroup.playlistLoader) {
    // when switching from demuxed audio/video to muxed audio/video (noted by no playlist
    // loader for the audio group), we want to do a destructive reset of the main segment
    // loader and not restart the audio loaders
    mainSegmentLoader.resetEverything();
    return;
  }

  // destructive reset
  segmentLoader.resetEverything();

  startLoaders(segmentLoader, activeGroup.playlistLoader, mediaGroup);
};

const initializeMediaGroups = (settings) => {
  ['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach((type) => {
    initialize[type](type, settings)
  });

  const {
    mediaGroups,
    masterPlaylistLoader,
    tech,
    hls
  } = settings;

  // setup active group and track getters and change event handlers

  ['AUDIO', 'SUBTITLES'].forEach((type) => {
    mediaGroups[type].activeGroup = activeGroup(type, settings);
    mediaGroups[type].activeTrack = activeTrack[type](type, settings);
    mediaGroups[type].onGroupChanged = onGroupChanged(type, settings);
    mediaGroups[type].onTrackChanged = onTrackChanged(type, settings);
  });

  // DO NOT enable the default subtitle or caption track.
  // DO enable the default audio track
  const audioGroup = mediaGroups.AUDIO.activeGroup();
  const groupId = (audioGroup.filter(group => group.default)[0] || audioGroup[0]).id;

  mediaGroups.AUDIO.tracks[groupId].enabled = true;
  mediaGroups.AUDIO.onTrackChanged();

  masterPlaylistLoader.on('mediachange', () => {
    ['AUDIO', 'SUBTITLES'].forEach(type => mediaGroups[type].onGroupChanged());
  });

  // custom audio track change event handler for usage event
  const onAudioTrackChanged = () => {
    mediaGroups.AUDIO.onTrackChanged();
    tech.trigger({ type: 'usage', name: 'hls-audio-change' });
  };

  tech.audioTracks().addEventListener('change', onAudioTrackChanged);
  tech.remoteTextTracks().addEventListener('change',
    mediaGroups.SUBTITLES.onTrackChanged);

  hls.on('dispose', () => {
    tech.audioTracks().removeEventListener('change', onAudioTrackChanged);
    tech.remoteTextTracks().removeEventListener('change',
      mediaGroups.SUBTITLES.onTrackChanged);
  });

  // clear existing audio tracks and add the ones we just created
  tech.clearTracks('audio');

  for (let id in mediaGroups.AUDIO.tracks) {
    tech.audioTracks().addTrack(mediaGroups.AUDIO.tracks[id]);
  }
};

export default initializeMediaGroups;

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

/**
 * Pause provided segment loader and playlist loader if active
 *
 * @param {SegmentLoader} segmentLoader
 *        SegmentLoader to pause
 * @param {Object} mediaGroup
 *        Active media group
 * @function stopLoaders
 */
const stopLoaders = (segmentLoader, mediaGroup) => {
  segmentLoader.abort();
  segmentLoader.pause();

  if (mediaGroup && mediaGroup.activePlaylistLoader) {
    mediaGroup.activePlaylistLoader.pause();
    mediaGroup.activePlaylistLoader = null;
  }
};

/**
 * Start loading for provided segment loader and playlist loader
 *
 * @param {SegmentLoader} segmentLoader
 *        SegmentLoader to start loading
 * @param {PlaylistLoader} playlistLoader
 *        PlaylistLoader to start loading
 * @param {Object} mediaGroup
 *        Active media group
 * @function startLoaders
 */
const startLoaders = (segmentLoader, playlistLoader, mediaGroup) => {
  mediaGroup.activePlaylistLoader = playlistLoader;

  if (playlistLoader.media()) {
    // only begin loading in the segment loader if the playlist loader has loaded its
    // media
    segmentLoader.playlist(playlistLoader.media());
    segmentLoader.load();
  }

  playlistLoader.load();
};

/**
 * Returns a function to be called when the media group changes. It performs a
 * non-destructive resync of the SegmentLoader since the playlist has likely changed.
 *
 * @param {String} type
 *        MediaGroup type
 * @param {Object} settings
 *        Object containing required information for media groups
 * @return {Function}
 *         Handler for a non-destructive resync of SegmentLoader when the active media
 *         group changes.
 * @function onGroupChanged
 */
const onGroupChanged = (type, settings) => () => {
  const {
    segmentLoaders: { [type]: segmentLoader },
    mediaGroups: { [type]: mediaGroup }
  } = settings;
  const activeTrack = mediaGroup.activeTrack();
  const activeGroup = mediaGroup.activeGroup(activeTrack);

  stopLoaders(segmentLoader, mediaGroup);

  if (!activeGroup || !activeGroup.playlistLoader) {
    // there is no group active or the group does not have a PlaylistLoader (e.g. audio
    // muxed with video) so we do not want to restart loaders
    return;
  }

  // Non-destructive resync
  segmentLoader.resyncLoader();

  startLoaders(segmentLoader, activeGroup.playlistLoader, mediaGroup);
};

/**
 * Returns a function to be called when the media track changes. It performs a
 * destructive reset of the SegmentLoader to ensure we start loading as close to
 * currentTime as possible.
 *
 * @param {String} type
 *        MediaGroup type
 * @param {Object} settings
 *        Object containing required information for media groups
 * @return {Function}
 *         Handler for a destructive reset of SegmentLoader when the active media
 *         track changes.
 * @function onTrackChanged
 */
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
  const previousActiveLoader = mediaGroup.activePlaylistLoader;

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

  if (previousActiveLoader === activeGroup.playlistLoader) {
    // Nothing has actually changed. This can happen because track change events can fire
    // multiple times for a "single" change. One for enabling the new active track, and
    // one for disabling the track that was active
    startLoaders(segmentLoader, activeGroup.playlistLoader, mediaGroup);
  }

  if (segmentLoader.track) {
    // For WebVTT, set the new text track in the segmentloader
    segmentLoader.track(activeTrack);
  }

  // destructive reset
  segmentLoader.resetEverything();

  startLoaders(segmentLoader, activeGroup.playlistLoader, mediaGroup);
};

const onError = {
  /**
   * Returns a function to be called when a SegmentLoader or PlaylistLoader encounters
   * an error.
   *
   * @param {String} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @return {Function}
   *         Error handler. Logs warning to console and switches back to default audio
   *         track.
   * @function onError.AUDIO
   */
  AUDIO: (type, settings) => () => {
    const {
      segmentLoaders: { [type]: segmentLoader},
      mediaGroups: { [type]: mediaGroup },
      blacklistCurrentPlaylist
    } = settings;

    segmentLoader.abort();

    stopLoaders(segmentLoader, mediaGroup);

    // switch back to default audio track
    const activeTrack = mediaGroup.activeTrack();
    const activeGroup = mediaGroup.activeGroup();
    const id = (activeGroup.filter(group => group.default)[0] || activeGroup[0]).id;
    const defaultTrack = mediaGroup.tracks[id];

    if (activeTrack === defaultTrack) {
      // Default track encountered an error. All we can do now is blacklist the current
      // rendition and hope another will switch audio groups
      blacklistCurrentPlaylist({
        message: 'Problem encountered loading the default audio track.'
      });
      return;
    }

    videojs.log.warn('Problem encountered loading the alternate audio track.' +
                       'Switching back to default.');

    for (let trackId in mediaGroup.tracks) {
      mediaGroup.tracks[trackId].enabled = mediaGroup.tracks[trackId] === defaultTrack;
    }

    mediaGroup.onTrackChanged();
  },
  /**
   * Returns a function to be called when a SegmentLoader or PlaylistLoader encounters
   * an error.
   *
   * @param {String} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @return {Function}
   *         Error handler. Logs warning to console and disables the active subtitle track
   * @function onError.SUBTITLES
   */
  SUBTITLES: (type, settings) => () => {
    const {
      segmentLoaders: { [type]: segmentLoader},
      mediaGroups: { [type]: mediaGroup }
    } = settings;

    videojs.log.warn('Problem encountered loading the subtitle track.' +
                     'Disabling subtitle track.');
    segmentLoader.abort();

    stopLoaders(segmentLoader, mediaGroup);

    const track = mediaGroup.activeTrack();

    if (track) {
      track.mode = 'disabled';
    }

    mediaGroup.onTrackChanged();
  }
};

const setupListeners = {
  /**
   * Setup event listeners for audio playlist loader
   *
   * @param {String} type
   *        MediaGroup type
   * @param {PlaylistLoader|null} playlistLoader
   *        PlaylistLoader to register listeners on
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function setupListeners.AUDIO
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

      // If the player isn't paused, ensure that the segment loader is running,
      // as it is possible that it was temporarily stopped while waiting for
      // a playlist (e.g., in case the playlist errored and we re-requested it).
      if (!tech.paused()) {
        segmentLoader.load();
      }
    });

    playlistLoader.on('error', onError[type](type, settings));
  },
  /**
   * Setup event listeners for subtitle playlist loader
   *
   * @param {String} type
   *        MediaGroup type
   * @param {PlaylistLoader|null} playlistLoader
   *        PlaylistLoader to register listeners on
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function setupListeners.SUBTITLES
   */
  SUBTITLES: (type, playlistLoader, settings) => {
    const {
      tech,
      requestOptions,
      segmentLoaders: { [type]: segmentLoader },
      mediaGroups: { [type]: mediaGroup }
    } = settings;

    playlistLoader.on('loadedmetadata', () => {
      const media = playlistLoader.media();

      segmentLoader.playlist(media, requestOptions);
      segmentLoader.track(mediaGroup.activeTrack());

      // if the video is already playing, or if this isn't a live video and preload
      // permits, start downloading segments
      if (!tech.paused() || (media.endList && tech.preload() !== 'none')) {
        segmentLoader.load();
      }
    });

    playlistLoader.on('loadedplaylist', () => {
      segmentLoader.playlist(playlistLoader.media(), requestOptions);

      // If the player isn't paused, ensure that the segment loader is running,
      // as it is possible that it was temporarily stopped while waiting for
      // a playlist (e.g., in case the playlist errored and we re-requested it).
      if (!tech.paused()) {
        segmentLoader.load();
      }
    });

    playlistLoader.on('error', onError[type](type, settings));
  }
};

const initialize = {
  /**
   * Setup PlaylistLoaders and AudioTracks for the audio groups
   *
   * @param {String} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function initialize.AUDIO
   */
  'AUDIO': (type, settings) => {
    const {
      mode,
      hls,
      segmentLoaders: { [type]: segmentLoader },
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

    // setup single error event handler for the segment loader
    segmentLoader.on('error', onError[type](type, settings));
  },
  /**
   * Setup PlaylistLoaders and TextTracks for the subtitle groups
   *
   * @param {String} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function initialize.SUBTITLES
   */
  'SUBTITLES': (type, settings) => {
    const {
      tech,
      hls,
      segmentLoaders: { [type]: segmentLoader },
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

    // setup single error event handler for the segment loader
    segmentLoader.on('error', onError[type](type, settings));
  },
  /**
   * Setup TextTracks for the closed-caption groups
   *
   * @param {String} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @function initialize['CLOSED-CAPTIONS']
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

        // No PlaylistLoader is required for Closed-Captions because the captions are
        // embedded within the video stream
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
 *
 * @param {String} type
 *        MediaGroup type
 * @param {Object} settings
 *        Object containing required information for media groups
 * @return {Function}
 *         Function that returns the active media group for the provided type. Takes an
 *         optional paramter {TextTrack} track. If no track is provided, a list of all
 *         variants in the group, otherwise the variant corresponding to the provided
 *         track is returned.
 * @function activeGroup
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
   * Returns a function used to get the active track of type provided
   *
   * @param {String} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @return {Function}
   *         Function that returns the active media track for the provided type. Returns
   *         null if no track is active
   * @function activeTrack.AUDIO
   */
  AUDIO: (type, settings) => () => {
    const { mediaGroups: { [type]: { tracks } } } = settings;

    for (let id in tracks) {
      if (tracks[id].enabled) {
        return tracks[id];
      }
    }

    return null;
  },
  /**
   * Returns a function used to get the active track of type provided
   *
   * @param {String} type
   *        MediaGroup type
   * @param {Object} settings
   *        Object containing required information for media groups
   * @return {Function}
   *         Function that returns the active media track for the provided type. Returns
   *         null if no track is active
   * @function activeTrack.SUBTITLES
   */
  SUBTITLES: (type, settings) => () => {
    const { mediaGroups: { [type]: { tracks } } } = settings;

    for (let id in tracks) {
      if (tracks[id].mode === 'showing') {
        return tracks[id];
      }
    }

    return null;
  }
};

/**
 * Initialize PlaylistLoaders and Tracks for media groups (Audio, Subtitles,
 * Closed-Captions) specified in the master manifest.
 *
 * @param {Object} settings
 *        Object containing required information for setting up the media groups
 * @param {SegmentLoader} settings.segmentLoaders.AUDIO
 *        Audio segment loader
 * @param {SegmentLoader} settings.segmentLoaders.SUBTITLES
 *        Subtitle segment loader
 * @param {SegmentLoader} settings.segmentLoaders.main
 *        Main segment loader
 * @param {Tech} settings.tech
 *        The tech of the player
 * @param {Object} settings.requestOptions
 *        XHR request options used by the segment loaders
 * @param {PlaylistLoader} settings.masterPlaylistLoader
 *        PlaylistLoader for the master source
 * @param {String} mode
 *        Mode of the hls source handler. Can be 'auto', 'html5', or 'flash'
 * @param {HlsHandler} settings.hls
 *        HLS SourceHandler
 * @param {Object} settings.master
 *        The parsed master manifest
 * @param {Object} settings.mediaGroups
 *        Object to store the loaders, tracks, and utility methods for each media group
 * @param {Function} settings.blacklistCurrentPlaylist
 *        Blacklists the current rendition and forces a rendition switch.
 * @function initializeMediaGroups
 */
const initializeMediaGroups = (settings) => {
  ['AUDIO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach((type) => {
    initialize[type](type, settings);
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

import QUnit from 'qunit';
import {
  useFakeEnvironment
} from './test-helpers.js';
import * as MediaGroups from '../src/media-groups';

QUnit.module('MediaGroups', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
  },
  afterEach(assert) {
    this.env.restore();
  }
});

QUnit.test('createMediaTypes creates skeleton object for all supported media groups',
function(assert) {
  const noopToString = 'function noop() {}';
  const result = MediaGroups.createMediaTypes();

  assert.ok(result.AUDIO, 'created AUDIO media group object');
  assert.deepEqual(result.AUDIO.groups, {},
    'created empty object for AUDIO groups');
  assert.deepEqual(result.AUDIO.tracks, {},
    'created empty object for AUDIO tracks');
  assert.equal(result.AUDIO.activePlaylistLoader, null,
    'AUDIO activePlaylistLoader is null');
  assert.equal(result.AUDIO.activeGroup.toString(), noopToString,
    'created noop function for AUDIO activeGroup');
  assert.equal(result.AUDIO.activeTrack.toString(), noopToString,
    'created noop function for AUDIO activeTrack');
  assert.equal(result.AUDIO.onGroupChanged.toString(), noopToString,
    'created noop function for AUDIO onGroupChanged');
  assert.equal(result.AUDIO.onTrackChanged.toString(), noopToString,
    'created noop function for AUDIO onTrackChanged');

  assert.ok(result.SUBTITLES, 'created SUBTITLES media group object');
  assert.deepEqual(result.SUBTITLES.groups, {},
    'created empty object for SUBTITLES groups');
  assert.deepEqual(result.SUBTITLES.tracks, {},
    'created empty object for SUBTITLES tracks');
  assert.equal(result.SUBTITLES.activePlaylistLoader, null,
    'SUBTITLES activePlaylistLoader is null');
  assert.equal(result.SUBTITLES.activeGroup.toString(), noopToString,
    'created noop function for SUBTITLES activeGroup');
  assert.equal(result.SUBTITLES.activeTrack.toString(), noopToString,
    'created noop function for SUBTITLES activeTrack');
  assert.equal(result.SUBTITLES.onGroupChanged.toString(), noopToString,
    'created noop function for SUBTITLES onGroupChanged');
  assert.equal(result.SUBTITLES.onTrackChanged.toString(), noopToString,
    'created noop function for SUBTITLES onTrackChanged');

  assert.ok(result['CLOSED-CAPTIONS'], 'created CLOSED-CAPTIONS media group object');
  assert.deepEqual(result['CLOSED-CAPTIONS'].groups, {},
    'created empty object for CLOSED-CAPTIONS groups');
  assert.deepEqual(result['CLOSED-CAPTIONS'].tracks, {},
    'created empty object for CLOSED-CAPTIONS tracks');
  assert.equal(result['CLOSED-CAPTIONS'].activePlaylistLoader, null,
    'CLOSED-CAPTIONS activePlaylistLoader is null');
  assert.equal(result['CLOSED-CAPTIONS'].activeGroup.toString(), noopToString,
    'created noop function for CLOSED-CAPTIONS activeGroup');
  assert.equal(result['CLOSED-CAPTIONS'].activeTrack.toString(), noopToString,
    'created noop function for CLOSED-CAPTIONS activeTrack');
  assert.equal(result['CLOSED-CAPTIONS'].onGroupChanged.toString(), noopToString,
    'created noop function for CLOSED-CAPTIONS onGroupChanged');
  assert.equal(result['CLOSED-CAPTIONS'].onTrackChanged.toString(), noopToString,
    'created noop function for CLOSED-CAPTIONS onTrackChanged');
});

QUnit.test('stopLoaders pauses segment loader and playlist loader when available',
function(assert) {
  let segmentLoaderAbortCalls = 0;
  let segmentLoaderPauseCalls = 0;
  let playlistLoaderPauseCalls = 0;

  const segmentLoader = {
    abort: () => segmentLoaderAbortCalls++,
    pause: () => segmentLoaderPauseCalls++
  };
  const playlistLoader = {
    pause: () => playlistLoaderPauseCalls++
  };
  const mediaType = { activePlaylistLoader: null };

  MediaGroups.stopLoaders(segmentLoader, mediaType);

  assert.equal(segmentLoaderAbortCalls, 1, 'aborted segment loader');
  assert.equal(segmentLoaderPauseCalls, 1, 'paused segment loader');
  assert.equal(playlistLoaderPauseCalls, 0, 'no pause when no active playlist loader');

  mediaType.activePlaylistLoader = playlistLoader;

  MediaGroups.stopLoaders(segmentLoader, mediaType);

  assert.equal(segmentLoaderAbortCalls, 2, 'aborted segment loader');
  assert.equal(segmentLoaderPauseCalls, 2, 'paused segment loader');
  assert.equal(playlistLoaderPauseCalls, 1, 'pause active playlist loader');
  assert.equal(mediaType.activePlaylistLoader, null,
    'clears active playlist loader for media group');
});

QUnit.test('startLoaders starts playlist loader when appropriate',
function(assert) {
  let playlistLoaderLoadCalls = 0;
  let media = null;

  const playlistLoader = {
    load: () => playlistLoaderLoadCalls++,
    media: () => media
  };
  const mediaType = { activePlaylistLoader: null };

  MediaGroups.startLoaders(playlistLoader, mediaType);

  assert.equal(playlistLoaderLoadCalls, 1, 'called load on playlist loader');
  assert.strictEqual(mediaType.activePlaylistLoader, playlistLoader,
    'set active playlist loader for media group');
});

QUnit.test('activeTrack returns the correct audio track', function(assert) {
  const type = 'AUDIO';
  const settings = { mediaTypes: MediaGroups.createMediaTypes() };
  const tracks = settings.mediaTypes[type].tracks;
  const activeTrack = MediaGroups.activeTrack[type](type, settings);

  assert.equal(activeTrack(), null, 'returns null when empty track list');

  tracks.track1 = { id: 'track1', enabled: false };
  tracks.track2 = { id: 'track2', enabled: false };
  tracks.track3 = { id: 'track3', enabled: false };

  assert.equal(activeTrack(), null, 'returns null when no active tracks');

  tracks.track3.enabled = true;

  assert.strictEqual(activeTrack(), tracks.track3, 'returns active track');

  tracks.track1.enabled = true;

  // video.js treats the first enabled track in the track list as the active track
  // so we want the same behavior here
  assert.strictEqual(activeTrack(), tracks.track1, 'returns first active track');

  tracks.track1.enabled = false;

  assert.strictEqual(activeTrack(), tracks.track3, 'returns active track');

  tracks.track3.enabled = false;

  assert.equal(activeTrack(), null, 'returns null when no active tracks');
});

QUnit.test('activeTrack returns the correct subtitle track', function(assert) {
  const type = 'SUBTITLES';
  const settings = { mediaTypes: MediaGroups.createMediaTypes() };
  const tracks = settings.mediaTypes[type].tracks;
  const activeTrack = MediaGroups.activeTrack[type](type, settings);

  assert.equal(activeTrack(), null, 'returns null when empty track list');

  tracks.track1 = { id: 'track1', mode: 'disabled' };
  tracks.track2 = { id: 'track2', mode: 'hidden' };
  tracks.track3 = { id: 'track3', mode: 'disabled' };

  assert.equal(activeTrack(), null, 'returns null when no active tracks');

  tracks.track3.mode = 'showing';

  assert.strictEqual(activeTrack(), tracks.track3, 'returns active track');

  tracks.track1.mode = 'showing';

  // video.js treats the first enabled track in the track list as the active track
  // so we want the same behavior here
  assert.strictEqual(activeTrack(), tracks.track1, 'returns first active track');

  tracks.track1.mode = 'disabled';

  assert.strictEqual(activeTrack(), tracks.track3, 'returns active track');

  tracks.track3.mode = 'hidden';

  assert.equal(activeTrack(), null, 'returns null when no active tracks');
});

QUnit.test('activeGroup returns the correct audio group', function(assert) {
  const type = 'AUDIO';
  let media = null;
  const settings = {
    mediaTypes: MediaGroups.createMediaTypes(),
    masterPlaylistLoader: {
      media: () => media
    }
  };
  const groups = settings.mediaTypes[type].groups;
  const tracks = settings.mediaTypes[type].tracks;
  const activeTrack = MediaGroups.activeTrack[type](type, settings);
  const activeGroup = MediaGroups.activeGroup(type, settings);

  assert.equal(activeGroup(), null, 'returns null when no media in masterPlaylistLoader');

  media = { attributes: { } };
  groups.main = [{ id: 'en' }, { id: 'fr' }];

  assert.strictEqual(activeGroup(), groups.main,
    'defaults to main audio group when media does not specify audio group');

  groups.audio = [{ id: 'en'}, { id: 'fr' }];
  media.attributes.AUDIO = 'audio';

  assert.strictEqual(activeGroup(), groups.audio,
    'returns list of variants in active audio group');

  tracks.en = { id: 'en', enabled: false };
  tracks.fr = { id: 'fr', enabled: false };

  assert.equal(activeGroup(activeTrack()), null,
    'returns null when an active track is specified, but there is no active track');

  tracks.fr.enabled = true;

  assert.strictEqual(activeGroup(activeTrack()), groups.audio[1],
    'returned the active group corresponding to the active track');
});

QUnit.test('activeGroup returns the correct subtitle group', function(assert) {
  const type = 'SUBTITLES';
  let media = null;
  const settings = {
    mediaTypes: MediaGroups.createMediaTypes(),
    masterPlaylistLoader: {
      media: () => media
    }
  };
  const groups = settings.mediaTypes[type].groups;
  const tracks = settings.mediaTypes[type].tracks;
  const activeTrack = MediaGroups.activeTrack[type](type, settings);
  const activeGroup = MediaGroups.activeGroup(type, settings);

  assert.equal(activeGroup(), null, 'returns null when no media in masterPlaylistLoader');

  media = { attributes: { } };

  // there is no default `main` group for subtitles like there is for audio
  assert.notOk(activeGroup(), 'returns null when media does not specify subtitle group');

  groups.subs = [{ id: 'en'}, { id: 'fr' }];
  media.attributes.SUBTITLES = 'subs';

  assert.strictEqual(activeGroup(), groups.subs,
    'returns list of variants in active subtitle group');

  tracks.en = { id: 'en', mode: 'disabled' };
  tracks.fr = { id: 'fr', mode: 'disabled' };

  assert.equal(activeGroup(activeTrack()), null,
    'returns null when an active track is specified, but there is no active track');

  tracks.fr.mode = 'showing';

  assert.strictEqual(activeGroup(activeTrack()), groups.subs[1],
    'returned the active group corresponding to the active track');
});

QUnit.test('onGroupChanged updates active playlist loader and resyncs segment loader',
function(assert) {
  let mainSegmentLoaderResetCalls = 0;
  let segmentLoaderResyncCalls = 0;
  let segmentLoaderPauseCalls = 0;

  const type = 'AUDIO';
  const media = { attributes: { AUDIO: 'main' } };
  const mainSegmentLoader = { resetEverything: () => mainSegmentLoaderResetCalls++ };
  const segmentLoader = {
    abort() {},
    pause: () => segmentLoaderPauseCalls++,
    load() {},
    playlist() {},
    resyncLoader: () => segmentLoaderResyncCalls++
  };
  const mockPlaylistLoader = () => {
    return {
      media: () => media,
      load() {},
      pause() {}
    };
  };
  const masterPlaylistLoader = mockPlaylistLoader();
  const settings = {
    segmentLoaders: {
      AUDIO: segmentLoader,
      main: mainSegmentLoader
    },
    mediaTypes: MediaGroups.createMediaTypes(),
    masterPlaylistLoader
  };
  const mediaType = settings.mediaTypes[type];
  const groups = mediaType.groups;
  const tracks = mediaType.tracks;

  groups.main = [
    { id: 'en', playlistLoader: null },
    { id: 'fr', playlistLoader: mockPlaylistLoader() },
    { id: 'es', playlistLoader: mockPlaylistLoader() }
  ];
  tracks.en = { id: 'en', enabled: false };
  tracks.fr = { id: 'fr', enabled: false };
  tracks.es = { id: 'es', enabled: false };
  mediaType.activeTrack = MediaGroups.activeTrack[type](type, settings);
  mediaType.activeGroup = MediaGroups.activeGroup(type, settings);

  const onGroupChanged = MediaGroups.onGroupChanged(type, settings);

  onGroupChanged();

  assert.equal(segmentLoaderPauseCalls, 1, 'loaders paused on group change');
  assert.equal(mainSegmentLoaderResetCalls, 0, 'no reset when no active group');
  assert.equal(segmentLoaderResyncCalls, 0, 'no resync when no active group');

  tracks.en.enabled = true;

  onGroupChanged();

  assert.equal(segmentLoaderPauseCalls, 2, 'loaders paused on group change');
  assert.equal(mainSegmentLoaderResetCalls, 0,
    'no reset changing from no active playlist loader to group with no playlist loader');
  assert.equal(segmentLoaderResyncCalls, 0,
    'no resync changing to group with no playlist loader');

  mediaType.activePlaylistLoader = groups.main[1].playlistLoader;

  onGroupChanged();

  assert.equal(segmentLoaderPauseCalls, 3, 'loaders paused on group change');
  assert.equal(mainSegmentLoaderResetCalls, 1,
    'reset changing from active playlist loader to group with no playlist loader');
  assert.equal(segmentLoaderResyncCalls, 0,
    'no resync changing to group with no playlist loader');

  tracks.en.enabled = false;
  tracks.fr.enabled = true;
  mediaType.activePlaylistLoader = groups.main[2].playlistLoader;

  onGroupChanged();

  assert.equal(segmentLoaderPauseCalls, 4, 'loaders paused on group change');
  assert.equal(mainSegmentLoaderResetCalls, 1,
    'no reset changing to group with playlist loader');
  assert.equal(segmentLoaderResyncCalls, 1,
    'resync changing to group with playlist loader');
  assert.strictEqual(mediaType.activePlaylistLoader, groups.main[1].playlistLoader,
    'sets the correct active playlist loader');
});

QUnit.test('onTrackChanged updates active playlist loader and resets segment loader',
function(assert) {
  let mainSegmentLoaderResetCalls = 0;
  let segmentLoaderResetCalls = 0;
  let segmentLoaderPauseCalls = 0;
  let segmentLoaderTrack;

  const type = 'AUDIO';
  const media = { attributes: { AUDIO: 'main' } };
  const mainSegmentLoader = { resetEverything: () => mainSegmentLoaderResetCalls++ };
  const segmentLoader = {
    abort() {},
    pause: () => segmentLoaderPauseCalls++,
    playlist() {},
    resetEverything: () => segmentLoaderResetCalls++
  };
  const mockPlaylistLoader = () => {
    return {
      media: () => media,
      load() {},
      pause() {}
    };
  };
  const masterPlaylistLoader = mockPlaylistLoader();
  const settings = {
    segmentLoaders: {
      AUDIO: segmentLoader,
      main: mainSegmentLoader
    },
    mediaTypes: MediaGroups.createMediaTypes(),
    masterPlaylistLoader
  };
  const mediaType = settings.mediaTypes[type];
  const groups = mediaType.groups;
  const tracks = mediaType.tracks;

  groups.main = [
    { id: 'en', playlistLoader: null },
    { id: 'fr', playlistLoader: mockPlaylistLoader() },
    { id: 'es', playlistLoader: mockPlaylistLoader() }
  ];
  tracks.en = { id: 'en', enabled: false };
  tracks.fr = { id: 'fr', enabled: false };
  tracks.es = { id: 'es', enabled: false };
  mediaType.activeTrack = MediaGroups.activeTrack[type](type, settings);
  mediaType.activeGroup = MediaGroups.activeGroup(type, settings);

  const onTrackChanged = MediaGroups.onTrackChanged(type, settings);

  onTrackChanged();

  assert.equal(segmentLoaderPauseCalls, 1, 'loaders paused on track change');
  assert.equal(mainSegmentLoaderResetCalls, 0, 'no main reset when no active group');
  assert.equal(segmentLoaderResetCalls, 0, 'no reset when no active group');

  tracks.en.enabled = true;

  onTrackChanged();

  assert.equal(segmentLoaderPauseCalls, 2, 'loaders paused on track change');
  assert.equal(mainSegmentLoaderResetCalls, 1,
    'main reset changing to group with no playlist loader');
  assert.equal(segmentLoaderResetCalls, 0,
    'no reset changing to group with no playlist loader');

  tracks.en.enabled = false;
  tracks.fr.enabled = true;
  mediaType.activePlaylistLoader = groups.main[1].playlistLoader;

  onTrackChanged();

  assert.equal(segmentLoaderPauseCalls, 3, 'loaders paused on track change');
  assert.equal(mainSegmentLoaderResetCalls, 1,
    'no main reset changing to group with playlist loader');
  assert.equal(segmentLoaderResetCalls, 0,
    'no reset when active group hasn\'t changed');
  assert.strictEqual(mediaType.activePlaylistLoader, groups.main[1].playlistLoader,
    'sets the correct active playlist loader');

  mediaType.activePlaylistLoader = groups.main[2].playlistLoader;

  onTrackChanged();

  assert.equal(segmentLoaderPauseCalls, 4, 'loaders paused on track change');
  assert.equal(mainSegmentLoaderResetCalls, 1,
    'no main reset changing to group with playlist loader');
  assert.equal(segmentLoaderResetCalls, 1,
    'reset on track change');
  assert.strictEqual(mediaType.activePlaylistLoader, groups.main[1].playlistLoader,
    'sets the correct active playlist loader');

  // setting the track on the segment loader only applies to the SUBTITLES case.
  // even though this test is testing type AUDIO, aside from this difference of setting
  // the track, the functionality between the types is the same.
  segmentLoader.track = (track) => segmentLoaderTrack = track;
  mediaType.activePlaylistLoader = groups.main[2].playlistLoader;

  onTrackChanged();

  assert.equal(segmentLoaderPauseCalls, 5, 'loaders paused on track change');
  assert.equal(mainSegmentLoaderResetCalls, 1,
    'no main reset changing to group with playlist loader');
  assert.equal(segmentLoaderResetCalls, 2,
    'reset on track change');
  assert.strictEqual(mediaType.activePlaylistLoader, groups.main[1].playlistLoader,
    'sets the correct active playlist loader');
  assert.strictEqual(segmentLoaderTrack, tracks.fr,
    'set the correct track on the segment loader');
});

QUnit.test('switches to default audio track when an error is encountered',
function(assert) {
  let blacklistCurrentPlaylistCalls = 0;
  let onTrackChangedCalls = 0;

  const type = 'AUDIO';
  const segmentLoader = { abort() {}, pause() {} };
  const masterPlaylistLoader = {
    media() {
      return { attributes: { AUDIO: 'main' } };
    }
  };
  const settings = {
    segmentLoaders: { AUDIO: segmentLoader },
    mediaTypes: MediaGroups.createMediaTypes(),
    blacklistCurrentPlaylist: () => blacklistCurrentPlaylistCalls++,
    masterPlaylistLoader
  };
  const mediaType = settings.mediaTypes[type];
  const groups = mediaType.groups;
  const tracks = mediaType.tracks;

  mediaType.activeTrack = MediaGroups.activeTrack[type](type, settings);
  mediaType.activeGroup = MediaGroups.activeGroup(type, settings);
  mediaType.onTrackChanged = () => onTrackChangedCalls++;

  const onError = MediaGroups.onError[type](type, settings);

  groups.main = [ { id: 'en', default: true }, { id: 'fr'}, { id: 'es'} ];
  tracks.en = { id: 'en', enabed: false };
  tracks.fr = { id: 'fr', enabed: true };
  tracks.es = { id: 'es', enabed: false };

  onError();

  assert.equal(blacklistCurrentPlaylistCalls, 0, 'did not blacklist current playlist');
  assert.equal(onTrackChangedCalls, 1, 'called onTrackChanged after changing to default');
  assert.equal(tracks.en.enabled, true, 'enabled default track');
  assert.equal(tracks.fr.enabled, false, 'disabled active track');
  assert.equal(tracks.es.enabled, false, 'disabled track still disabled');
  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');
  this.env.log.warn.callCount = 0;

  onError();

  assert.equal(blacklistCurrentPlaylistCalls, 1, 'blacklist current playlist');
  assert.equal(onTrackChangedCalls, 1, 'did not call onTrackChanged after blacklist');
  assert.equal(tracks.en.enabled, true, 'default track still enabled');
  assert.equal(tracks.fr.enabled, false, 'disabled track still disabled');
  assert.equal(tracks.es.enabled, false, 'disabled track still disabled');
  assert.equal(this.env.log.warn.callCount, 0, 'no warning logged');
});

QUnit.test('disables subtitle track when an error is encountered', function(assert) {
  let onTrackChangedCalls = 0;
  const type = 'SUBTITLES';
  const segmentLoader = { abort() {}, pause() {} };
  const settings = {
    segmentLoaders: { SUBTITLES: segmentLoader },
    mediaTypes: MediaGroups.createMediaTypes()
  };
  const mediaType = settings.mediaTypes[type];
  const tracks = mediaType.tracks;

  mediaType.activeTrack = MediaGroups.activeTrack[type](type, settings);
  mediaType.onTrackChanged = () => onTrackChangedCalls++;

  const onError = MediaGroups.onError[type](type, settings);

  tracks.en = { id: 'en', mode: 'disabled' };
  tracks.fr = { id: 'fr', mode: 'disabled' };
  tracks.es = { id: 'es', mode: 'showing' };

  onError();

  assert.equal(onTrackChangedCalls, 1, 'called onTrackChanged after disabling track');
  assert.equal(tracks.en.mode, 'disabled', 'disabled track still disabled');
  assert.equal(tracks.fr.mode, 'disabled', 'disabled track still disabled');
  assert.equal(tracks.es.mode, 'disabled', 'disabled active track');
  assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');
  this.env.log.warn.callCount = 0;
});

QUnit.test('setupListeners adds correct playlist loader listeners', function(assert) {
  const settings = {
    tech: {},
    requestOptions: {},
    segmentLoaders: {
      AUDIO: {},
      SUBTITLES: {}
    },
    mediaTypes: MediaGroups.createMediaTypes()
  };
  const listeners = [];
  const on = (event, cb) => listeners.push([event, cb]);
  const playlistLoader = { on };
  let type = 'SUBTITLES';

  MediaGroups.setupListeners[type](type, playlistLoader, settings);

  assert.equal(listeners.length, 3, 'setup 3 event listeners');
  assert.equal(listeners[0][0], 'loadedmetadata', 'setup loadedmetadata listener');
  assert.equal(typeof listeners[0][1], 'function', 'setup loadedmetadata listener');
  assert.equal(listeners[1][0], 'loadedplaylist', 'setup loadedmetadata listener');
  assert.equal(typeof listeners[1][1], 'function', 'setup loadedmetadata listener');
  assert.equal(listeners[2][0], 'error', 'setup loadedmetadata listener');
  assert.equal(typeof listeners[2][1], 'function', 'setup loadedmetadata listener');

  listeners.length = 0;

  type = 'AUDIO';

  MediaGroups.setupListeners[type](type, playlistLoader, settings);

  assert.equal(listeners.length, 3, 'setup 3 event listeners');
  assert.equal(listeners[0][0], 'loadedmetadata', 'setup loadedmetadata listener');
  assert.equal(typeof listeners[0][1], 'function', 'setup loadedmetadata listener');
  assert.equal(listeners[1][0], 'loadedplaylist', 'setup loadedmetadata listener');
  assert.equal(typeof listeners[1][1], 'function', 'setup loadedmetadata listener');
  assert.equal(listeners[2][0], 'error', 'setup loadedmetadata listener');
  assert.equal(typeof listeners[2][1], 'function', 'setup loadedmetadata listener');

  listeners.length = 0;

  MediaGroups.setupListeners[type](type, null, settings);

  assert.equal(listeners.length, 0, 'no event listeners setup when no playlist loader');
});

QUnit.module('MediaGroups - initialize', {
  beforeEach(assert) {
    this.mediaTypes = MediaGroups.createMediaTypes();
    this.master = {
      mediaGroups: {
        'AUDIO': {},
        'SUBTITLES': {},
        'CLOSED-CAPTIONS': {}
      }
    };
    this.settings = {
      mode: 'html5',
      hls: {},
      tech: {
        addRemoteTextTrack(track) {
          return { track };
        }
      },
      segmentLoaders: {
        AUDIO: { on() {} },
        SUBTITLES: { on() {} }
      },
      requestOptions: { withCredentials: false, timeout: 10 },
      master: this.master,
      mediaTypes: this.mediaTypes,
      blacklistCurrentPlaylist() {}
    };
  }
});

QUnit.test('initialize audio forces default track when no audio groups provided',
function(assert) {
  const type = 'AUDIO';

  MediaGroups.initialize[type](type, this.settings);

  assert.deepEqual(this.master.mediaGroups[type],
    { main: { default: { default: true } } }, 'forced default audio group');
  assert.deepEqual(this.mediaTypes[type].groups,
    { main: [ { id: 'default', playlistLoader: null, default: true } ] },
    'creates group properties and no playlist loader');
  assert.ok(this.mediaTypes[type].tracks.default, 'created default track');
});

QUnit.test('initialize audio correctly generates tracks and playlist loaders',
function(assert) {
  const type = 'AUDIO';

  this.master.mediaGroups[type].aud1 = {
    en: { default: true, language: 'en' },
    fr: { default: false, language: 'fr', resolvedUri: 'aud1/fr.m3u8' }
  };
  this.master.mediaGroups[type].aud2 = {
    en: { default: true, language: 'en' },
    fr: { default: false, language: 'fr', resolvedUri: 'aud2/fr.m3u8' }
  };

  MediaGroups.initialize[type](type, this.settings);

  assert.notOk(this.master.mediaGroups[type].main, 'no default main group added');
  assert.deepEqual(this.mediaTypes[type].groups,
    {
      aud1: [
        { id: 'en', default: true, language: 'en', playlistLoader: null },
        { id: 'fr', default: false, language: 'fr', resolvedUri: 'aud1/fr.m3u8',
          // just so deepEqual passes since there is no other way to get the object
          // reference for the playlist loader. Assertions below will confirm that this is
          // not null.
          playlistLoader: this.mediaTypes[type].groups.aud1[1].playlistLoader }
      ],
      aud2: [
        { id: 'en', default: true, language: 'en', playlistLoader: null },
        { id: 'fr', default: false, language: 'fr', resolvedUri: 'aud2/fr.m3u8',
          // just so deepEqual passes since there is no other way to get the object
          // reference for the playlist loader. Assertions below will confirm that this is
          // not null.
          playlistLoader: this.mediaTypes[type].groups.aud2[1].playlistLoader }
      ]
    }, 'creates group properties');
  assert.ok(this.mediaTypes[type].groups.aud1[1].playlistLoader,
    'playlistLoader created for non muxed audio group');
  assert.ok(this.mediaTypes[type].groups.aud2[1].playlistLoader,
    'playlistLoader created for non muxed audio group');
  assert.ok(this.mediaTypes[type].tracks.en, 'created audio track');
  assert.ok(this.mediaTypes[type].tracks.fr, 'created audio track');
});

QUnit.test('initialize subtitles correctly generates tracks and playlist loaders',
function(assert) {
  const type = 'SUBTITLES';

  this.master.mediaGroups[type].sub1 = {
    'en': { language: 'en', resolvedUri: 'sub1/en.m3u8' },
    'en-forced': { language: 'en', resolvedUri: 'sub1/en-forced.m3u8', forced: true },
    'fr': { language: 'fr', resolvedUri: 'sub1/fr.m3u8' }
  };
  this.master.mediaGroups[type].sub2 = {
    'en': { language: 'en', resolvedUri: 'sub2/en.m3u8' },
    'en-forced': { language: 'en', resolvedUri: 'sub2/en-forced.m3u8', forced: true },
    'fr': { language: 'fr', resolvedUri: 'sub2/fr.m3u8' }
  };

  MediaGroups.initialize[type](type, this.settings);

  assert.deepEqual(this.mediaTypes[type].groups,
    {
      sub1: [
        { id: 'en', language: 'en', resolvedUri: 'sub1/en.m3u8',
          playlistLoader: this.mediaTypes[type].groups.sub1[0].playlistLoader },
        { id: 'fr', language: 'fr', resolvedUri: 'sub1/fr.m3u8',
          playlistLoader: this.mediaTypes[type].groups.sub1[1].playlistLoader }
      ],
      sub2: [
        { id: 'en', language: 'en', resolvedUri: 'sub2/en.m3u8',
          playlistLoader: this.mediaTypes[type].groups.sub2[0].playlistLoader },
        { id: 'fr', language: 'fr', resolvedUri: 'sub2/fr.m3u8',
          playlistLoader: this.mediaTypes[type].groups.sub2[1].playlistLoader }
      ]
    }, 'creates group properties');
  assert.ok(this.mediaTypes[type].groups.sub1[0].playlistLoader,
    'playlistLoader created');
  assert.ok(this.mediaTypes[type].groups.sub1[1].playlistLoader,
    'playlistLoader created');
  assert.ok(this.mediaTypes[type].groups.sub2[0].playlistLoader,
    'playlistLoader created');
  assert.ok(this.mediaTypes[type].groups.sub2[1].playlistLoader,
    'playlistLoader created');
  assert.ok(this.mediaTypes[type].tracks.en, 'created text track');
  assert.ok(this.mediaTypes[type].tracks.fr, 'created text track');
});

QUnit.test('initialize closed-captions correctly generates tracks and NO loaders',
function(assert) {
  const type = 'CLOSED-CAPTIONS';

  this.master.mediaGroups[type].CCs = {
    en608: { language: 'en', instreamId: 'CC1' },
    en708: { language: 'en', instreamId: 'SERVICE1' },
    fr608: { language: 'fr', instreamId: 'CC3' },
    fr708: { language: 'fr', instreamId: 'SERVICE3' }
  };

  MediaGroups.initialize[type](type, this.settings);

  assert.deepEqual(this.mediaTypes[type].groups,
    {
      CCs: [
        { id: 'en608', language: 'en', instreamId: 'CC1' },
        { id: 'fr608', language: 'fr', instreamId: 'CC3' }
      ]
    }, 'creates group properties');
  assert.ok(this.mediaTypes[type].tracks.en608, 'created text track');
  assert.ok(this.mediaTypes[type].tracks.fr608, 'created text track');
});

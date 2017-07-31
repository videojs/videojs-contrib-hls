import QUnit from 'qunit';
import {
  mimeTypesForPlaylist_,
  mapLegacyAvcCodecs_
} from '../../src/util/codecs';

const generateMedia = function(isMaat, isMuxed, hasVideoCodec, hasAudioCodec, isFMP4) {
  const codec = (hasVideoCodec ? 'avc1.deadbeef' : '') +
    (hasVideoCodec && hasAudioCodec ? ',' : '') +
    (hasAudioCodec ? 'mp4a.40.E' : '');
  const master = {
    mediaGroups: {},
    playlists: []
  };
  const media = {
    attributes: {}
  };

  if (isMaat) {
    master.mediaGroups.AUDIO = {
      test: {
        demuxed: {
          uri: 'foo.bar'
        }
      }
    };

    if (isMuxed) {
      master.mediaGroups.AUDIO.test.muxed = {};
    }
    media.attributes.AUDIO = 'test';
  }

  if (isFMP4) {
    // This is not a great way to signal that the playlist is fmp4 but
    // this is how we currently detect it in HLS so let's emulate it here
    media.segments = [
      {
        map: 'test'
      }
    ];
  }

  if (hasVideoCodec || hasAudioCodec) {
    media.attributes.CODECS = codec;
  }

  return [master, media];
};

QUnit.module('Codec to MIME Type Conversion');

const testMimeTypes = function(assert, isFMP4) {
  let container = isFMP4 ? 'mp4' : 'mp2t';

  let videoMime = `video/${container}`;
  let audioMime = `audio/${container}`;

  // no MAAT
  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(false, true, false, false, isFMP4)),
    [`${videoMime}; codecs="avc1.4d400d, mp4a.40.2"`],
    `no MAAT, container: ${container}, codecs: none`);

  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(false, true, true, false, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef"`],
    `no MAAT, container: ${container}, codecs: video`);

  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(false, true, false, true, isFMP4)),
    [`${audioMime}; codecs="mp4a.40.E"`],
    `no MAAT, container: ${container}, codecs: audio`);

  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(false, true, true, true, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef, mp4a.40.E"`],
    `no MAAT, container: ${container}, codecs: video, audio`);

  // MAAT, not muxed
  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(true, false, false, false, isFMP4)),
    [`${videoMime}; codecs="avc1.4d400d"`,
     `${audioMime}; codecs="mp4a.40.2"`],
    `MAAT, demuxed, container: ${container}, codecs: none`);

  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(true, false, true, false, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef"`,
     `${audioMime}; codecs="mp4a.40.2"`],
    `MAAT, demuxed, container: ${container}, codecs: video`);

  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(true, false, false, true, isFMP4)),
    [`${videoMime}; codecs="mp4a.40.E"`,
     `${audioMime}; codecs="mp4a.40.E"`],
    `MAAT, demuxed, container: ${container}, codecs: audio`);

  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(true, false, true, true, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef"`,
     `${audioMime}; codecs="mp4a.40.E"`],
    `MAAT, demuxed, container: ${container}, codecs: video, audio`);

  // MAAT, muxed
  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(true, true, false, false, isFMP4)),
    [`${videoMime}; codecs="avc1.4d400d, mp4a.40.2"`,
     `${audioMime}; codecs="mp4a.40.2"`],
    `MAAT, muxed, container: ${container}, codecs: none`);

  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(true, true, true, false, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef, mp4a.40.2"`,
     `${audioMime}; codecs="mp4a.40.2"`],
    `MAAT, muxed, container: ${container}, codecs: video`);

  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(true, true, false, true, isFMP4)),
    [`${videoMime}; codecs="mp4a.40.E"`,
     `${audioMime}; codecs="mp4a.40.E"`],
    `MAAT, muxed, container: ${container}, codecs: audio`);

  assert.deepEqual(mimeTypesForPlaylist_.apply(null,
      generateMedia(true, true, true, true, isFMP4)),
    [`${videoMime}; codecs="avc1.deadbeef, mp4a.40.E"`,
     `${audioMime}; codecs="mp4a.40.E"`],
    `MAAT, muxed, container: ${container}, codecs: video, audio`);
};

QUnit.test('recognizes muxed codec configurations', function(assert) {
  testMimeTypes(assert, false);
  testMimeTypes(assert, true);
});

QUnit.module('Map Legacy AVC Codec');

QUnit.test('maps legacy AVC codecs', function(assert) {
  assert.equal(mapLegacyAvcCodecs_('avc1.deadbeef'),
               'avc1.deadbeef',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('avc1.dead.beef, mp4a.something'),
               'avc1.dead.beef, mp4a.something',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('avc1.dead.beef,mp4a.something'),
               'avc1.dead.beef,mp4a.something',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('mp4a.something,avc1.dead.beef'),
               'mp4a.something,avc1.dead.beef',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('mp4a.something, avc1.dead.beef'),
               'mp4a.something, avc1.dead.beef',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('avc1.42001e'),
               'avc1.42001e',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('avc1.4d0020,mp4a.40.2'),
               'avc1.4d0020,mp4a.40.2',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('mp4a.40.2,avc1.4d0020'),
               'mp4a.40.2,avc1.4d0020',
               'does nothing for non legacy pattern');
  assert.equal(mapLegacyAvcCodecs_('mp4a.40.40'),
               'mp4a.40.40',
               'does nothing for non video codecs');

  assert.equal(mapLegacyAvcCodecs_('avc1.66.30'),
               'avc1.42001e',
               'translates legacy video codec alone');
  assert.equal(mapLegacyAvcCodecs_('avc1.66.30, mp4a.40.2'),
               'avc1.42001e, mp4a.40.2',
               'translates legacy video codec when paired with audio');
  assert.equal(mapLegacyAvcCodecs_('mp4a.40.2, avc1.66.30'),
               'mp4a.40.2, avc1.42001e',
               'translates video codec when specified second');
});

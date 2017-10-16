/* eslint-disable max-len */

import QUnit from 'qunit';
import RenditionMixin from '../src/rendition-mixin.js';
import videojs from 'video.js';

const makeMockPlaylist = function(options) {
  options = options || {};

  let playlist = {
    segments: [],
    attributes: {}
  };

  playlist.attributes.BANDWIDTH = options.bandwidth;

  if ('width' in options) {
    playlist.attributes.RESOLUTION = playlist.attributes.RESOLUTION || {};

    playlist.attributes.RESOLUTION.width = options.width;
  }

  if ('height' in options) {
    playlist.attributes.RESOLUTION = playlist.attributes.RESOLUTION || {};

    playlist.attributes.RESOLUTION.height = options.height;
  }

  if ('excludeUntil' in options) {
    playlist.excludeUntil = options.excludeUntil;
  }

  if ('uri' in options) {
    playlist.uri = options.uri;
  }

  if ('disabled' in options) {
    playlist.disabled = options.disabled;
  }

  return playlist;
};

const makeMockHlsHandler = function(playlistOptions) {
  let mcp = {
    fastQualityChange_: () => {
      mcp.fastQualityChange_.calls++;
    }
  };

  mcp.fastQualityChange_.calls = 0;

  let hlsHandler = {
    masterPlaylistController_: mcp
  };

  hlsHandler.playlists = new videojs.EventTarget();
  hlsHandler.playlists.master = { playlists: [] };

  playlistOptions.forEach((playlist, i) => {
    hlsHandler.playlists.master.playlists[i] = makeMockPlaylist(playlist);

    if (playlist.uri) {
      hlsHandler.playlists.master.playlists[playlist.uri] =
        hlsHandler.playlists.master.playlists[i];
    }
  });

  return hlsHandler;
};

QUnit.module('Rendition Selector API Mixin');

QUnit.test('adds the representations API to HlsHandler', function(assert) {
  let hlsHandler = makeMockHlsHandler([
    {}
  ]);

  RenditionMixin(hlsHandler);

  assert.equal(typeof hlsHandler.representations, 'function',
    'added the representations API');
});

QUnit.test('returns proper number of representations', function(assert) {
  let hlsHandler = makeMockHlsHandler([
    {}, {}, {}
  ]);

  RenditionMixin(hlsHandler);

  let renditions = hlsHandler.representations();

  assert.equal(renditions.length, 3, 'number of renditions is 3');
});

QUnit.test('returns representations in playlist order', function(assert) {
  let hlsHandler = makeMockHlsHandler([
    {
      bandwidth: 10
    },
    {
      bandwidth: 20
    },
    {
      bandwidth: 30
    }
  ]);

  RenditionMixin(hlsHandler);

  let renditions = hlsHandler.representations();

  assert.equal(renditions[0].bandwidth, 10, 'rendition has bandwidth 10');
  assert.equal(renditions[1].bandwidth, 20, 'rendition has bandwidth 20');
  assert.equal(renditions[2].bandwidth, 30, 'rendition has bandwidth 30');
});

QUnit.test('returns representations with width and height if present', function(assert) {
  let hlsHandler = makeMockHlsHandler([
    {
      bandwidth: 10,
      width: 100,
      height: 200
    },
    {
      bandwidth: 20,
      width: 500,
      height: 600
    },
    {
      bandwidth: 30
    }
  ]);

  RenditionMixin(hlsHandler);

  let renditions = hlsHandler.representations();

  assert.equal(renditions[0].width, 100, 'rendition has a width of 100');
  assert.equal(renditions[0].height, 200, 'rendition has a height of 200');
  assert.equal(renditions[1].width, 500, 'rendition has a width of 500');
  assert.equal(renditions[1].height, 600, 'rendition has a height of 600');
  assert.equal(renditions[2].width, undefined, 'rendition has a width of undefined');
  assert.equal(renditions[2].height, undefined, 'rendition has a height of undefined');
});

QUnit.test('incompatible playlists are not included in the representations list',
function(assert) {
  let hlsHandler = makeMockHlsHandler([
    {
      bandwidth: 0,
      excludeUntil: Infinity,
      uri: 'media0.m3u8'
    },
    {
      bandwidth: 0,
      excludeUntil: 0,
      uri: 'media1.m3u8'
    },
    {
      bandwidth: 0,
      excludeUntil: Date.now() + 999999,
      uri: 'media2.m3u8'
    },
    {
      bandwidth: 0,
      excludeUntil: 1,
      uri: 'media3.m3u8'
    },
    {
      bandwidth: 0,
      uri: 'media4.m3u8'
    }
  ]);

  RenditionMixin(hlsHandler);

  let renditions = hlsHandler.representations();

  assert.equal(renditions.length, 4, 'incompatible rendition not added');
  assert.equal(renditions[0].id, 'media1.m3u8', 'rendition is enabled');
  assert.equal(renditions[1].id, 'media2.m3u8', 'rendition is enabled');
  assert.equal(renditions[2].id, 'media3.m3u8', 'rendition is enabled');
  assert.equal(renditions[3].id, 'media4.m3u8', 'rendition is enabled');
});

QUnit.test('setting a representation to disabled sets disabled to true',
function(assert) {
  let renditiondisabled = 0;
  let hlsHandler = makeMockHlsHandler([
    {
      bandwidth: 0,
      excludeUntil: 0,
      uri: 'media0.m3u8'
    },
    {
      bandwidth: 0,
      excludeUntil: 0,
      uri: 'media1.m3u8'
    }
  ]);
  let playlists = hlsHandler.playlists.master.playlists;

  hlsHandler.playlists.on('renditiondisabled', function() {
    renditiondisabled++;
  });

  RenditionMixin(hlsHandler);

  let renditions = hlsHandler.representations();

  assert.equal(renditiondisabled, 0, 'renditiondisabled event has not been triggered');
  renditions[0].enabled(false);

  assert.equal(renditiondisabled, 1, 'renditiondisabled event has been triggered');
  assert.equal(playlists[0].disabled, true, 'rendition has been disabled');
  assert.equal(playlists[1].disabled, undefined, 'rendition has not been disabled');
  assert.equal(playlists[0].excludeUntil, 0,
    'excludeUntil not touched when disabling a rendition');
  assert.equal(playlists[1].excludeUntil, 0,
    'excludeUntil not touched when disabling a rendition');
});

QUnit.test('changing the enabled state of a representation calls fastQualityChange_',
function(assert) {
  let renditionEnabledEvents = 0;
  let hlsHandler = makeMockHlsHandler([
    {
      bandwidth: 0,
      disabled: true,
      uri: 'media0.m3u8'
    },
    {
      bandwidth: 0,
      uri: 'media1.m3u8'
    }
  ]);
  let mpc = hlsHandler.masterPlaylistController_;

  hlsHandler.playlists.on('renditionenabled', function() {
    renditionEnabledEvents++;
  });

  RenditionMixin(hlsHandler);

  let renditions = hlsHandler.representations();

  assert.equal(mpc.fastQualityChange_.calls, 0, 'fastQualityChange_ was never called');
  assert.equal(renditionEnabledEvents, 0,
    'renditionenabled event has not been triggered');

  renditions[0].enabled(true);

  assert.equal(mpc.fastQualityChange_.calls, 1, 'fastQualityChange_ was called once');
  assert.equal(renditionEnabledEvents, 1,
    'renditionenabled event has been triggered once');

  renditions[1].enabled(false);

  assert.equal(mpc.fastQualityChange_.calls, 2, 'fastQualityChange_ was called twice');
});

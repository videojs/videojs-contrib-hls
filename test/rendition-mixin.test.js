/* eslint-disable max-len */

import QUnit from 'qunit';
import RenditionMixin from '../src/rendition-mixin.js';

const makeMockPlaylist = function(options) {
  options = options || {};

  let playlist = {
    segments: []
  };

  if ('bandwidth' in options) {
    playlist.attributes = playlist.attributes || {};

    playlist.attributes.BANDWIDTH = options.bandwidth;
  }

  if ('width' in options) {
    playlist.attributes = playlist.attributes || {};
    playlist.attributes.RESOLUTION = playlist.attributes.RESOLUTION || {};

    playlist.attributes.RESOLUTION.width = options.width;
  }

  if ('height' in options) {
    playlist.attributes = playlist.attributes || {};
    playlist.attributes.RESOLUTION = playlist.attributes.RESOLUTION || {};

    playlist.attributes.RESOLUTION.height = options.height;
  }

  if ('excludeUntil' in options) {
    playlist.excludeUntil = options.excludeUntil;
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
    masterPlaylistController_: mcp,
    playlists: {
      master: {
        playlists: []
      }
    }
  };

  hlsHandler.playlists.master.playlists = playlistOptions.map(makeMockPlaylist);

  return hlsHandler;
};

QUnit.module('Rendition Selector API Mixin');

QUnit.test('adds the representations API to HlsHandler', function(assert) {
  let hlsHandler = makeMockHlsHandler([
    {}
  ]);

  RenditionMixin(hlsHandler);

  assert.equal(typeof hlsHandler.representations, 'function', 'added the representations API');
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

QUnit.test('representations are disabled if their excludeUntil is after Date.now', function(assert) {
  let hlsHandler = makeMockHlsHandler([
    {
      bandwidth: 0,
      excludeUntil: Infinity
    },
    {
      bandwidth: 0,
      excludeUntil: 0
    }
  ]);

  RenditionMixin(hlsHandler);

  let renditions = hlsHandler.representations();

  assert.equal(renditions[0].enabled(), false, 'rendition is not enabled');
  assert.equal(renditions[1].enabled(), true, 'rendition is enabled');
});

QUnit.test('setting a representation to disabled sets excludeUntil to Infinity', function(assert) {
  let hlsHandler = makeMockHlsHandler([
    {
      bandwidth: 0,
      excludeUntil: 0
    },
    {
      bandwidth: 0,
      excludeUntil: 0
    }
  ]);
  let playlists = hlsHandler.playlists.master.playlists;

  RenditionMixin(hlsHandler);

  let renditions = hlsHandler.representations();

  renditions[0].enabled(false);

  assert.equal(playlists[0].excludeUntil, Infinity, 'rendition has an infinite excludeUntil');
  assert.equal(playlists[1].excludeUntil, 0, 'rendition has an excludeUntil of zero');
});

QUnit.test('changing the enabled state of a representation calls fastQualityChange_', function(assert) {
  let hlsHandler = makeMockHlsHandler([
    {
      bandwidth: 0,
      excludeUntil: Infinity
    },
    {
      bandwidth: 0,
      excludeUntil: 0
    }
  ]);
  let mpc = hlsHandler.masterPlaylistController_;

  RenditionMixin(hlsHandler);

  let renditions = hlsHandler.representations();

  assert.equal(mpc.fastQualityChange_.calls, 0, 'fastQualityChange_ was never called');

  renditions[0].enabled(true);

  assert.equal(mpc.fastQualityChange_.calls, 1, 'fastQualityChange_ was called once');

  renditions[1].enabled(false);

  assert.equal(mpc.fastQualityChange_.calls, 2, 'fastQualityChange_ was called twice');
});

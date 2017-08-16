import { module, test } from 'qunit';
import {
  simpleSelector,
  movingAverageBandwidthSelector,
  minRebufferMaxBandwidthSelector,
  lowestBitrateCompatibleVariantSelector
} from '../src/playlist-selectors';
import Config from '../src/config';

module('Playlist Selectors', {
  beforeEach(assert) {
    const video = document.createElement('video');

    this.hls = {
      tech_: {
        el() {
          return video;
        }
      },
      playlists: {
        master: {
          playlists: []
        }
      }
    };
  },
  afterEach() {

  }
});

test('Exponential moving average has a configurable decay parameter', function(assert) {
  let playlist;
  const instantAverage = movingAverageBandwidthSelector(1.0);

  this.hls.playlists.master.playlists = [
    { attributes: { BANDWIDTH: 1 } },
    { attributes: { BANDWIDTH: 50 } },
    { attributes: { BANDWIDTH: 100 } }
  ];
  this.hls.systemBandwidth = 50 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = instantAverage.call(this.hls);
  assert.equal(playlist.attributes.BANDWIDTH, 50, 'selected the middle playlist');

  this.hls.systemBandwidth = 100 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = instantAverage.call(this.hls);
  assert.equal(playlist.attributes.BANDWIDTH, 100, 'selected the top playlist');

  const fiftyPercentDecay = movingAverageBandwidthSelector(0.5);

  this.hls.systemBandwidth = 100 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = fiftyPercentDecay.call(this.hls);
  assert.equal(playlist.attributes.BANDWIDTH, 100, 'selected the top playlist');

  // average = decay * systemBandwidth + (1 - decay) * average
  // bandwidth = 0.5 * systemBandwidth + 0.5 * (100 * variance + 1)
  // 50 * variance + 1 = 0.5 * (systemBandwidth + (100 * variance + 1))
  // 2 * 50 * variance + 2 = systemBandwidth + (100 * variance + 1)
  // 100 * variance + 2 - (100 * variance + 1) = systemBandwidth
  // 1 = systemBandwidth
  this.hls.systemBandwidth = 1;
  playlist = fiftyPercentDecay.call(this.hls);
  assert.equal(playlist.attributes.BANDWIDTH, 50, 'selected the middle playlist');
});

test('minRebufferMaxBandwidthSelector picks highest rendition without rebuffering',
function(assert) {
  let master = this.hls.playlists.master;
  let currentTime = 0;
  let bandwidth = 2000;
  let duration = 100;
  let segmentDuration = 10;
  let timeUntilRebuffer = 5;
  let currentTimeline = 0;
  let syncController = {
    getSyncPoint: (playlist) => playlist.syncPoint
  };

  const settings = () => {
    return {
      master,
      currentTime,
      bandwidth,
      duration,
      segmentDuration,
      timeUntilRebuffer,
      currentTimeline,
      syncController
    };
  };

  master.playlists = [
    { attributes: { BANDWIDTH: 100 }, syncPoint: false },
    { attributes: { BANDWIDTH: 500 }, syncPoint: false },
    { attributes: { BANDWIDTH: 1000 }, syncPoint: false },
    { attributes: { BANDWIDTH: 2000 }, syncPoint: true },
    { attributes: { BANDWIDTH: 5000 }, syncPoint: false }
  ];

  let result = minRebufferMaxBandwidthSelector(settings());

  assert.equal(result.playlist, master.playlists[1], 'selected the correct playlist');
  assert.equal(result.rebufferingImpact, 0, 'impact on rebuffering is 0');

  master.playlists = [
    { attributes: { BANDWIDTH: 100 }, syncPoint: false },
    { attributes: { BANDWIDTH: 500 }, syncPoint: false },
    { attributes: { BANDWIDTH: 1000 }, syncPoint: true },
    { attributes: { BANDWIDTH: 2000 }, syncPoint: true },
    { attributes: { BANDWIDTH: 5000 }, syncPoint: false }
  ];

  result = minRebufferMaxBandwidthSelector(settings());

  assert.equal(result.playlist, master.playlists[2], 'selected the corerct playlist');
  assert.equal(result.rebufferingImpact, 0, 'impact on rebuffering is 0');

  bandwidth = 500;
  timeUntilRebuffer = 3;

  result = minRebufferMaxBandwidthSelector(settings());

  assert.equal(result.playlist, master.playlists[0], 'selected the correct playlist');
  assert.equal(result.rebufferingImpact, 1, 'impact on rebuffering is 1 second');
});

test('lowestBitrateCompatibleVariantSelector picks lowest non-audio playlist',
  function(assert) {
    // Set this up out of order to make sure that the function sorts all
    // playlists by bandwidth
    this.hls.playlists.master.playlists = [
      { attributes: { BANDWIDTH: 10, CODECS: 'mp4a.40.2' } },
      { attributes: { BANDWIDTH: 100, CODECS: 'mp4a.40.2, avc1.4d400d' } },
      { attributes: { BANDWIDTH: 50, CODECS: 'mp4a.40.2, avc1.4d400d' } }
    ];

    const expectedPlaylist = this.hls.playlists.master.playlists[2];
    const testPlaylist = lowestBitrateCompatibleVariantSelector.call(this.hls);

    assert.equal(testPlaylist, expectedPlaylist,
      'Selected lowest compatible playlist with video assets');
  });

test('lowestBitrateCompatibleVariantSelector return null if no video exists',
  function(assert) {
    this.hls.playlists.master.playlists = [
      { attributes: { BANDWIDTH: 50, CODECS: 'mp4a.40.2' } },
      { attributes: { BANDWIDTH: 10, CODECS: 'mp4a.40.2' } },
      { attributes: { BANDWIDTH: 100, CODECS: 'mp4a.40.2' } }
    ];

    const testPlaylist = lowestBitrateCompatibleVariantSelector.call(this.hls);

    assert.equal(testPlaylist, null,
      'Returned null playlist since no video assets exist');
  });

test('simpleSelector switches up even without resolution information', function(assert) {
  let master = this.hls.playlists.master;

  master.playlists = [
    { attributes: { BANDWIDTH: 100 } },
    { attributes: { BANDWIDTH: 1000 } }
  ];

  const selectedPlaylist = simpleSelector(master, 2000, 1, 1);

  assert.equal(selectedPlaylist, master.playlists[1], 'selected the correct playlist');
});

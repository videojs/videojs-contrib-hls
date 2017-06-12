import { module, test } from 'qunit';
import { movingAverageBandwidthSelector } from '../src/playlist-selectors';
import Config from '../src/config';

const video = document.createElement('video');
const hls = {
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

module('Playlist Selectors');

test('Exponential moving average uses the Config.EWMA_DECAY variable', function(assert) {
  let playlist;
  const originalDecay = Config.EWMA_DECAY;

  Config.EWMA_DECAY = 1.0;

  const instantAverage = movingAverageBandwidthSelector();

  hls.playlists.master.playlists = [
    { attributes: { BANDWIDTH: 1 } },
    { attributes: { BANDWIDTH: 50 } },
    { attributes: { BANDWIDTH: 100 } }
  ];
  hls.systemBandwidth = 50 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = instantAverage.call(hls);
  assert.equal(playlist.attributes.BANDWIDTH, 50, 'selected the middle playlist');

  hls.systemBandwidth = 100 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = instantAverage.call(hls);
  assert.equal(playlist.attributes.BANDWIDTH, 100, 'selected the top playlist');

  Config.EWMA_DECAY = 0.5;
  const fiftyPercentDecay = movingAverageBandwidthSelector();

  hls.systemBandwidth = 100 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = fiftyPercentDecay.call(hls);
  assert.equal(playlist.attributes.BANDWIDTH, 100, 'selected the top playlist');

  // average = decay * systemBandwidth + (1 - decay) * average
  // bandwidth = 0.5 * systemBandwidth + 0.5 * (100 * variance + 1)
  // 50 * variance + 1 = 0.5 * (systemBandwidth + (100 * variance + 1))
  // 2 * 50 * variance + 2 = systemBandwidth + (100 * variance + 1)
  // 100 * variance + 2 - (100 * variance + 1) = systemBandwidth
  // 1 = systemBandwidth
  hls.systemBandwidth = 1;
  playlist = fiftyPercentDecay.call(hls);
  assert.equal(playlist.attributes.BANDWIDTH, 50, 'selected the middle playlist');

  Config.EWMA_DECAY = originalDecay;
});

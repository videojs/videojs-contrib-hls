import { module, test } from 'qunit';
import {
  lastBandwidthSelector,
  movingAverageBandwidthSelector,
  getBandwidth,
  crossedLowWaterLine,
  comparePlaylistBandwidth,
  comparePlaylistResolution
} from '../src/playlist-selectors';
import Config from '../src/config';
import videojs from 'video.js';

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

test('Exponential moving average has a configurable decay parameter', function(assert) {
  let playlist;
  const instantAverage = movingAverageBandwidthSelector(1.0);

  hls.tech_.currentTime = () => 10;
  hls.tech_.buffered = () => videojs.createTimeRanges([]);
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

  const fiftyPercentDecay = movingAverageBandwidthSelector(0.5);

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
});

test('getBandwidth appropriately uses average bandwidth when specified',
function(assert) {
  let playlist = {};

  assert.equal(getBandwidth(playlist, false), 0, 'bandwidth 0 when playlist has no info');
  assert.equal(getBandwidth(playlist, true), 0, 'bandwidth 0 when playlist has no info');

  playlist = {
    attributes: {}
  };

  assert.equal(getBandwidth(playlist, false), 0, 'bandwidth 0 when playlist has no info');
  assert.equal(getBandwidth(playlist, true), 0, 'bandwidth 0 when playlist has no info');

  playlist = {
    attributes: {
      BANDWIDTH: 9
    }
  };

  assert.equal(getBandwidth(playlist, false), 9, 'uses BANDWIDTH when available');
  assert.equal(getBandwidth(playlist, true), 9, 'uses BANDWIDTH when only one available');

  playlist.attributes['AVERAGE-BANDWIDTH'] = 3;

  assert.equal(getBandwidth(playlist, false),
               9,
               'uses BANDWIDTH when useAverageBandwidth is false');
  assert.equal(getBandwidth(playlist, true),
               3,
               'uses AVERAGE-BANDWIDTH when useAverageBandwidth is true');
});

test('crossedLowWaterLine detects when we have filled enough buffer', function(assert) {
  assert.notOk(crossedLowWaterLine(0, videojs.createTimeRanges([])),
               'false when no buffer');
  assert.notOk(crossedLowWaterLine(10, videojs.createTimeRanges([])),
               'false when no buffer');
  assert.notOk(crossedLowWaterLine(10, videojs.createTimeRanges([[0, 10]])),
               'false when not enough forward buffer');
  assert.notOk(crossedLowWaterLine(10, videojs.createTimeRanges([[0, 19]])),
               'false when not enough forward buffer');
  assert.notOk(crossedLowWaterLine(10, videojs.createTimeRanges([[10, 19]])),
               'false when not enough forward buffer');
  assert.notOk(crossedLowWaterLine(10, videojs.createTimeRanges([[0, 9.99], [10, 19]])),
               'false when not enough forward buffer');
  assert.ok(crossedLowWaterLine(10, videojs.createTimeRanges([[10, 40]])),
            'true when enough forward buffer');
});

test('comparePlaylistBandwidth properly compares playlist bandwidths', function(assert) {
  let left = {};
  let right = {};

  assert.equal(comparePlaylistBandwidth(false, left, right), 0, '0 when no info');
  assert.equal(comparePlaylistBandwidth(true, left, right), 0, '0 when no info');

  left = { attributes: {} };

  assert.equal(comparePlaylistBandwidth(false, left, right), 0, '0 when no info');
  assert.equal(comparePlaylistBandwidth(true, left, right), 0, '0 when no info');

  right = { attributes: {} };

  assert.equal(comparePlaylistBandwidth(false, left, right), 0, '0 when no info');
  assert.equal(comparePlaylistBandwidth(true, left, right), 0, '0 when no info');

  left = {
    attributes: {
      BANDWIDTH: 10
    }
  };

  assert.ok(comparePlaylistBandwidth(false, left, right) < 0,
            'left smaller when only left BANDWIDTH available');
  assert.ok(comparePlaylistBandwidth(true, left, right) < 0,
            'left smaller when only left BANDWIDTH available');

  left = {};
  right = {
    attributes: {
      BANDWIDTH: 10
    }
  };

  assert.ok(comparePlaylistBandwidth(false, left, right) > 0,
               'right smaller when only right BANDWIDTH available');
  assert.ok(comparePlaylistBandwidth(true, left, right) > 0,
               'right smaller when only right BANDWIDTH available');

  left = {
    attributes: {
      BANDWIDTH: 10
    }
  };

  assert.equal(comparePlaylistBandwidth(false, left, right),
               0,
               '0 when only BANDWIDTH and equal');
  assert.equal(comparePlaylistBandwidth(true, left, right),
               0,
               '0 when only BANDWIDTH and equal');

  left = {
    attributes: {
      BANDWIDTH: 15
    }
  };

  assert.equal(comparePlaylistBandwidth(false, left, right),
               5,
               'positive when left is greater');
  assert.equal(comparePlaylistBandwidth(true, left, right),
               5,
               'positive when left is greater');

  right = {
    attributes: {
      BANDWIDTH: 20
    }
  };

  assert.equal(comparePlaylistBandwidth(false, left, right),
               -5,
               'negative when right is greater');
  assert.equal(comparePlaylistBandwidth(true, left, right),
               -5,
               'negative when right is greater');

  left.attributes['AVERAGE-BANDWIDTH'] = 25;

  assert.equal(comparePlaylistBandwidth(false, left, right),
               -5,
               'uses BANDWIDTH when useAverageBandwidth is false');
  assert.equal(comparePlaylistBandwidth(true, left, right),
               5,
               'uses AVERAGE-BANDWIDTH when useAverageBandwidth is true');

  right.attributes['AVERAGE-BANDWIDTH'] = 31;

  assert.equal(comparePlaylistBandwidth(false, left, right),
               -5,
               'uses BANDWIDTH for both when useAverageBandwidth is false');
  assert.equal(comparePlaylistBandwidth(true, left, right),
               -6,
               'uses AVERAGE-BANDWIDTH for both when useAverageBandwidth is true');
});

test('comparePlaylistResolution properly compares playlist resolutions',
function(assert) {
  let left = {};
  let right = {};

  assert.equal(comparePlaylistResolution(false, left, right), 0, '0 when no info');
  assert.equal(comparePlaylistResolution(true, left, right), 0, '0 when no info');

  left = { attributes: {} };

  assert.equal(comparePlaylistResolution(false, left, right), 0, '0 when no info');
  assert.equal(comparePlaylistResolution(true, left, right), 0, '0 when no info');

  right = { attributes: {} };

  assert.equal(comparePlaylistResolution(false, left, right), 0, '0 when no info');
  assert.equal(comparePlaylistResolution(true, left, right), 0, '0 when no info');

  left = {
    attributes: {
      RESOLUTION: {
        width: 720
      }
    }
  };

  assert.ok(comparePlaylistResolution(false, left, right) < 0,
            'left smaller when only left width available');
  assert.ok(comparePlaylistResolution(true, left, right) < 0,
            'left smaller when only left width available');

  left = {};
  right = {
    attributes: {
      RESOLUTION: {
        width: 720
      }
    }
  };

  assert.ok(comparePlaylistResolution(false, left, right) > 0,
            'right smaller when only right width available');
  assert.ok(comparePlaylistResolution(true, left, right) > 0,
            'right smaller when only right width available');

  left = {
    attributes: {
      RESOLUTION: {
        width: 720
      }
    }
  };

  assert.equal(comparePlaylistResolution(false, left, right),
               0,
               '0 when widths are equal');
  assert.equal(comparePlaylistResolution(true, left, right),
               0,
               '0 when widths are equal');

  left.attributes.RESOLUTION.width = 1080;

  assert.equal(comparePlaylistResolution(false, left, right),
               360,
               'positive when left is greater');
  assert.equal(comparePlaylistResolution(true, left, right),
               360,
               'positive when left is greater');

  right.attributes.RESOLUTION.width = 1440;

  assert.equal(comparePlaylistResolution(false, left, right),
               -360,
               'negative when right is greater');
  assert.equal(comparePlaylistResolution(true, left, right),
               -360,
               'negative when right is greater');

  left = {
    attributes: {
      RESOLUTION: {
        width: 720
      },
      BANDWIDTH: 10
    }
  };
  right = {
    attributes: {
      RESOLUTION: {
        width: 720
      },
      BANDWIDTH: 10
    }
  };

  assert.equal(comparePlaylistResolution(false, left, right),
               0,
               'equal when width equal and BANDWIDTH equal');
  assert.equal(comparePlaylistResolution(true, left, right),
               0,
               'equal when width equal and BANDWIDTH equal');

  left.attributes['AVERAGE-BANDWIDTH'] = 10;
  right.attributes['AVERAGE-BANDWIDTH'] = 10;

  assert.equal(comparePlaylistResolution(false, left, right),
               0,
               'equal when width equal and BANDWIDTH equal');
  assert.equal(comparePlaylistResolution(true, left, right),
               0,
               'equal when width equal and AVERAGE-BANDWIDTH equal');

  left.attributes.BANDWIDTH = 9;

  assert.equal(comparePlaylistResolution(false, left, right),
               -1,
               'left smaller when width equal and BANDWIDTH smaller');
  assert.equal(comparePlaylistResolution(true, left, right),
               0,
               'equal when width equal and AVERAGE-BANDWIDTH equal');

  right.attributes.BANDWIDTH = 8;

  assert.equal(comparePlaylistResolution(false, left, right),
               1,
               'right smaller when width equal and BANDWIDTH smaller');
  assert.equal(comparePlaylistResolution(true, left, right),
               0,
               'equal when width equal and AVERAGE-BANDWIDTH equal');

  left.attributes.BANDWIDTH = 8;
  left.attributes['AVERAGE-BANDWIDTH'] = 9;

  assert.equal(comparePlaylistResolution(false, left, right),
               0,
               'equal when width equal and BANDWIDTH equal');
  assert.equal(comparePlaylistResolution(true, left, right),
               -1,
               'left smaller when width equal and AVERAGE-BANDWIDTH smaller');

  right.attributes['AVERAGE-BANDWIDTH'] = 8;

  assert.equal(comparePlaylistResolution(false, left, right),
               0,
               'equal when width equal and BANDWIDTH equal');
  assert.equal(comparePlaylistResolution(true, left, right),
               1,
               'right smaller when width equal and only right BANDWIDTH available');
});

test('lastBandwidthSelector uses average bandwidth once past low water line',
function(assert) {
  const lowAverageBandwidthPlaylist = {
    attributes: {
      'BANDWIDTH': 150,
      'AVERAGE-BANDWIDTH': 50
    }
  };
  const highAverageBandwidthPlaylist = {
    attributes: {
      'BANDWIDTH': 50,
      'AVERAGE-BANDWIDTH': 150
    }
  };

  hls.tech_.currentTime = () => 10;
  hls.tech_.buffered = () => videojs.createTimeRanges([]);
  hls.playlists.master.playlists = [
    highAverageBandwidthPlaylist,
    lowAverageBandwidthPlaylist
  ];
  hls.systemBandwidth = 100 * Config.BANDWIDTH_VARIANCE + 1;

  assert.equal(lastBandwidthSelector.call(hls),
               highAverageBandwidthPlaylist,
               'uses BANDWIDTH if not past low water line');

  hls.tech_.buffered =
    () => videojs.createTimeRanges([[10, 10 + Config.BUFFER_LOW_WATER_LINE]]);
  assert.equal(lastBandwidthSelector.call(hls),
               lowAverageBandwidthPlaylist,
               'uses AVERAGE-BANDWIDTH if past low water line');
});

test('movingAverageBandwidthSelector uses average bandwidth once past low water line',
function(assert) {
  const lowAverageBandwidthPlaylist = {
    attributes: {
      'BANDWIDTH': 150,
      'AVERAGE-BANDWIDTH': 50
    }
  };
  const highAverageBandwidthPlaylist = {
    attributes: {
      'BANDWIDTH': 50,
      'AVERAGE-BANDWIDTH': 150
    }
  };
  const instantAverage = movingAverageBandwidthSelector(1.0);

  hls.tech_.currentTime = () => 10;
  hls.tech_.buffered = () => videojs.createTimeRanges([]);
  hls.playlists.master.playlists = [
    highAverageBandwidthPlaylist,
    lowAverageBandwidthPlaylist
  ];
  hls.systemBandwidth = 100 * Config.BANDWIDTH_VARIANCE + 1;

  assert.equal(instantAverage.call(hls),
               highAverageBandwidthPlaylist,
               'uses BANDWIDTH if not past low water line');

  hls.tech_.buffered =
    () => videojs.createTimeRanges([[10, 10 + Config.BUFFER_LOW_WATER_LINE]]);
  assert.equal(instantAverage.call(hls),
               lowAverageBandwidthPlaylist,
               'uses AVERAGE-BANDWIDTH if past low water line');
});

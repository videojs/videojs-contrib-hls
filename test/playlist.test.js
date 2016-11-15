import Playlist from '../src/playlist';
import PlaylistLoader from '../src/playlist-loader';
import QUnit from 'qunit';
import xhrFactory from '../src/xhr';
import { useFakeEnvironment } from './test-helpers';

QUnit.module('Playlist Duration');

QUnit.test('total duration for live playlists is Infinity', function(assert) {
  let duration = Playlist.duration({
    segments: [{
      duration: 4,
      uri: '0.ts'
    }]
  });

  assert.equal(duration, Infinity, 'duration is infinity');
});

QUnit.module('Playlist Interval Duration');

QUnit.test('accounts for non-zero starting VOD media sequences', function(assert) {
  let duration = Playlist.duration({
    mediaSequence: 10,
    endList: true,
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      duration: 10,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      duration: 10,
      uri: '3.ts'
    }]
  });

  assert.equal(duration, 4 * 10, 'includes only listed segments');
});

QUnit.test('uses timeline values when available', function(assert) {
  let duration = Playlist.duration({
    mediaSequence: 0,
    endList: true,
    segments: [{
      start: 0,
      uri: '0.ts'
    }, {
      duration: 10,
      end: 2 * 10 + 2,
      uri: '1.ts'
    }, {
      duration: 10,
      end: 3 * 10 + 2,
      uri: '2.ts'
    }, {
      duration: 10,
      end: 4 * 10 + 2,
      uri: '3.ts'
    }]
  }, 4);

  assert.equal(duration, 4 * 10 + 2, 'used timeline values');
});

QUnit.test('works when partial timeline information is available', function(assert) {
  let duration = Playlist.duration({
    mediaSequence: 0,
    endList: true,
    segments: [{
      start: 0,
      uri: '0.ts'
    }, {
      duration: 9,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      duration: 10,
      start: 30.007,
      end: 40.002,
      uri: '3.ts'
    }, {
      duration: 10,
      end: 50.0002,
      uri: '4.ts'
    }]
  }, 5);

  assert.equal(duration, 50.0002, 'calculated with mixed intervals');
});

QUnit.test('uses timeline values for the expired duration of live playlists', function(assert) {
  let playlist = {
    mediaSequence: 12,
    segments: [{
      duration: 10,
      end: 120.5,
      uri: '0.ts'
    }, {
      duration: 9,
      uri: '1.ts'
    }]
  };
  let duration;

  duration = Playlist.duration(playlist, playlist.mediaSequence);
  assert.equal(duration, 110.5, 'used segment end time');
  duration = Playlist.duration(playlist, playlist.mediaSequence + 1);
  assert.equal(duration, 120.5, 'used segment end time');
  duration = Playlist.duration(playlist, playlist.mediaSequence + 2);
  assert.equal(duration, 120.5 + 9, 'used segment end time');
});

QUnit.test('looks outside the queried interval for live playlist timeline values',
function(assert) {
  let playlist = {
    mediaSequence: 12,
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      duration: 9,
      end: 120.5,
      uri: '1.ts'
    }]
  };
  let duration;

  duration = Playlist.duration(playlist, playlist.mediaSequence);
  assert.equal(duration, 120.5 - 9 - 10, 'used segment end time');
});

QUnit.test('ignores discontinuity sequences later than the end', function(assert) {
  let duration = Playlist.duration({
    mediaSequence: 0,
    discontinuityStarts: [1, 3],
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      discontinuity: true,
      duration: 9,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      discontinuity: true,
      duration: 10,
      uri: '3.ts'
    }]
  }, 2);

  assert.equal(duration, 19, 'excluded the later segments');
});

QUnit.test('handles trailing segments without timeline information', function(assert) {
  let duration;
  let playlist = {
    mediaSequence: 0,
    endList: true,
    segments: [{
      start: 0,
      end: 10.5,
      uri: '0.ts'
    }, {
      duration: 9,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      start: 29.45,
      end: 39.5,
      uri: '3.ts'
    }]
  };

  duration = Playlist.duration(playlist, 3);
  assert.equal(duration, 29.45, 'calculated duration');

  duration = Playlist.duration(playlist, 2);
  assert.equal(duration, 19.5, 'calculated duration');
});

QUnit.test('uses timeline intervals when segments have them', function(assert) {
  let duration;
  let playlist = {
    mediaSequence: 0,
    segments: [{
      start: 0,
      end: 10,
      uri: '0.ts'
    }, {
      duration: 9,
      uri: '1.ts'
    }, {
      start: 20.1,
      end: 30.1,
      duration: 10,
      uri: '2.ts'
    }]
  };

  duration = Playlist.duration(playlist, 2);
  assert.equal(duration, 20.1, 'used the timeline-based interval');

  duration = Playlist.duration(playlist, 3);
  assert.equal(duration, 30.1, 'used the timeline-based interval');
});

QUnit.test('counts the time between segments as part of the earlier segment\'s duration',
function(assert) {
  let duration = Playlist.duration({
    mediaSequence: 0,
    endList: true,
    segments: [{
      start: 0,
      end: 10,
      uri: '0.ts'
    }, {
      start: 10.1,
      end: 20.1,
      duration: 10,
      uri: '1.ts'
    }]
  }, 1);

  assert.equal(duration, 10.1, 'included the segment gap');
});

QUnit.test('accounts for discontinuities', function(assert) {
  let duration = Playlist.duration({
    mediaSequence: 0,
    endList: true,
    discontinuityStarts: [1],
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      discontinuity: true,
      duration: 10,
      uri: '1.ts'
    }]
  }, 2);

  assert.equal(duration, 10 + 10, 'handles discontinuities');
});

QUnit.test('a non-positive length interval has zero duration', function(assert) {
  let playlist = {
    mediaSequence: 0,
    discontinuityStarts: [1],
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      discontinuity: true,
      duration: 10,
      uri: '1.ts'
    }]
  };

  assert.equal(Playlist.duration(playlist, 0), 0, 'zero-length duration is zero');
  assert.equal(Playlist.duration(playlist, 0, false), 0, 'zero-length duration is zero');
  assert.equal(Playlist.duration(playlist, -1), 0, 'negative length duration is zero');
});

QUnit.module('Playlist Seekable');

QUnit.test('calculates seekable time ranges from the available segments', function(assert) {
  let playlist = {
    mediaSequence: 0,
    segments: [{
      duration: 10,
      uri: '0.ts'
    }, {
      duration: 10,
      uri: '1.ts'
    }],
    endList: true
  };
  let seekable = Playlist.seekable(playlist);

  assert.equal(seekable.length, 1, 'there are seekable ranges');
  assert.equal(seekable.start(0), 0, 'starts at zero');
  assert.equal(seekable.end(0), Playlist.duration(playlist), 'ends at the duration');
});

QUnit.test('master playlists have empty seekable ranges', function(assert) {
  let seekable = Playlist.seekable({
    playlists: [{
      uri: 'low.m3u8'
    }, {
      uri: 'high.m3u8'
    }]
  });

  assert.equal(seekable.length, 0, 'no seekable ranges from a master playlist');
});

QUnit.test('seekable end is three target durations from the actual end of live playlists',
function(assert) {
  let seekable = Playlist.seekable({
    mediaSequence: 0,
    syncInfo: {
      time: 0,
      mediaSequence: 0
    },
    targetDuration: 10,
    segments: [{
      duration: 7,
      uri: '0.ts'
    }, {
      duration: 10,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      duration: 10,
      uri: '3.ts'
    }]
  });

  assert.equal(seekable.length, 1, 'there are seekable ranges');
  assert.equal(seekable.start(0), 0, 'starts at zero');
  assert.equal(seekable.end(0), 7, 'ends three target durations from the last segment');
});

QUnit.test('seekable end accounts for non-standard target durations', function(assert) {
  let seekable = Playlist.seekable({
    targetDuration: 2,
    mediaSequence: 0,
    syncInfo: {
      time: 0,
      mediaSequence: 0
    },
    segments: [{
      duration: 2,
      uri: '0.ts'
    }, {
      duration: 2,
      uri: '1.ts'
    }, {
      duration: 1,
      uri: '2.ts'
    }, {
      duration: 2,
      uri: '3.ts'
    }, {
      duration: 2,
      uri: '4.ts'
    }]
  });

  assert.equal(seekable.start(0), 0, 'starts at the earliest available segment');
  assert.equal(seekable.end(0),
              9 - (2 + 2 + 1),
              'allows seeking no further than three segments from the end');
});

QUnit.test('playlist with no sync points has empty seekable range', function(assert) {
  let seekable = Playlist.seekable({
    targetDuration: 10,
    mediaSequence: 0,
    segments: [{
      duration: 7,
      uri: '0.ts'
    }, {
      duration: 10,
      uri: '1.ts'
    }, {
      duration: 10,
      uri: '2.ts'
    }, {
      duration: 10,
      uri: '3.ts'
    }]
  });

  assert.equal(seekable.length, 0, 'no seekable range for playlist with no sync points');
});

QUnit.test('seekable uses available sync points for calculating seekable range',
  function(assert) {
    let seekable;

    seekable = Playlist.seekable({
      targetDuration: 10,
      mediaSequence: 100,
      syncInfo: {
        time: 50,
        mediaSequence: 95
      },
      segments: [
        {
          duration: 10,
          uri: '0.ts'
        },
        {
          duration: 10,
          uri: '1.ts'
        },
        {
          duration: 10,
          uri: '2.ts'
        },
        {
          duration: 10,
          uri: '3.ts'
        },
        {
          duration: 10,
          uri: '4.ts'
        }
      ]
    });

    assert.ok(seekable.length, 'seekable range calculated');
    assert.equal(seekable.start(0), 100, 'estimated start time based on expired sync point');
    assert.equal(seekable.end(0), 120, 'allows seeking no further than three segments from the end');

    seekable = Playlist.seekable({
      targetDuration: 10,
      mediaSequence: 100,
      segments: [
        {
          duration: 10,
          uri: '0.ts'
        },
        {
          duration: 10,
          uri: '1.ts',
          start: 108.5,
          end: 118.4
        },
        {
          duration: 10,
          uri: '2.ts'
        },
        {
          duration: 10,
          uri: '3.ts'
        },
        {
          duration: 10,
          uri: '4.ts'
        }
      ]
    });

    assert.ok(seekable.length, 'seekable range calculated');
    assert.equal(seekable.start(0), 98.5, 'estimated start time using segmentSync');
    assert.equal(seekable.end(0), 118.4, 'allows seeking no further than three segments from the end');

    seekable = Playlist.seekable({
      targetDuration: 10,
      mediaSequence: 100,
      syncInfo: {
        time: 50,
        mediaSequence: 95
      },
      segments: [
        {
          duration: 10,
          uri: '0.ts'
        },
        {
          duration: 10,
          uri: '1.ts',
          start: 108.5,
          end: 118.5
        },
        {
          duration: 10,
          uri: '2.ts'
        },
        {
          duration: 10,
          uri: '3.ts'
        },
        {
          duration: 10,
          uri: '4.ts'
        }
      ]
    });

    assert.ok(seekable.length, 'seekable range calculated');
    assert.equal(seekable.start(0), 98.5, 'estimated start time using nearest sync point (segmentSync in this case)');
    assert.equal(seekable.end(0), 118.5, 'allows seeking no further than three segments from the end');

    seekable = Playlist.seekable({
      targetDuration: 10,
      mediaSequence: 100,
      syncInfo: {
        time: 90.8,
        mediaSequence: 99
      },
      segments: [
        {
          duration: 10,
          uri: '0.ts'
        },
        {
          duration: 10,
          uri: '1.ts'
        },
        {
          duration: 10,
          uri: '2.ts',
          start: 118.5,
          end: 128.5
        },
        {
          duration: 10,
          uri: '3.ts'
        },
        {
          duration: 10,
          uri: '4.ts'
        }
      ]
    });

    assert.ok(seekable.length, 'seekable range calculated');
    assert.equal(seekable.start(0), 100.8, 'estimated start time using nearest sync point (expiredSync in this case)');
    assert.equal(seekable.end(0), 118.5, 'allows seeking no further than three segments from the end');
  });

QUnit.module('Playlist Media Index For Time', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeHls = {
      xhr: xhrFactory()
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('can get media index by playback position for non-live videos', function(assert) {
  let media;
  let loader = new PlaylistLoader('media.m3u8', this.fakeHls);

  loader.load();

  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:0\n' +
    '#EXTINF:4,\n' +
    '0.ts\n' +
    '#EXTINF:5,\n' +
    '1.ts\n' +
    '#EXTINF:6,\n' +
    '2.ts\n' +
    '#EXT-X-ENDLIST\n'
  );

  media = loader.media();

  assert.equal(Playlist.getMediaInfoForTime_(media, -1, 0, 0).mediaIndex, 0,
              'the index is never less than zero');
  assert.equal(Playlist.getMediaInfoForTime_(media, 0, 0, 0).mediaIndex, 0,
    'time zero is index zero');
  assert.equal(Playlist.getMediaInfoForTime_(media, 3, 0, 0).mediaIndex, 0,
    'time three is index zero');
  assert.equal(Playlist.getMediaInfoForTime_(media, 10, 0, 0).mediaIndex, 2,
    'time 10 is index 2');
  assert.equal(Playlist.getMediaInfoForTime_(media, 22, 0, 0).mediaIndex, 2,
              'time greater than the length is index 2');
});

QUnit.test('returns the lower index when calculating for a segment boundary', function(assert) {
  let media;
  let loader = new PlaylistLoader('media.m3u8', this.fakeHls);

  loader.load();

  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:0\n' +
    '#EXTINF:4,\n' +
    '0.ts\n' +
    '#EXTINF:5,\n' +
    '1.ts\n' +
    '#EXT-X-ENDLIST\n'
  );

  media = loader.media();

  assert.equal(Playlist.getMediaInfoForTime_(media, 4, 0, 0).mediaIndex, 0,
    'rounds down exact matches');
  assert.equal(Playlist.getMediaInfoForTime_(media, 3.7, 0, 0).mediaIndex, 0,
    'rounds down');
  assert.equal(Playlist.getMediaInfoForTime_(media, 4.5, 0, 0).mediaIndex, 1,
    'rounds up at 0.5');
});

QUnit.test(
'accounts for non-zero starting segment time when calculating media index',
function(assert) {
  let media;
  let loader = new PlaylistLoader('media.m3u8', this.fakeHls);

  loader.load();

  this.requests.shift().respond(200, null,
    '#EXTM3U\n' +
    '#EXT-X-MEDIA-SEQUENCE:1001\n' +
    '#EXTINF:4,\n' +
    '1001.ts\n' +
    '#EXTINF:5,\n' +
    '1002.ts\n'
  );

  media = loader.media();

  assert.equal(
    Playlist.getMediaInfoForTime_(media, 45, 0, 150).mediaIndex,
    0,
    'expired content returns 0 for earliest segment available'
  );
  assert.equal(
    Playlist.getMediaInfoForTime_(media, 75, 0, 150).mediaIndex,
    0,
    'expired content returns 0 for earliest segment available'
  );
  assert.equal(
    Playlist.getMediaInfoForTime_(media, 0, 0, 150).mediaIndex,
    0,
    'time of 0 with no expired time returns first segment'
  );
  assert.equal(
    Playlist.getMediaInfoForTime_(media, 50 + 100, 0, 150).mediaIndex,
    0,
    'calculates the earliest available position'
  );
  assert.equal(
    Playlist.getMediaInfoForTime_(media, 50 + 100 + 2, 0, 150).mediaIndex,
    0,
    'calculates within the first segment'
  );
  assert.equal(
    Playlist.getMediaInfoForTime_(media, 50 + 100 + 2, 0, 150).mediaIndex,
    0,
    'calculates within the first segment'
  );
  assert.equal(
    Playlist.getMediaInfoForTime_(media, 50 + 100 + 4, 0, 150).mediaIndex,
    0,
    'calculates earlier segment on exact boundary match'
  );
  assert.equal(
    Playlist.getMediaInfoForTime_(media, 50 + 100 + 4.5, 0, 150).mediaIndex,
    1,
    'calculates within the second segment'
  );
  assert.equal(
    Playlist.getMediaInfoForTime_(media, 50 + 100 + 6, 0, 150).mediaIndex,
    1,
    'calculates within the second segment'
  );

  assert.equal(
    Playlist.getMediaInfoForTime_(media, 159, 0, 150).mediaIndex,
    1,
    'returns last segment when time is equal to end of last segment'
  );
  assert.equal(
    Playlist.getMediaInfoForTime_(media, 160, 0, 150).mediaIndex,
    1,
    'returns last segment when time is past end of last segment'
  );
});

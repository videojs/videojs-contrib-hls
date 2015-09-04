/* Tests for the playlist utilities */
(function(window, videojs) {
  'use strict';
  var Playlist = videojs.Hls.Playlist;

  module('Playlist Duration');

  test('total duration for live playlists is Infinity', function() {
    var duration = Playlist.duration({
      segments: [{
        duration: 4,
        uri: '0.ts'
      }]
    });

    equal(duration, Infinity, 'duration is infinity');
  });

  module('Playlist Interval Duration');

  test('accounts expired duration for live playlists', function() {
    var duration = Playlist.duration({
      mediaSequence: 10,
      segments: [{
        duration: 10,
        uri: '10.ts'
      }, {
        duration: 10,
        uri: '11.ts'
      }, {
        duration: 10,
        uri: '12.ts'
      }, {
        duration: 10,
        uri: '13.ts'
      }]
    }, 0, 14);

    equal(duration, 14 * 10, 'duration includes dropped segments');
  });

  test('accounts for non-zero starting VOD media sequences', function() {
    var duration = Playlist.duration({
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

    equal(duration, 4 * 10, 'includes only listed segments');
  });

  test('uses PTS values when available', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      endList: true,
      segments: [{
        minVideoPts: 1,
        minAudioPts: 2,
        uri: '0.ts'
      }, {
        duration: 10,
        maxVideoPts: 2 * 10 * 1000 + 1,
        maxAudioPts: 2 * 10 * 1000 + 2,
        uri: '1.ts'
      }, {
        duration: 10,
        maxVideoPts: 3 * 10 * 1000 + 1,
        maxAudioPts: 3 * 10 * 1000 + 2,
        uri: '2.ts'
      }, {
        duration: 10,
        maxVideoPts: 4 * 10 * 1000 + 1,
        maxAudioPts: 4 * 10 * 1000 + 2,
        uri: '3.ts'
      }]
    }, 0, 4);

    equal(duration, ((4 * 10 * 1000 + 2) - 1) * 0.001, 'used PTS values');
  });

  test('works when partial PTS information is available', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      endList: true,
      segments: [{
        minVideoPts: 1,
        minAudioPts: 2,
        maxVideoPts: 10 * 1000 + 1,

        // intentionally less duration than video
        // the max stream duration should be used
        maxAudioPts: 10 * 1000 + 1,
        uri: '0.ts'
      }, {
        duration: 9,
        uri: '1.ts'
      }, {
        duration: 10,
        uri: '2.ts'
      }, {
        duration: 10,
        minVideoPts: 30 * 1000 + 7,
        minAudioPts: 30 * 1000 + 10,
        maxVideoPts: 40 * 1000 + 1,
        maxAudioPts: 40 * 1000 + 2,
        uri: '3.ts'
      }, {
        duration: 10,
        maxVideoPts: 50 * 1000 + 1,
        maxAudioPts: 50 * 1000 + 2,
        uri: '4.ts'
      }]
    }, 0, 5);

    equal(duration,
          ((50 * 1000 + 2) - 1) * 0.001,
          'calculated with mixed intervals');
  });

  test('ignores segments before the start', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      segments: [{
        duration: 10,
        uri: '0.ts'
      }, {
        duration: 10,
        uri: '1.ts'
      }, {
        duration: 10,
        uri: '2.ts'
      }]
    }, 1, 3);

    equal(duration, 10 + 10, 'ignored the first segment');
  });

  test('ignores discontinuity sequences earlier than the start', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      discontinuityStarts: [1, 3],
      segments: [{
        minVideoPts: 0,
        minAudioPts: 0,
        maxVideoPts: 10 * 1000,
        maxAudioPts: 10 * 1000,
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
    }, 2, 4);

    equal(duration, 10 + 10, 'excluded the earlier segments');
  });

  test('ignores discontinuity sequences later than the end', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      discontinuityStarts: [1, 3],
      segments: [{
        minVideoPts: 0,
        minAudioPts: 0,
        maxVideoPts: 10 * 1000,
        maxAudioPts: 10 * 1000,
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
    }, 0, 2);

    equal(duration, 19, 'excluded the later segments');
  });

  test('handles trailing segments without PTS information', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      endList: true,
      segments: [{
        minVideoPts: 0,
        minAudioPts: 0,
        maxVideoPts: 10 * 1000,
        maxAudioPts: 10 * 1000,
        uri: '0.ts'
      }, {
        duration: 9,
        uri: '1.ts'
      }, {
        duration: 10,
        uri: '2.ts'
      }, {
        minVideoPts: 29.5 * 1000,
        minAudioPts: 29.5 * 1000,
        maxVideoPts: 39.5 * 1000,
        maxAudioPts: 39.5 * 1000,
        uri: '3.ts'
      }]
    }, 0, 3);

    equal(duration, 29.5, 'calculated duration');
  });

  test('uses PTS intervals when the start and end segment have them', function() {
    var playlist, duration;
    playlist = {
      mediaSequence: 0,
      segments: [{
        minVideoPts: 0,
        minAudioPts: 0,
        maxVideoPts: 10 * 1000,
        maxAudioPts: 10 * 1000,
        uri: '0.ts'
      }, {
        duration: 9,
        uri: '1.ts'
      },{
        minVideoPts: 20 * 1000 + 100,
        minAudioPts: 20 * 1000 + 100,
        maxVideoPts: 30 * 1000 + 100,
        maxAudioPts: 30 * 1000 + 100,
        duration: 10,
        uri: '2.ts'
      }]
    };
    duration = Playlist.duration(playlist, 0, 2);

    equal(duration, 20.1, 'used the PTS-based interval');

    duration = Playlist.duration(playlist, 0, 3);
    equal(duration, 30.1, 'used the PTS-based interval');
  });

  test('works for media without audio', function() {
    equal(Playlist.duration({
      mediaSequence: 0,
      endList: true,
      segments: [{
        minVideoPts: 0,
        maxVideoPts: 9 * 1000,
        uri: 'no-audio.ts'
      }]
    }), 9, 'used video PTS values');
  });

  test('works for media without video', function() {
    equal(Playlist.duration({
      mediaSequence: 0,
      endList: true,
      segments: [{
        minAudioPts: 0,
        maxAudioPts: 9 * 1000,
        uri: 'no-video.ts'
      }]
    }), 9, 'used video PTS values');
  });

  test('uses the largest continuous available PTS ranges', function() {
    var playlist = {
      mediaSequence: 0,
      segments: [{
        minVideoPts: 0,
        minAudioPts: 0,
        maxVideoPts: 10 * 1000,
        maxAudioPts: 10 * 1000,
        uri: '0.ts'
      }, {
        duration: 10,
        uri: '1.ts'
      }, {
        // starts 0.5s earlier than the previous segment indicates
        minVideoPts: 19.5 * 1000,
        minAudioPts: 19.5 * 1000,
        maxVideoPts: 29.5 * 1000,
        maxAudioPts: 29.5 * 1000,
        uri: '2.ts'
      }, {
        duration: 10,
        uri: '3.ts'
      }, {
        // ... but by the last segment, there is actual 0.5s more
        // content than duration indicates
        minVideoPts: 40.5 * 1000,
        minAudioPts: 40.5 * 1000,
        maxVideoPts: 50.5 * 1000,
        maxAudioPts: 50.5 * 1000,
        uri: '4.ts'
      }]
    };

    equal(Playlist.duration(playlist, 0, 5),
          50.5,
          'calculated across the larger PTS interval');
  });

  test('counts the time between segments as part of the earlier segment\'s duration', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      endList: true,
      segments: [{
        minVideoPts: 0,
        minAudioPts: 0,
        maxVideoPts: 1 * 10 * 1000,
        maxAudioPts: 1 * 10 * 1000,
        uri: '0.ts'
      }, {
        minVideoPts: 1 * 10 * 1000 + 100,
        minAudioPts: 1 * 10 * 1000 + 100,
        maxVideoPts: 2 * 10 * 1000 + 100,
        maxAudioPts: 2 * 10 * 1000 + 100,
        duration: 10,
        uri: '1.ts'
      }]
    }, 0, 1);

    equal(duration, (1 * 10 * 1000 + 100) * 0.001, 'included the segment gap');
  });

  test('accounts for discontinuities', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      endList: true,
      discontinuityStarts: [1],
      segments: [{
        minVideoPts: 0,
        minAudioPts: 0,
        maxVideoPts: 1 * 10 * 1000,
        maxAudioPts: 1 * 10 * 1000,
        uri: '0.ts'
      }, {
        discontinuity: true,
        minVideoPts: 2 * 10 * 1000,
        minAudioPts: 2 * 10 * 1000,
        maxVideoPts: 3 * 10 * 1000,
        maxAudioPts: 3 * 10 * 1000,
        duration: 10,
        uri: '1.ts'
      }]
    }, 0, 2);

    equal(duration, 10 + 10, 'handles discontinuities');
  });

  test('does not count ending segment gaps across a discontinuity', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      discontinuityStarts: [1],
      endList: true,
      segments: [{
        minVideoPts: 0,
        minAudioPts: 0,
        maxVideoPts: 1 * 10 * 1000,
        maxAudioPts: 1 * 10 * 1000,
        uri: '0.ts'
      }, {
        discontinuity: true,
        minVideoPts: 1 * 10 * 1000 + 100,
        minAudioPts: 1 * 10 * 1000 + 100,
        maxVideoPts: 2 * 10 * 1000 + 100,
        maxAudioPts: 2 * 10 * 1000 + 100,
        duration: 10,
        uri: '1.ts'
      }]
    }, 0, 1);

    equal(duration, (1 * 10 * 1000) * 0.001, 'did not include the segment gap');
  });

  test('trailing duration on the final segment can be excluded', function() {
    var duration = Playlist.duration({
      mediaSequence: 0,
      endList: true,
      segments: [{
        minVideoPts: 0,
        minAudioPts: 0,
        maxVideoPts: 1 * 10 * 1000,
        maxAudioPts: 1 * 10 * 1000,
        uri: '0.ts'
      }, {
        minVideoPts: 1 * 10 * 1000 + 100,
        minAudioPts: 1 * 10 * 1000 + 100,
        maxVideoPts: 2 * 10 * 1000 + 100,
        maxAudioPts: 2 * 10 * 1000 + 100,
        duration: 10,
        uri: '1.ts'
      }]
    }, 0, 1, false);

    equal(duration, (1 * 10 * 1000) * 0.001, 'did not include the segment gap');
  });

  test('a non-positive length interval has zero duration', function() {
    var playlist = {
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

    equal(Playlist.duration(playlist, 0, 0), 0, 'zero-length duration is zero');
    equal(Playlist.duration(playlist, 0, 0, false), 0, 'zero-length duration is zero');
    equal(Playlist.duration(playlist, 0, -1), 0, 'negative length duration is zero');
    equal(Playlist.duration(playlist, 2, 1, false), 0, 'negative length duration is zero');
  });

  module('Playlist Seekable');

  test('calculates seekable time ranges from the available segments', function() {
    var playlist = {
      mediaSequence: 0,
      segments: [{
        duration: 10,
        uri: '0.ts'
      }, {
        duration: 10,
        uri: '1.ts'
      }],
      endList: true
    }, seekable = Playlist.seekable(playlist);

    equal(seekable.length, 1, 'there are seekable ranges');
    equal(seekable.start(0), 0, 'starts at zero');
    equal(seekable.end(0), Playlist.duration(playlist), 'ends at the duration');
  });

  test('master playlists have empty seekable ranges', function() {
    var seekable = Playlist.seekable({
      playlists: [{
        uri: 'low.m3u8'
      }, {
        uri: 'high.m3u8'
      }]
    });
    equal(seekable.length, 0, 'no seekable ranges from a master playlist');
  });

  test('seekable end is LIVE_SYNC_DURATION_COUNT from the actual end of live playlists', function() {
    var seekableEnd, seekable = Playlist.seekable({
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

    if (videojs.Hls.LIVE_SYNC_DURATION_COUNT <= 3) {
      seekableEnd = 37 - (10 * videojs.Hls.LIVE_SYNC_DURATION_COUNT);
    } else {
      //if we make this const bigger than 3, we need to update the manifest in this test to remain useful,
      //so fail to remind someone to do that.
      seekableEnd = -1;
    }

    equal(seekable.length, 1, 'there are seekable ranges');
    equal(seekable.start(0), 0, 'starts at zero');
    equal(seekable.end(0), seekableEnd, 'ends LIVE_SYNC_DURATION_COUNT from the last segment');
  });

  test('only considers available segments', function() {
    var seekableEnd, seekable = Playlist.seekable({
      targetDuration: 10,
      mediaSequence: 7,
      segments: [{
        uri: '8.ts'
      }, {
        uri: '9.ts'
      }, {
        uri: '10.ts'
      }, {
        uri: '11.ts'
      }]
    });

    if (videojs.Hls.LIVE_SYNC_DURATION_COUNT <= 3) {
      seekableEnd = 40 - (10 * videojs.Hls.LIVE_SYNC_DURATION_COUNT);
    } else {
      //if we make this const bigger than 3, we need to update the manifest in this test to remain useful,
      //so fail to remind someone to do that.
      seekableEnd = -1;
    }

    equal(seekable.length, 1, 'there are seekable ranges');
    equal(seekable.start(0), 0, 'starts at the earliest available segment');
    equal(seekable.end(0), seekableEnd, 'ends Hls.LIVE_SYNC_DURATION_COUNT from the last available segment');
  });

  test('seekable end accounts for non-standard target durations', function() {
    var seekable = Playlist.seekable({
      targetDuration: 2,
      mediaSequence: 0,
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
    equal(seekable.start(0), 0, 'starts at the earliest available segment');
    equal(seekable.end(0),
          9 - (2 * videojs.Hls.LIVE_SYNC_DURATION_COUNT),
          'allows seeking no further than LIVE_SYNC_DURATION_COUNT from the end');
  });

})(window, window.videojs);

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

  test('uses timeline values when available', function() {
    var duration = Playlist.duration({
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

    equal(duration, 4 * 10 + 2, 'used timeline values');
  });

  test('works when partial timeline information is available', function() {
    var duration = Playlist.duration({
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

    equal(duration, 50.0002, 'calculated with mixed intervals');
  });

  test('uses timeline values for the expired duration of live playlists', function() {
    var playlist = {
      mediaSequence: 12,
      segments: [{
        duration: 10,
        end: 120.5,
        uri: '0.ts'
      }, {
        duration: 9,
        uri: '1.ts'
      }]
    }, duration;

    duration = Playlist.duration(playlist, playlist.mediaSequence);
    equal(duration, 110.5, 'used segment end time');
    duration = Playlist.duration(playlist, playlist.mediaSequence + 1);
    equal(duration, 120.5, 'used segment end time');
    duration = Playlist.duration(playlist, playlist.mediaSequence + 2);
    equal(duration, 120.5 + 9, 'used segment end time');
  });

  test('looks outside the queried interval for live playlist timeline values', function() {
    var playlist = {
      mediaSequence: 12,
      segments: [{
        duration: 10,
        uri: '0.ts'
      }, {
        duration: 9,
        end: 120.5,
        uri: '1.ts'
      }]
    }, duration;

    duration = Playlist.duration(playlist, playlist.mediaSequence);
    equal(duration, 120.5 - 9 - 10, 'used segment end time');
  });

  test('ignores discontinuity sequences later than the end', function() {
    var duration = Playlist.duration({
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

    equal(duration, 19, 'excluded the later segments');
  });

  test('handles trailing segments without timeline information', function() {
    var playlist, duration;
    playlist = {
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
    equal(duration, 29.45, 'calculated duration');

    duration = Playlist.duration(playlist, 2);
    equal(duration, 19.5, 'calculated duration');
  });

  test('uses timeline intervals when segments have them', function() {
    var playlist, duration;
    playlist = {
      mediaSequence: 0,
      segments: [{
        start: 0,
        end: 10,
        uri: '0.ts'
      }, {
        duration: 9,
        uri: '1.ts'
      },{
        start: 20.1,
        end: 30.1,
        duration: 10,
        uri: '2.ts'
      }]
    };
    duration = Playlist.duration(playlist, 2);

    equal(duration, 20.1, 'used the timeline-based interval');

    duration = Playlist.duration(playlist, 3);
    equal(duration, 30.1, 'used the timeline-based interval');
  });

  test('counts the time between segments as part of the earlier segment\'s duration', function() {
    var duration = Playlist.duration({
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

    equal(duration, 10.1, 'included the segment gap');
  });

  test('accounts for discontinuities', function() {
    var duration = Playlist.duration({
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

    equal(duration, 10 + 10, 'handles discontinuities');
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

    equal(Playlist.duration(playlist, 0), 0, 'zero-length duration is zero');
    equal(Playlist.duration(playlist, 0, false), 0, 'zero-length duration is zero');
    equal(Playlist.duration(playlist, -1), 0, 'negative length duration is zero');
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

  test('seekable end is three target durations from the actual end of live playlists', function() {
    var seekable = Playlist.seekable({
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
    equal(seekable.length, 1, 'there are seekable ranges');
    equal(seekable.start(0), 0, 'starts at zero');
    equal(seekable.end(0), 7, 'ends three target durations from the last segment');
  });

  test('only considers available segments', function() {
    var seekable = Playlist.seekable({
      mediaSequence: 7,
      segments: [{
        uri: '8.ts',
        duration: 10
      }, {
        uri: '9.ts',
        duration: 10
      }, {
        uri: '10.ts',
        duration: 10
      }, {
        uri: '11.ts',
        duration: 10
      }]
    });
    equal(seekable.length, 1, 'there are seekable ranges');
    equal(seekable.start(0), 0, 'starts at the earliest available segment');
    equal(seekable.end(0), 10, 'ends three target durations from the last available segment');
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
          9 - (2 + 2 + 1),
          'allows seeking no further than three segments from the end');
  });

})(window, window.videojs);

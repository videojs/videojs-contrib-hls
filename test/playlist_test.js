/* Tests for the playlist utilities */
(function(window, videojs) {
  'use strict';
  var Playlist = videojs.Hls.Playlist;

  module('Playlist Utilities');

  test('total duration for live playlists is Infinity', function() {
    var duration = Playlist.duration({
      segments: [{
        duration: 4,
        uri: '0.ts'
      }]
    });

    equal(duration, Infinity, 'duration is infinity');
  });

  test('interval duration does not include upcoming live segments', function() {
    var duration = Playlist.duration({
      segments: [{
        duration: 4,
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
    }, 0, 3);

    equal(duration, 4, 'does not include upcoming live segments');
  });

  test('calculates seekable time ranges from the available segments', function() {
    var playlist = {
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

  test('adjusts seekable to the live playlist window', function() {
    var seekable = Playlist.seekable({
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
    equal(seekable.length, 1, 'there are seekable ranges');
    equal(seekable.start(0), 10 * 7, 'starts at the earliest available segment');
    equal(seekable.end(0), 10 * 8, 'ends three target durations from the last available segment');
  });

  test('seekable end accounts for non-standard target durations', function() {
    var seekable = Playlist.seekable({
      targetDuration: 2,
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
          9 - (2 * 3),
          'allows seeking no further than three target durations from the end');
  });

})(window, window.videojs);

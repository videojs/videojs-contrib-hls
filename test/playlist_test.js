(function(window) {

var Playlist = window.videojs.Hls.Playlist;

module('Playlist', {
  setup: function() {},
  teardown: function() {}
});

test('filtering and sorting playlists by bandwidth', function() {
  var playlists, filtered;

  playlists = [
    { attributes: { BANDWIDTH: 200 } },
    { attributes: { BANDWIDTH: 300 } },
    { attributes: { BANDWIDTH: 100 } }
  ];

  playlists.sort(Playlist.compareBandwidth);
  equal(playlists[0].attributes.BANDWIDTH, 100);
  equal(playlists[1].attributes.BANDWIDTH, 200);
  equal(playlists[2].attributes.BANDWIDTH, 300);

  filtered = Playlist.filterByBandwidth(playlists, 300);
  equal(filtered.length, 2);
  equal(filtered[0].attributes.BANDWIDTH, 100);
  equal(filtered[1].attributes.BANDWIDTH, 200);
});

test('filtering and sorting playlists by resolution', function() {
  var playlists, filtered;

  playlists = [
    { attributes: { RESOLUTION: { width: 200, height: 200 } } },
    { attributes: { RESOLUTION: { width: 300, height: 300 } } },
    { attributes: { RESOLUTION: { width: 100, height: 100 } } }
  ];

  playlists.sort(Playlist.compareResolution);
  equal(playlists[0].attributes.RESOLUTION.width, 100);
  equal(playlists[1].attributes.RESOLUTION.width, 200);
  equal(playlists[2].attributes.RESOLUTION.width, 300);

  filtered = Playlist.filterByResolution(playlists, 200, 200);
  equal(filtered.length, 2);
  equal(filtered[0].attributes.RESOLUTION.width, 100);
  equal(filtered[1].attributes.RESOLUTION.width, 200);
});

test('selecting playlists', function() {
  var playlist, playlists;

  playlists = [
    { attributes: { BANDWIDTH: 200, RESOLUTION: { width: 200, height: 200 } } },
    { attributes: { BANDWIDTH: 300, RESOLUTION: { width: 300, height: 300 } } },
    { attributes: { BANDWIDTH: 100, RESOLUTION: { width: 100, height: 100 } } }
  ];

  playlist = Playlist.selectPlaylist(playlists, { bandwidth: 299 });
  strictEqual(playlist, playlists[0], 'best bandwidth variant chosen');

  playlist = Playlist.selectPlaylist(playlists, { bandwidth: 1 });
  strictEqual(playlist, playlists[2], 'fell back to lowest variant');

  playlist = Playlist.selectPlaylist(playlists, { width: 200, height: 200 });
  strictEqual(playlist, playlists[0], 'best resolution variant chosen');

  playlist = Playlist.selectPlaylist(playlists, { width: 1, height: 1 });
  strictEqual(playlist, playlists[1], 'fell back to best bandwidth');
});

})(window);
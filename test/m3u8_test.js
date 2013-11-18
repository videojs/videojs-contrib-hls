(function(window) {
  var 
    m3u8parser;

  module('environment');

  test('is sane', function() {
    expect(1);
    ok(true);
  });

  /*
    Manfiest controller
  */

  module('manifest controller', {
    setup: function() {
      manifestController = new window.videojs.hls.ManifestController();
      this.vjsget = window.videojs.get;
      window.videojs.get = function(url, success) {
        success(window.brightcove_playlist_data);
      };
    },
    teardown: function() {
      window.videojs.get = this.vjsget;
    }
  });

  test('should create', function() {
    ok(manifestController);
  });

  test('should return a parsed object', function() {
    var data = manifestController.parseManifest(window.brightcove_playlist_data);

    ok(data);
    equal(data.playlistItems.length, 4, 'Has correct rendition count');
    equal(data.playlistItems[0].bandwidth, 240000, 'First rendition index bandwidth is correct');
    equal(data.playlistItems[0]["program-id"], 1, 'First rendition index program-id is correct');
    equal(data.playlistItems[0].resolution.width, 396, 'First rendition index resolution width is correct');
    equal(data.playlistItems[0].resolution.height, 224, 'First rendition index resolution height is correct');
  });

  test('should get a manifest from hermes', function() {
    manifestController.loadManifest('http://example.com/16x9-master.m3u8',
                                    function(responseData) {
                                      ok(responseData);
                                    },
                                    function() {
                                      ok(false, 'does not error');
                                    },
                                    function() {});
  });

  /*
    M3U8 Test Suite
  */

  module('m3u8 parser', {
    setup: function() {
      m3u8parser = new window.videojs.hls.M3U8Parser();
    }
  });

  test('should create my parser', function() {
    ok(m3u8parser !== undefined);
  });

  test('should successfully parse manifest data', function() {
    var parsedData = m3u8parser.parse(window.playlistData);
    ok(parsedData);
  });

  test('should populate the manifest data object', function() {
    var data = m3u8parser.parse(window.playlistData);

    notEqual(data, null, 'data is not NULL');
    equal(data.invalidReasons.length, 0, 'data has 0 invalid reasons');
    equal(data.hasValidM3UTag, true, 'data has valid EXTM3U');
    equal(data.targetDuration, 10, 'data has correct TARGET DURATION');
    equal(data.allowCache, "NO", 'acceptable ALLOW CACHE');
    equal(data.isPlaylist, false, 'data is parsed as a PLAYLIST as expected');
    equal(data.playlistType, "VOD", 'acceptable PLAYLIST TYPE');
    equal(data.mediaItems.length, 16, 'acceptable mediaItem count');
    equal(data.mediaSequence, 0, 'MEDIA SEQUENCE is correct');
    equal(data.totalDuration, -1, "ZEN TOTAL DURATION is unknown as expected");
    equal(data.hasEndTag, true, 'should have ENDLIST tag');
  });

  module('brightcove playlist', {
    setup: function() {
      m3u8parser = new window.videojs.hls.M3U8Parser();
    }
  });

  test('should parse a brightcove manifest data', function() {
    var data = m3u8parser.parse(window.brightcove_playlist_data);

    ok(data);
    equal(data.playlistItems.length, 4, 'Has correct rendition count');
    equal(data.isPlaylist, true, 'data is parsed as a PLAYLIST as expected');
    equal(data.playlistItems[0].bandwidth, 240000, 'First rendition index bandwidth is correct');
    equal(data.playlistItems[0]["program-id"], 1, 'First rendition index program-id is correct');
    equal(data.playlistItems[0].resolution.width, 396, 'First rendition index resolution width is correct');
    equal(data.playlistItems[0].resolution.height, 224, 'First rendition index resolution height is correct');

  });
})(this);
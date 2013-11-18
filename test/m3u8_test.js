(function(window) {
  var
    Handlebars = this.Handlebars,
    manifestController = this.manifestController,
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

  /*3.4.7.  EXT-X-PLAYLIST-TYPE

   The EXT-X-PLAYLIST-TYPE tag provides mutability information about the
   Playlist file.  It applies to the entire Playlist file.  It is
   OPTIONAL.  Its format is:

   #EXT-X-PLAYLIST-TYPE:<EVENT|VOD>

   Section 6.2.1 defines the implications of the EXT-X-PLAYLIST-TYPE
   tag.

   The EXT-X-PLAYLIST-TYPE tag MUST NOT appear in a Master Playlist.
   */
  test('should have parsed VOD playlist type', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {playlistType: 'VOD'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    equal(data.invalidReasons.length, 0, 'data has 0 invalid reasons');
    equal(data.playlistType, "VOD", 'acceptable PLAYLIST TYPE');
  });

  test('should have parsed EVENT playlist type', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {playlistType: 'EVENT'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    notEqual(data, null, 'data is not NULL');
    equal(data.invalidReasons.length, 0, 'data has 0 invalid reasons');
    equal(data.playlistType, "EVENT", 'acceptable PLAYLIST TYPE');
  });

  test('should have assumed VOD playlist type if not defined', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    equal(data.invalidReasons.length, 0, 'data has 0 invalid reasons');
    equal(data.playlistType, "VOD", 'acceptable PLAYLIST TYPE');
  });

  test('should have an invalid reason due to invalid playlist type', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {playlistType: 'baklsdhfajsdf'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    notEqual(data, null, 'data is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.invalidReasons[0], 'Invalid Playlist Type Value: baklsdhfajsdf');
  });

  test('should have an invalid reason due to invalid playlist type', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {playlistType: ''},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    notEqual(data, null, 'data is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.invalidReasons[0], 'Invalid Playlist Type Value: \'\'');
  });

  /*3.4.2.  EXT-X-TARGETDURATION

   The EXT-X-TARGETDURATION tag specifies the maximum media segment
   duration.  The EXTINF duration of each media segment in the Playlist
   file, when rounded to the nearest integer, MUST be less than or equal
   to the target duration.  This tag MUST appear once in a Media
   Playlist file.  It applies to the entire Playlist file.  Its format
   is:

   #EXT-X-TARGETDURATION:<s>

   where s is a decimal-integer indicating the target duration in
   seconds.

   The EXT-X-TARGETDURATION tag MUST NOT appear in a Master Playlist.
  */

  test('valid target duration', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template),
      testData = {targetDuration: '10'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    notEqual(data, null, 'data is not NULL');
    equal(data.targetDuration, 10, 'data has correct TARGET DURATION');
    equal(data.invalidReasons.length, 0, 'data has 1 invalid reasons');
  });

  test('NaN target duration', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template),
      testData = {targetDuration: '10'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    notEqual(data, null, 'data is not NULL');
    equal(data.targetDuration, 10, 'data has correct TARGET DURATION');
    equal(data.invalidReasons.length, 0, 'data has 1 invalid reasons');

    testData = {targetDuration: 'string'};
    playlistData = playlistTemplate(testData);
    data = m3u8parser.parse(playlistData);
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.invalidReasons[0], 'Invalid Target Duration Value: string');

    testData = {targetDuration: ''};
    playlistData = playlistTemplate(testData);
    data = m3u8parser.parse(playlistData);
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.invalidReasons[0], 'Invalid Target Duration Value: \'\'');

    testData = {};
    playlistData = playlistTemplate(testData);
    notEqual(data, null, 'data is not NULL');
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.invalidReasons[0], 'Invalid Target Duration Value: '+ undefined);

  });

  test('target duration lower than segment', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template),
      testData = {targetDuration: '4'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.invalidReasons[0], 'Invalid Target Duration Value: 4 is lower than segments');
  });
  
  /*3.4.3.  EXT-X-MEDIA-SEQUENCE

   Each media segment in a Playlist has a unique integer sequence
   number.  The sequence number of a segment is equal to the sequence
   number of the segment that preceded it plus one.  The EXT-X-MEDIA-
   SEQUENCE tag indicates the sequence number of the first segment that
   appears in a Playlist file.  Its format is:

   #EXT-X-MEDIA-SEQUENCE:<number>

   where number is a decimal-integer.  The sequence number MUST NOT
   decrease.

   A Media Playlist file MUST NOT contain more than one EXT-X-MEDIA-
   SEQUENCE tag.  If the Media Playlist file does not contain an EXT-X-
   MEDIA-SEQUENCE tag then the sequence number of the first segment in
   the playlist SHALL be considered to be 0.  A client MUST NOT assume
   that segments with the same sequence number in different Media
   Playlists contain matching content.
  
   A media URI is not required to contain its sequence number.
  */

  test('media sequence is valid in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: '0'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 0, 'data has 0 invalid reasons');
    equal(data.mediaSequence, 0, 'MEDIA SEQUENCE is correct');
  });

  test('media sequence is encountered twice in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: '0', mediaSequence1: '1'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 0, 'data has 0 invalid reasons');
    equal(data.mediaSequence, 0, 'MEDIA SEQUENCE tags after the first should be ignored');
  });

  test('media sequence is undefined in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: ''},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 0, 'data has 0 invalid reasons');
    equal(data.mediaSequence, 0, 'MEDIA SEQUENCE should default to 0 when not present.');
  });

  test('media sequence is empty in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: ''},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.mediaSequence, 0, 'Invalid Media Sequence Value: \'\'');
  });

  test('media sequence is high (non-zero in first file) in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: '1'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.invalidReasons[0], 'Invalid Media Sequence Value: 1');
  });

  test('media sequence (-1) in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: '-1'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.invalidReasons[0], 'Invalid Media Sequence Value: -1');
  });

  test('media sequence invalid (string) in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: 'asdfkasdkfl'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.invalidReasons[0], 'Invalid Media Sequence Value: asdfkasdkfl');
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
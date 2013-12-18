(function(window, console) {
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
    Manifest controller
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
    equal(data.playlists.length, 4, 'Has correct rendition count');
    equal(data.playlists[0].attributes.bandwidth, 240000, 'First rendition index bandwidth is correct');
    equal(data.playlists[0].attributes.programId, 1, 'First rendition index program-id is correct');
    equal(data.playlists[0].attributes.resolution.width, 396, 'First rendition index resolution width is correct');
    equal(data.playlists[0].attributes.resolution.height, 224, 'First rendition index resolution height is correct');
  });

  test('should get a manifest from an external URL', function() {
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
      m3u8parser = window.videojs.hls.M3U8Parser;
    }
  });

  test('should create my parser', function() {
    ok(m3u8parser !== undefined);
  });

  test('should successfully parse manifest data', function() {
    var parsedData = m3u8parser.parse(window.playlistData);
    ok(parsedData);
  });

  test('valid manifest should populate the manifest data object', function() {
    var data = m3u8parser.parse(window.playlistData);

    notEqual(data, null, 'data is not NULL');
    equal(data.openTag, true, 'data has valid EXTM3U');
    equal(data.targetDuration, 10, 'data has correct TARGET DURATION');
    equal(data.allowCache, undefined, 'ALLOW-CACHE is not present in the manifest');
    equal(data.playlistType, "VOD", 'acceptable PLAYLIST TYPE');
    equal(data.segments.length, 17, 'there are 17 segments in the manifest');
    equal(data.mediaSequence, 0, 'MEDIA SEQUENCE is correct');
    equal(data.totalDuration, undefined, "no total duration is specified");
    equal(data.closeTag, true, 'should have ENDLIST tag');
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
    //equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    equal(data.playlistType, "VOD", 'acceptable PLAYLIST TYPE');
  });

  test('should have parsed EVENT playlist type', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {playlistType: 'EVENT'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    notEqual(data, null, 'data is not NULL');
    //equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    equal(data.playlistType, "EVENT", 'acceptable PLAYLIST TYPE');
  });

  test('handles a missing playlist type', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    //equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    //equal(data.warnings, 'EXT-X-PLAYLIST-TYPE was empty or missing.  Assuming VOD');
    equal(data.playlistType, undefined, 'no PLAYLIST TYPE present');
  });

  test('should have an invalid reason due to invalid playlist type', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {playlistType: 'baklsdhfajsdf'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    notEqual(data, null, 'data is not NULL');
    //equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    //equal(data.invalidReasons[0], 'Invalid Playlist Type Value: \'baklsdhfajsdf\'');
  });

  test('handles an empty playlist type', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {playlistType: ''},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    notEqual(data, null, 'data is not NULL');
    //equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    //equal(data.warnings, 'EXT-X-PLAYLIST-TYPE was empty or missing.  Assuming VOD');
    equal(data.playlistType, '', 'PLAYLIST TYPE is the empty string');
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
    //equal(data.invalidReasons.length, 0, 'data has 1 invalid reasons');
  });

  test('NaN target duration', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template),
      testData = {targetDuration: 'string'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    console.log(playlistData);
    console.log(data.targetDuration);
    notEqual(data, null, 'data is not NULL');    
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 0 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Target Duration Value: \'NaN\'');
  });

  test('empty target duration', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template),
      testData = {targetDuration: '\'\''},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    console.log(playlistData);
    console.log(data.targetDuration);
    notEqual(data, null, 'data is not NULL');    
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Target Duration Value: \'NaN\'');
  });

  test('undefined target duration', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template),
      testData = {},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);
    console.log(playlistData);
    console.log(data.targetDuration);
    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Target Duration Value: \'undefined\'');

  });

  test('target duration lower than segment', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template),
      testData = {targetDuration: '4'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Target Duration Value: 4 is lower than segments');
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
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    equal(data.mediaSequence, 0, 'MEDIA SEQUENCE is correct');
  });

  test('media sequence is encountered twice in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: '0', mediaSequence1: '1'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    equal(data.mediaSequence, 0, 'MEDIA SEQUENCE tags after the first should be ignored');
  });

  test('media sequence is undefined in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: ''},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    equal(data.mediaSequence, undefined, 'MEDIA SEQUENCE is undefined');
  });

  test('media sequence is empty in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: ''},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    equal(data.mediaSequence, '', 'media sequence is the empty string');
  });

  test('media sequence is high (non-zero in first file) in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: '1'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Media Sequence Value: \'1\'');
  });

  test('handles invalid media sequence numbers in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: '-1'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Media Sequence Value: \'-1\'');
    equal(data.mediaSequence, -1, 'negative media sequence numbers don\'t break parsing');
  });

  test('media sequence invalid (string) in the playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {mediaSequence: 'asdfkasdkfl'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Media Sequence Value: \'asdfkasdkfl\'');
  });

  module('Representative Playlist', {
    setup: function() {
      m3u8parser = window.videojs.hls.M3U8Parser;
    }
  });

  test('should parse real manifest data', function() {
    var data = m3u8parser.parse(window.brightcove_playlist_data);

    ok(data);
    equal(data.playlists.length, 4, 'has correct playlist count');
    equal(data.playlists[0].attributes.bandwidth, 240000, 'first rendition index bandwidth is correct');
    equal(data.playlists[0].attributes.programId, 1, 'first rendition index program-id is correct');
    equal(data.playlists[0].attributes.resolution.width,
          396,
          'first rendition index resolution width is correct');
    equal(data.playlists[0].attributes.resolution.height,
          224,
          'first rendition index resolution height is correct');

  });

  /*3.3.2.  EXTINF

   The EXTINF tag specifies the duration of a media segment.  It applies
   only to the media segment that follows it, and MUST be followed by a
   media segment URI.  Each media segment MUST be preceded by an EXTINF
   tag.  Its format is:

   #EXTINF:<duration>,<title>

   where duration is an decimal-integer or decimal-floating-point number
   that specifies the duration of the media segment in seconds.
   Durations that are reported as integers SHOULD be rounded to the
   nearest integer.  Durations MUST be integers if the protocol version
   of the Playlist file is less than 3.  Durations SHOULD be floating-
   point if the version is equal to or greater than 3.  The remainder of
   the line following the comma is an optional human-readable
   informative title of the media segment.

   The EXTINF duration of each media segment in the Playlist
   file, when rounded to the nearest integer, MUST be less than or equal
   to the target duration.
  */
  
  test('test valid extinf values in playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {version: 4, extInf: '10', extInf1: '10', extInf2: '10', segment: 'hls_450k_video.ts'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
  });

  test('test valid extinf without associated segment in playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {version: 4, extInf: '10', extInf1: '10', extInf2: '10'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    //equal(data.invalidReasons[0], 'Invalid Segment Data: \'#EXTINF missing segment\'');
  });

  //
  test('test invalid extinf values in playlist', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {version: 4, extInf: 'asdf', extInf1: '10', extInf2: '10', segment: 'hls_450k_video.ts'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
  });

  //its best practice that every extinf have the same value, but its not required
  test('test inconsistent extinf values in playlist below target duration', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {version: 4, extInf: '10', extInf1: '7', extInf2: '10', segment: 'hls_450k_video.ts'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
  });

  //extinf values must be below the target duration
  test('test inconsistent extinf values in playlist above target duration', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {version: 4, extInf: '10', extInf1: '7', extInf2: '10', segment: 'hls_450k_video.ts'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Segment Data: \'#EXTINF value higher than #TARGETDURATION\'');
  });

  //extinf values must be below the target duration
  test('test floating-point values not accepted with version 3', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {version: 3, extInf: '10.5', extInf1: '10.5', extInf2: '10.5', segment: 'hls_450k_video.ts'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Segment Data: \'#EXTINF value not an integer\'');
  });

  //extinf values must be below the target duration
  test('test floating-point values accepted with version 4', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {version: 4, extInf: '10.5', extInf1: '10.5', extInf2: '10.5', segment: 'hls_450k_video.ts'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
  });

  //extinf values must be below the target duration
  test('test empty EXTINF values', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {version: 4, extInf: '', extInf1: '10.5', extInf2: '10.5', segment: 'hls_450k_video.ts'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid Segment Data: \'#EXTINF value empty\'');
  });

  /*
  3.3.6.  EXT-X-ALLOW-CACHE

   The EXT-X-ALLOW-CACHE tag indicates whether the client MAY or MUST
   NOT cache downloaded media segments for later replay.  It MAY occur
   anywhere in the Playlist file; it MUST NOT occur more than once.  The
   EXT-X-ALLOW-CACHE tag applies to all segments in the playlist.  Its
   format is:

   #EXT-X-ALLOW-CACHE:<YES|NO>
  */
  
  test('test EXT-X-ALLOW-CACHE YES', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_allow_cache),
      testData = {version: 4, allowCache: 'YES'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    equal(data.allowCache, 'YES', 'EXT-X-ALLOW-CACHE should be YES');
  });

  test('test EXT-X-ALLOW-CACHE NO', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_allow_cache),
      testData = {version: 4, allowCache: 'NO'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    equal(data.allowCache, 'NO', 'EXT-X-ALLOW-CACHE should be NO');
  });

  test('test EXT-X-ALLOW-CACHE invalid, default to YES', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_allow_cache),
      testData = {version: 4, allowCache: 'YESTERDAYNO'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid EXT-X-ALLOW-CACHE value: \'YESTERDAYNO\'');
    equal(data.allowCache, 'YES', 'EXT-X-ALLOW-CACHE should default to YES.');
  });

  test('test EXT-X-ALLOW-CACHE empty, default to YES', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_allow_cache),
      testData = {version: 4, allowCache: ''},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // equal(data.invalidReasons[0], 'Invalid EXT-X-ALLOW-CACHE value: \'\'');
    equal(data.allowCache, 'YES', 'EXT-X-ALLOW-CACHE should default to YES.');
  });

  test('test EXT-X-ALLOW-CACHE missing, default to YES', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_allow_cache),
      testData = {version: 4},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    // notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // equal(data.invalidReasons.length, 1, 'No EXT-X-ALLOW-CACHE specified.  Default: YES.');
    equal(data.allowCache, 'YES', 'EXT-X-ALLOW-CACHE should default to YES');
  });
  
  test('test EXT-X-BYTERANGE valid', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_byte_range),
      testData = {version: 4, byteRange: '522828,0', byteRange1: '587500,522828', byteRange2: '44556,8353216'},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    //notEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    //equal(data.invalidReasons.length, 0, 'Errors object should be empty.');
    //TODO: Validate the byteRange info
    equal(data.segments.length, 16, '16 segments should have been parsed.');
    equal(data.segments[0].byterange, testData.byteRange, 'byteRange incorrect.');
    equal(data.segments[1].byterange, testData.byteRange1, 'byteRange1 incorrect.');
    equal(data.segments[15].byterange, testData.byteRange2, 'byteRange2 incorrect.');
  });

  test('test EXT-X-BYTERANGE used but version is < 4', function() {
    var 
      playlistTemplate = Handlebars.compile(window.playlist_byte_range),
      testData = {version: 3, byteRange: ['522828,0'], byteRange1: ['587500,522828'], byteRange2: ['44556,8353216']},
      playlistData = playlistTemplate(testData),
      data = m3u8parser.parse(playlistData);

    notEqual(data, null, 'data is not NULL');
    equal(data.segments.length, 16, '16 segments should have been parsed.');
    // notEqual(data.invalidReasons, null, 'there should be an error');
    // equal(data.invalidReasons.length, 1, 'there should be 1 error');
    // //TODO: Validate the byteRange info
    // equal(data.invalidReasons[0], 'EXT-X-BYTERANGE used but version is < 4.');x
  });

})(window, window.console);

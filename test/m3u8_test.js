(function(window, undefined) {
  var
    Handlebars = this.Handlebars,
    //manifestController = this.manifestController,
    ParseStream = window.videojs.m3u8.ParseStream,
    parseStream,
    LineStream = window.videojs.m3u8.LineStream,
    lineStream,
    Parser = window.videojs.m3u8.Parser,
    parser;

  module('environment');

  test('is sane', function() {
    expect(1);
    ok(true);
  });

  /*
    Manifest controller
  */

  // module('manifest controller', {
  //   setup: function() {
  //     manifestController = new window.videojs.hls.ManifestController();
  //     this.vjsget = window.videojs.get;
  //     window.videojs.get = function(url, success) {
  //       success(window.brightcove_playlist_data);
  //     };
  //   },
  //   teardown: function() {
  //     window.videojs.get = this.vjsget;
  //   }
  // });

  // test('should create', function() {
  //   ok(manifestController);
  // });

  // test('should return a parsed object', function() {
  //   parser.push(window.brightcove_playlist_data);

  //   strictEqual(parser.manifest.playlists.length, 4, 'Has correct rendition count');
  //   strictEqual(parser.manifest.playlists[0].attributes.BANDWIDTH, 240000, 'First rendition index bandwidth is correct');
  //   strictEqual(parser.manifest.playlists[0].attributes['PROGRAM-ID'], 1, 'First rendition index program-id is correct');
  //   strictEqual(parser.manifest.playlists[0].attributes.RESOLUTION.width, 396, 'First rendition index resolution width is correct');
  //   strictEqual(parser.manifest.playlists[0].attributes.RESOLUTION.height, 224, 'First rendition index resolution height is correct');
  // });

  // test('should get a manifest from an external URL', function() {
  //   manifestController.loadManifest('http://example.com/16x9-master.m3u8',
  //                                   function(responseData) {
  //                                     ok(responseData);
  //                                   },
  //                                   function() {
  //                                     ok(false, 'does not error');
  //                                   },
  //                                   function() {});
  // });

  /*
    M3U8 Test Suite
  */

  module('LineStream', {
    setup: function() {
      lineStream = new LineStream();
    }
  });
  test('empty inputs produce no tokens', function() {
    var data = false;
    lineStream.on('data', function() {
      data = true;
    });
    lineStream.push('');
    ok(!data, 'no tokens were produced');
  });
  test('splits on newlines', function() {
    var lines = [];
    lineStream.on('data', function(line) {
      lines.push(line);
    });
    lineStream.push('#EXTM3U\nmovie.ts\n');

    strictEqual(2, lines.length, 'two lines are ready');
    strictEqual('#EXTM3U', lines.shift(), 'the first line is the first token');
    strictEqual('movie.ts', lines.shift(), 'the second line is the second token');
  });
  test('empty lines become empty strings', function() {
    var lines = [];
    lineStream.on('data', function(line) {
      lines.push(line);
    });
    lineStream.push('\n\n');

    strictEqual(2, lines.length, 'two lines are ready');
    strictEqual('', lines.shift(), 'the first line is empty');
    strictEqual('', lines.shift(), 'the second line is empty');
  });
  test('handles lines broken across appends', function() {
    var lines = [];
    lineStream.on('data', function(line) {
      lines.push(line);
    });
    lineStream.push('#EXTM');
    strictEqual(0, lines.length, 'no lines are ready');

    lineStream.push('3U\nmovie.ts\n');
    strictEqual(2, lines.length, 'two lines are ready');
    strictEqual('#EXTM3U', lines.shift(), 'the first line is the first token');
    strictEqual('movie.ts', lines.shift(), 'the second line is the second token');
  });
  test('stops sending events after deregistering', function() {
    var
      temporaryLines = [],
      temporary = function(line) {
        temporaryLines.push(line);
      },
      permanentLines = [],
      permanent = function(line) {
        permanentLines.push(line);
      };

    lineStream.on('data', temporary);
    lineStream.on('data', permanent);
    lineStream.push('line one\n');
    strictEqual(temporaryLines.length, permanentLines.length, 'both callbacks receive the event');

    ok(lineStream.off('data', temporary), 'a listener was removed');
    lineStream.push('line two\n');
    strictEqual(1, temporaryLines.length, 'no new events are received');
    strictEqual(2, permanentLines.length, 'new events are still received');
  });

  module('ParseStream', {
    setup: function() {
      lineStream = new LineStream();
      parseStream = new ParseStream();
      lineStream.pipe(parseStream);
    }
  });
  test('parses comment lines', function() {
    var
      manifest = '# a line that starts with a hash mark without "EXT" is a comment\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'comment', 'the type is comment');
    strictEqual(element.text,
          manifest.slice(1, manifest.length - 1),
          'the comment text is parsed');
  });
  test('parses uri lines', function() {
    var
      manifest = 'any non-blank line that does not start with a hash-mark is a URI\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'uri', 'the type is uri');
    strictEqual(element.uri,
          manifest.substring(0, manifest.length - 1),
          'the uri text is parsed');
  });
  test('parses unknown tag types', function() {
    var
      manifest = '#EXT-X-EXAMPLE-TAG:some,additional,stuff\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the type is tag');
    strictEqual(element.data,
          manifest.slice(4, manifest.length - 1),
          'unknown tag data is preserved');
  });

  // #EXTM3U
  test('parses #EXTM3U tags', function() {
    var
      manifest = '#EXTM3U\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'm3u', 'the tag type is m3u');
  });

  // #EXTINF
  test('parses minimal #EXTINF tags', function() {
    var
      manifest = '#EXTINF\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'inf', 'the tag type is inf');
  });
  test('parses #EXTINF tags with durations', function() {
    var
      manifest = '#EXTINF:15\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'inf', 'the tag type is inf');
    strictEqual(element.duration, 15, 'the duration is parsed');
    ok(!('title' in element), 'no title is parsed');

    manifest = '#EXTINF:21,\n';
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'inf', 'the tag type is inf');
    strictEqual(element.duration, 21, 'the duration is parsed');
    ok(!('title' in element), 'no title is parsed');
  });
  test('parses #EXTINF tags with a duration and title', function() {
    var
      manifest = '#EXTINF:13,Does anyone really use the title attribute?\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'inf', 'the tag type is inf');
    strictEqual(element.duration, 13, 'the duration is parsed');
    strictEqual(element.title,
          manifest.substring(manifest.indexOf(',') + 1, manifest.length - 1),
          'the title is parsed');
  });

  // #EXT-X-TARGETDURATION
  test('parses minimal #EXT-X-TARGETDURATION tags', function() {
    var
      manifest = '#EXT-X-TARGETDURATION\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'targetduration', 'the tag type is targetduration');
    ok(!('duration' in element), 'no duration is parsed');
  });
  test('parses #EXT-X-TARGETDURATION with duration', function() {
    var
      manifest = '#EXT-X-TARGETDURATION:47\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'targetduration', 'the tag type is targetduration');
    strictEqual(element.duration, 47, 'the duration is parsed');
  });

  // #EXT-X-VERSION
  test('parses minimal #EXT-X-VERSION tags', function() {
    var
      manifest = '#EXT-X-VERSION:\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'version', 'the tag type is version');
    ok(!('version' in element), 'no version is present');
  });
  test('parses #EXT-X-VERSION with a version', function() {
    var
      manifest = '#EXT-X-VERSION:99\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'version', 'the tag type is version');
    strictEqual(element.version, 99, 'the version is parsed');
  });

  // #EXT-X-MEDIA-SEQUENCE
  test('parses minimal #EXT-X-MEDIA-SEQUENCE tags', function() {
    var
      manifest = '#EXT-X-MEDIA-SEQUENCE\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'media-sequence', 'the tag type is media-sequence');
    ok(!('number' in element), 'no number is present');
  });
  test('parses #EXT-X-MEDIA-SEQUENCE with sequence numbers', function() {
    var
      manifest = '#EXT-X-MEDIA-SEQUENCE:109\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'media-sequence', 'the tag type is media-sequence');
    ok(element.number, 109, 'the number is parsed');
  });

  // #EXT-X-PLAYLIST-TYPE
  test('parses minimal #EXT-X-PLAYLIST-TYPE tags', function() {
    var
      manifest = '#EXT-X-PLAYLIST-TYPE:\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'playlist-type', 'the tag type is playlist-type');
    ok(!('playlistType' in element), 'no playlist type is present');
  });
  test('parses #EXT-X-PLAYLIST-TYPE with mutability info', function() {
    var
      manifest = '#EXT-X-PLAYLIST-TYPE:EVENT\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'playlist-type', 'the tag type is playlist-type');
    strictEqual(element.playlistType, 'EVENT', 'the playlist type is EVENT');

    manifest = '#EXT-X-PLAYLIST-TYPE:VOD\n';
    lineStream.push(manifest);
    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'playlist-type', 'the tag type is playlist-type');
    strictEqual(element.playlistType, 'VOD', 'the playlist type is VOD');

    manifest = '#EXT-X-PLAYLIST-TYPE:nonsense\n';
    lineStream.push(manifest);
    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'playlist-type', 'the tag type is playlist-type');
    strictEqual(element.playlistType, 'nonsense', 'the playlist type is parsed');
  });

  // #EXT-X-BYTERANGE
  test('parses minimal #EXT-X-BYTERANGE tags', function() {
    var
      manifest = '#EXT-X-BYTERANGE\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'byterange', 'the tag type is byterange');
    ok(!('length' in element), 'no length is present');
    ok(!('offset' in element), 'no offset is present');
  });
  test('parses #EXT-X-BYTERANGE with length and offset', function() {
    var
      manifest = '#EXT-X-BYTERANGE:45\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'byterange', 'the tag type is byterange');
    strictEqual(element.length, 45, 'length is parsed');
    ok(!('offset' in element), 'no offset is present');

    manifest = '#EXT-X-BYTERANGE:108@16\n';
    lineStream.push(manifest);
    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'byterange', 'the tag type is byterange');
    strictEqual(element.length, 108, 'length is parsed');
    strictEqual(element.offset, 16, 'offset is parsed');
  });

  // #EXT-X-ALLOW-CACHE
  test('parses minimal #EXT-X-ALLOW-CACHE tags', function() {
    var
      manifest = '#EXT-X-ALLOW-CACHE:\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'allow-cache', 'the tag type is allow-cache');
    ok(!('allowed' in element), 'no allowed is present');
  });
  test('parses valid #EXT-X-ALLOW-CACHE tags', function() {
    var
      manifest = '#EXT-X-ALLOW-CACHE:YES\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'allow-cache', 'the tag type is allow-cache');
    ok(element.allowed, 'allowed is parsed');

    manifest = '#EXT-X-ALLOW-CACHE:NO\n';
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'allow-cache', 'the tag type is allow-cache');
    ok(!element.allowed, 'allowed is parsed');
  });
  // #EXT-X-STREAM-INF
  test('parses minimal #EXT-X-STREAM-INF tags', function() {
    var
      manifest = '#EXT-X-STREAM-INF\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'stream-inf', 'the tag type is stream-inf');
    ok(!('attributes' in element), 'no attributes are present');
  });
  test('parses #EXT-X-STREAM-INF with common attributes', function() {
    var
      manifest = '#EXT-X-STREAM-INF:BANDWIDTH=14400\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'stream-inf', 'the tag type is stream-inf');
    strictEqual(element.attributes.BANDWIDTH, 14400, 'bandwidth is parsed');

    manifest = '#EXT-X-STREAM-INF:PROGRAM-ID=7\n';
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'stream-inf', 'the tag type is stream-inf');
    strictEqual(element.attributes['PROGRAM-ID'], 7, 'program-id is parsed');

    manifest = '#EXT-X-STREAM-INF:RESOLUTION=396x224\n';
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'stream-inf', 'the tag type is stream-inf');
    strictEqual(element.attributes.RESOLUTION.width, 396, 'width is parsed');
    strictEqual(element.attributes.RESOLUTION.height, 224, 'heigth is parsed');
  });
  test('parses #EXT-X-STREAM-INF with arbitrary attributes', function() {
    var
      manifest = '#EXT-X-STREAM-INF:NUMERIC=24,ALPHA=Value,MIXED=123abc\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'stream-inf', 'the tag type is stream-inf');
    strictEqual(element.attributes.NUMERIC, '24', 'numeric attributes are parsed');
    strictEqual(element.attributes.ALPHA, 'Value', 'alphabetic attributes are parsed');
    strictEqual(element.attributes.MIXED, '123abc', 'mixed attributes are parsed');
  });
  // #EXT-X-ENDLIST
  test('parses #EXT-X-ENDLIST tags', function() {
    var
      manifest = '#EXT-X-ENDLIST\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'endlist', 'the tag type is stream-inf');
  });

  test('ignores empty lines', function() {
    var
      manifest = '\n',
      event = false;
    parseStream.on('data', function() {
      event = true;
    });
    lineStream.push(manifest);

    ok(!event, 'no event is triggered');
  });

  module('m3u8 parser', {
    setup: function() {
      parser = new Parser();
    }
  });

  test('should create a parser', function() {
    notStrictEqual(parser, undefined, 'parser is defined');
  });

  test('should successfully parse manifest data', function() {
    parser.push(window.playlistM3U8data);
    ok(parser.manifest);
  });

  test('valid manifest should populate the manifest data object', function() {
    parser.push(window.playlistM3U8data);

    ok(parser.manifest, 'the manifest is parsed');
    strictEqual(parser.manifest.targetDuration, 10, 'the manifest has correct TARGET DURATION');
    strictEqual(parser.manifest.allowCache, true, 'allow-cache is defaulted to true');
    strictEqual(parser.manifest.playlistType, 'VOD', 'playlist type is VOD');
    strictEqual(parser.manifest.segments.length, 17, 'there are 17 segments in the manifest');
    strictEqual(parser.manifest.mediaSequence, 0, 'MEDIA SEQUENCE is correct');
    ok(!('duration' in parser.manifest), "no total duration is specified");
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
      testData = { playlistType: 'VOD' };
    parser.push(playlistTemplate(testData));

    notStrictEqual(parser.manifest, null, 'manifest is parsed');
    //strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    strictEqual(parser.manifest.playlistType, 'VOD', 'playlist type is vod');
  });

  test('should have parsed EVENT playlist type', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = { playlistType: 'EVENT' };
    parser.push(playlistTemplate(testData));

    notStrictEqual(parser.manifest, null, 'manifest is parsed');
    //strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    strictEqual(parser.manifest.playlistType, 'EVENT', 'playlist type is event');
  });

  test('handles a missing playlist type', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = {};
    parser.push(playlistTemplate(testData));

    //strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    //strictEqual(data.warnings, 'EXT-X-PLAYLIST-TYPE was empty or missing.  Assuming VOD');
    strictEqual(parser.manifest.playlistType, 'VOD', 'playlist type defaults to vod');
  });

  test('should default invalid playlist types to vod', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = { playlistType: 'baklsdhfajsdf' };
    parser.push(playlistTemplate(testData));

    strictEqual(parser.manifest.playlistType, 'VOD', 'invalid playlist types default to vod');
    //strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    //strictEqual(data.invalidReasons[0], 'Invalid Playlist Type Value: \'baklsdhfajsdf\'');
  });

  test('handles an empty playlist type', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_type_template),
      testData = { playlistType: '' };
    parser.push(playlistTemplate(testData));

    //strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    //strictEqual(data.warnings, 'EXT-X-PLAYLIST-TYPE was empty or missing.  Assuming VOD');
    strictEqual(parser.manifest.playlistType, 'VOD', 'playlist type defaults to vod');
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
      testData = { targetDuration: '10' };
    parser.push(playlistTemplate(testData));

    strictEqual(parser.manifest.targetDuration, 10, 'manifest has correct TARGET DURATION');
    //strictEqual(data.invalidReasons.length, 0, 'data has 1 invalid reasons');
  });

  test('NaN target duration', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template),
      testData = { targetDuration: 'string' };
    parser.push(playlistTemplate(testData));

    ok(!('targetDuration' in parser.manifest), 'target duration is not defined');
    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 0 invalid reasons');
    // strictEqual(data.invalidReasons[0], 'Invalid Target Duration Value: \'NaN\'');
  });

  test('empty target duration', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template),
      testData = { targetDuration: '\'\'' };
    parser.push(playlistTemplate(testData));

    ok(!('targetDuration' in parser.manifest), 'target duration is not defined');
    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // strictEqual(data.invalidReasons[0], 'Invalid Target Duration Value: \'NaN\'');
  });

  test('empty target duration', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_target_duration_template);
    parser.push(playlistTemplate({}));

    ok(!('targetDuration' in parser.manifest), 'target duration is not defined');
    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // strictEqual(data.invalidReasons[0], 'Invalid Target Duration Value: \'what\'');
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
      testData = { mediaSequence: '0' };
    parser.push(playlistTemplate(testData));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    strictEqual(parser.manifest.mediaSequence, 0, 'MEDIA SEQUENCE is zero');
  });

  test('media sequence is encountered twice in the playlist', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {
        mediaSequence: '0',
        mediaSequence1: '1'
      };
    parser.push(playlistTemplate(testData));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    strictEqual(parser.manifest.mediaSequence,
                1,
                'the most recently encountered media sequence is stored');
  });

  test('media sequence is zero if not present in media playlists', function() {
    var playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template);
    parser.push(playlistTemplate({}));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    strictEqual(parser.manifest.mediaSequence, 0, 'mediaSequence is defaulted to zero');
  });

  test('empty media sequence numbers is ignored in media playlists', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = { mediaSequence: '' };
    parser.push(playlistTemplate(testData));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    strictEqual(parser.manifest.mediaSequence,
                0,
                'empty media sequences are defaulted');
  });

  test('handles invalid media sequence numbers in the playlist', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = { mediaSequence: '-1' };
    parser.push(playlistTemplate(testData));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // strictEqual(data.invalidReasons[0], 'Invalid Media Sequence Value: \'-1\'');
    strictEqual(parser.manifest.mediaSequence,
                -1,
                'negative media sequence numbers are parsed');
  });

  test('invalid media sequences are defaulted', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_media_sequence_template),
      testData = {
        mediaSequence: 'asdfkasdkfl'
      };
    parser.push(playlistTemplate(testData));

    strictEqual(parser.manifest.mediaSequence, 0, 'invalid media sequences default to zero');
    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // strictEqual(data.invalidReasons[0], 'Invalid Media Sequence Value: \'asdfkasdkfl\'');
  });

  module('Representative Playlist', {
    setup: function() {
      parser = new Parser();
    },
    teardown: function() {
      parser = null;
    }
  });

  test('should parse real manifest data', function() {
    parser.push(window.brightcove_playlist_data);
    parser.end();

    ok(parser.manifest, 'a manifest is parsed');
    ok(!('segments' in parser.manifest), 'no segments should be parsed');
    strictEqual(parser.manifest.playlists.length, 4, 'has correct playlist count');
    strictEqual(parser.manifest.playlists[0].attributes.BANDWIDTH, 240000, 'first rendition index bandwidth is correct');
    strictEqual(parser.manifest.playlists[0].attributes['PROGRAM-ID'], 1, 'first rendition index program-id is correct');
    strictEqual(parser.manifest.playlists[0].attributes.RESOLUTION.width,
          396,
          'first rendition index resolution width is correct');
    strictEqual(parser.manifest.playlists[0].attributes.RESOLUTION.height,
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
      testData = {
        version: 4,
        extInf: '10',
        extInf1: '10',
        extInf2: '10',
        segment: 'hls_450k_video.ts'
      };
    parser.push(playlistTemplate(testData));

    strictEqual(parser.manifest.segments.length, 17, 'the number of playlists is inferred');
    strictEqual(parser.manifest.segments[0].duration,
                10,
                'the first playlist duration is parsed');
    strictEqual(parser.manifest.segments[1].duration,
                10,
                'the second playlist duration is parsed');
    strictEqual(parser.manifest.segments[2].duration,
                10,
                'the third playlist duration is parsed');
    strictEqual(parser.manifest.segments[3].duration,
                10,
                'the fourth playlist duration is parsed');
    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
  });

  test('the last encountered extinf tag before a segment takes precedance', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {
        version: 4,
        extInf: '1',
        extInf1: '2',
        extInf2: '3'
      };
    parser.push(playlistTemplate(testData));

    strictEqual(parser.manifest.segments[0].duration,
                2,
                'the most recent duration is stored');
  });

  //
  test('ignore invalid extinf values', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {
        version: 4,
        extInf: 'asdf',
        extInf1: '10',
        extInf2: '10',
        segment: 'hls_450k_video.ts'
      };
    parser.push(playlistTemplate(testData));

    ok(!('duration' in parser.manifest.segments[0]), 'invalid durations are ignored');
    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
  });

  //its best practice that every extinf have the same value, but its not required
  test('test inconsistent extinf values in playlist below target duration', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {
        version: 4,
        extInf: '10',
        extInf1: '7',
        extInf2: '10',
        segment: 'hls_450k_video.ts'
      };
    parser.push(playlistTemplate(testData));

    strictEqual(parser.manifest.segments[0].duration,
                10,
                'the first duration is parsed');
    strictEqual(parser.manifest.segments[1].duration,
                7,
                'the second duration is parsed');
    strictEqual(parser.manifest.segments[2].duration,
                10,
                'the third duration is parsed');
    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
  });

  //extinf values must be below the target duration
  test('test floating-point values are accepted with version 3', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {
        version: 3,
        extInf: '10.5',
        extInf1: '10.5',
        extInf2: '10.5',
        segment: 'hls_450k_video.ts'
      };
    parser.push(playlistTemplate(testData));

    strictEqual(parser.manifest.segments[0].duration, 10.5, 'fractional durations are parsed');
    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // strictEqual(data.invalidReasons[0], 'Invalid Segment Data: \'#EXTINF value not an integer\'');
  });

  //extinf values must be below the target duration
  test('test empty EXTINF values', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_extinf_template),
      testData = {
        version: 4,
        extInf: '',
        extInf1: '10.5',
        extInf2: '10.5',
        segment: 'hls_450k_video.ts'
      };
    parser.push(playlistTemplate(testData));

    ok(!('duration' in parser.manifest.segments[0]), 'empty durations are ignored');
    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // strictEqual(data.invalidReasons[0], 'Invalid Segment Data: \'#EXTINF value empty\'');
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
      testData = { version: 4, allowCache: 'YES' };
    parser.push(playlistTemplate(testData));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    strictEqual(parser.manifest.allowCache, true, 'allowCache is true');
  });

  test('test EXT-X-ALLOW-CACHE NO', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_allow_cache),
      testData = {
        version: 4,
        allowCache: 'NO'
      };
    parser.push(playlistTemplate(testData));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 0, 'Errors object should not be empty.');
    strictEqual(parser.manifest.allowCache, false, 'allowCache is false');
  });

  test('test EXT-X-ALLOW-CACHE invalid, default to YES', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_allow_cache),
      testData = {
        version: 4,
        allowCache: 'YESTERDAYNO'
      };
    parser.push(playlistTemplate(testData));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // strictEqual(data.invalidReasons[0], 'Invalid EXT-X-ALLOW-CACHE value: \'YESTERDAYNO\'');
    strictEqual(parser.manifest.allowCache, true, 'allowCache defaults to true');
  });

  test('empty EXT-X-ALLOW-CACHE defaults to YES', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_allow_cache),
      testData = {
        version: 4,
        allowCache: ''
      };
    parser.push(playlistTemplate(testData));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'data has 1 invalid reasons');
    // strictEqual(data.invalidReasons[0], 'Invalid EXT-X-ALLOW-CACHE value: \'\'');
    strictEqual(parser.manifest.allowCache, true, 'allowCache should default to YES.');
  });

  test('missing EXT-X-ALLOW-CACHE  defaults to YES', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_allow_cache),
      testData = {version: 4};
    parser.push(playlistTemplate(testData));

    // notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    // strictEqual(data.invalidReasons.length, 1, 'No EXT-X-ALLOW-CACHE specified.  Default: YES.');
    strictEqual(parser.manifest.allowCache, true, 'allowCache should default to YES');
  });

  test('valid byteranges are parsed', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_byte_range),
      testData = {
        version: 4,
        byteRange: '522828@0',
        byteRange1: '587500@522828',
        byteRange2: '44556@8353216'
      };
    parser.push(playlistTemplate(testData));

    //notStrictEqual(data.invalidReasons, null, 'invalidReasons is not NULL');
    //strictEqual(data.invalidReasons.length, 0, 'Errors object should be empty.');
    //TODO: Validate the byteRange info
    strictEqual(parser.manifest.segments.length,
                17,
                '17 segments should have been parsed.');
    strictEqual(parser.manifest.segments[0].byterange.length,
                522828,
                'byteRange length incorrect');
    strictEqual(parser.manifest.segments[0].byterange.offset,
                0,
                'byteRange offset incorrect');
    strictEqual(parser.manifest.segments[1].byterange.length,
                587500,
                'byteRange length incorrect');
    strictEqual(parser.manifest.segments[1].byterange.offset,
                522828,
                'byteRange offset incorrect');
  });

  test('EXT-X-BYTERANGE used but version is < 4', function() {
    var
      playlistTemplate = Handlebars.compile(window.playlist_byte_range),
      testData = {
        version: 3,
        // incorrect syntax, '@' is the offset separator
        byteRange: '522828,0',
        byteRange1: '587500,522828',
        byteRange2: '44556,8353216'
      };
    parser.push(playlistTemplate(testData));

    strictEqual(parser.manifest.segments.length,
                17,
                '17 segments should have been parsed.');
    strictEqual(parser.manifest.segments[0].byterange.length,
                522828,
                'the byterange length was parsed');
    strictEqual(parser.manifest.segments[0].byterange.offset,
                0,
                'the byterange offset was parsed');
    strictEqual(parser.manifest.segments[1].byterange.offset,
                0,
                'the byterange offset was defaulted');
  });

  module('m3u8s');

  test('parses the example manifests as expected', function() {
    var key;
    for (key in window.manifests) {
      if (window.expected[key]) {
        parser = new Parser();
        parser.push(window.manifests[key]);
        deepEqual(parser.manifest,
                  window.expected[key],
                  key + '.m3u8 was parsed correctly');
      }
    }
  });

})(window, window.console);

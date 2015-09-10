(function(window, undefined) {
  var
    //manifestController = this.manifestController,
    m3u8 = window.videojs.m3u8,
    ParseStream = m3u8.ParseStream,
    parseStream,
    LineStream = m3u8.LineStream,
    lineStream,
    Parser = m3u8.Parser,
    parser;

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
  test('parses #EXTINF tags with carriage returns', function() {
    var
      manifest = '#EXTINF:13,Does anyone really use the title attribute?\r\n',
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
          manifest.substring(manifest.indexOf(',') + 1, manifest.length - 2),
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

    manifest = '#EXT-X-STREAM-INF:CODECS="avc1.4d400d, mp4a.40.2"\n';
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    strictEqual(element.type, 'tag', 'the line type is tag');
    strictEqual(element.tagType, 'stream-inf', 'the tag type is stream-inf');
    strictEqual(element.attributes.CODECS,
                'avc1.4d400d, mp4a.40.2',
                'codecs are parsed');
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

  // #EXT-X-KEY
  test('parses valid #EXT-X-KEY tags', function() {
    var
      manifest = '#EXT-X-KEY:METHOD=AES-128,URI="https://priv.example.com/key.php?r=52"\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    deepEqual(element, {
      type: 'tag',
      tagType: 'key',
      attributes: {
        METHOD: 'AES-128',
        URI: 'https://priv.example.com/key.php?r=52'
      }
    }, 'parsed a valid key');

    manifest = '#EXT-X-KEY:URI="https://example.com/key#1",METHOD=FutureType-1024\n';
    lineStream.push(manifest);
    ok(element, 'an event was triggered');
    deepEqual(element, {
      type: 'tag',
      tagType: 'key',
      attributes: {
        METHOD: 'FutureType-1024',
        URI: 'https://example.com/key#1'
      }
    }, 'parsed the attribute list independent of order');

    manifest = '#EXT-X-KEY:IV=1234567890abcdef1234567890abcdef\n';
    lineStream.push(manifest);
    ok(element.attributes.IV, 'detected an IV attribute');
    deepEqual(element.attributes.IV, new Uint32Array([
      0x12345678,
      0x90abcdef,
      0x12345678,
      0x90abcdef
    ]), 'parsed an IV value');
  });

  test('parses minimal #EXT-X-KEY tags', function() {
    var
      manifest = '#EXT-X-KEY:\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    ok(element, 'an event was triggered');
    deepEqual(element, {
      type: 'tag',
      tagType: 'key'
    }, 'parsed a minimal key tag');
  });

  test('parses lightly-broken #EXT-X-KEY tags', function() {
    var
      manifest = '#EXT-X-KEY:URI=\'https://example.com/single-quote\',METHOD=AES-128\n',
      element;
    parseStream.on('data', function(elem) {
      element = elem;
    });
    lineStream.push(manifest);

    strictEqual(element.attributes.URI,
                'https://example.com/single-quote',
                'parsed a single-quoted uri');

    element = null;
    manifest = '#EXT-X-KEYURI="https://example.com/key",METHOD=AES-128\n';
    lineStream.push(manifest);
    strictEqual(element.tagType, 'key', 'parsed the tag type');
    strictEqual(element.attributes.URI,
                'https://example.com/key',
                'inferred a colon after the tag type');

    element = null;
    manifest = '#EXT-X-KEY:  URI =  "https://example.com/key",METHOD=AES-128\n';
    lineStream.push(manifest);
    strictEqual(element.attributes.URI,
                'https://example.com/key',
                'trims and removes quotes around the URI');
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

  module('m3u8 parser');

  test('can be constructed', function() {
    notStrictEqual(new Parser(), undefined, 'parser is defined');
  });

  module('m3u8s');

  test('parses static manifests as expected', function() {
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

(function(window, videojs, undefined) {
var player, oldXhr, oldSourceBuffer;

module('HLS', {
  setup: function() {
    var video  = document.createElement('video');
    document.querySelector('#qunit-fixture').appendChild(video);
    player = videojs(video);

    oldXhr = window.XMLHttpRequest;
    oldSourceBuffer = window.videojs.SourceBuffer;

    // mock out SourceBuffer since it won't be available in phantomjs
    window.videojs.SourceBuffer = function() {
      this.appendBuffer = function() {};
    };
  },
  teardown: function() {
    window.XMLHttpRequest = oldXhr;
    window.videojs.SourceBuffer = oldSourceBuffer;
  }
});

asyncTest('loads the specified manifest URL on init', function() {
  var loadedmanifest = false;
  player.on('loadedmanifest', function() {
    loadedmanifest = true;
  });
  player.on('loadedmetadata', function() {
    ok(loadedmanifest, 'loadedmanifest fires');
    ok(player.hls.manifest, 'the manifest is available');
    ok(player.hls.manifest.segments, 'the segments are parsed');
    strictEqual(player.hls.manifest,
                player.hls.currentPlaylist,
                'a playlist is selected');
    strictEqual(player.hls.readyState(), 1, 'the readyState is HAVE_METADATA');
    start();
  });

  player.hls('manifest/playlist.m3u8');
  strictEqual(player.hls.readyState(), 0, 'the readyState is HAVE_NOTHING');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });
});

test('starts downloading a segment on loadedmetadata', function() {
  var url;
  window.XMLHttpRequest = function() {
    this.open = function() {
      url = arguments[1];
    };
    this.send = function() {
      this.readyState = 4;
      this.responseText = window.manifests['media'];
      this.onreadystatechange();
    };
  };
  player.hls('manifest/media.m3u8');
  videojs.mediaSources[player.currentSrc()].trigger({
    type: 'sourceopen'
  });

  strictEqual(url, '00001.ts', 'the first segment is requested');
});

})(window, window.videojs);

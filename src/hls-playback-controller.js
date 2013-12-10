(function(window) {
  var
    ManifestController = window.videojs.hls.ManifestController,
    SegmentController = window.videojs.hls.SegmentController,
    MediaSource = window.videojs.MediaSource,
    SegmentParser = window.videojs.hls.SegmentParser;


  window.videojs.hls.HLSPlaybackController = function(player) {

    var self = this;

    self.player = player;
    self.mediaSource = new MediaSource();
    self.parser = new SegmentParser();

    self.manifestLoaded = false;
    self.currentSegment = 0;

    // register external callbacks
    self.rendition = function(rendition) {
      self.currentRendition = rendition;
      self.loadManifestWithMediaSources(self.currentRendition.url, self.onM3U8LoadComplete, self.onM3U8LoadError, self.onM3U8Update);
    };

    self.loadManifestWithMediaSources = function(manifestUrl,onDataCallback) {
      self.manifestController = new ManifestController();
      self.manifestController.loadManifest(manifestUrl, self.onM3U8LoadComplete, self.onM3U8LoadError, self.onM3U8Update);
      if (onDataCallback) {
        self.manifestLoadCompleteCallback = onDataCallback;
      }
    };

    self.loadManifest = function(manifestUrl, onDataCallback) {
      self.mediaSource.addEventListener('sourceopen', function() {
        // feed parsed bytes into the player
        self.sourceBuffer = self.mediaSource.addSourceBuffer('video/flv; codecs="vp6,aac"');

        self.parser = new SegmentParser();

        self.sourceBuffer.appendBuffer(self.parser.getFlvHeader(), self.player);

        if (onDataCallback) {
          self.manifestLoadCompleteCallback = onDataCallback;
        }

        self.manifestController = new ManifestController();
        self.manifestController.loadManifest(manifestUrl, self.onM3U8LoadComplete, self.onM3U8LoadError, self.onM3U8Update);

      }, false);

      self.player.src({
        src: window.videojs.URL.createObjectURL(self.mediaSource),
        type: "video/flv"
      });
    };

    self.onM3U8LoadComplete = function(m3u8) {
      if (m3u8.invalidReasons.length === 0) {
        if (m3u8.isPlaylist) {
          self.currentPlaylist = m3u8;
          self.rendition(self.currentPlaylist.playlistItems[0]);
        } else {
          self.currentManifest = m3u8;
          self.manifestLoaded = true; // Is this actually used anywhere?

          self.loadSegment(self.currentManifest.mediaItems[0]);

          if (!m3u8.hasEndTag) {
            self.manifestReloadInterval = setInterval(self.reloadManifest, m3u8.targetDuration / 2 * 1000); 
          }

          if (self.manifestLoadCompleteCallback) {
            self.manifestLoadCompleteCallback(m3u8);
          }
        }
      }
    };

    self.reloadManifest = function() {
      console.log('reloading manifest');
      self.manifestController.reload();
      if (self.currentSegment < self.currentManifest.mediaItems.length -1) {
        self.loadNextSegment();
      }
    };

    self.onM3U8LoadError = function() {};
    self.onM3U8Update = function() {};

    self.loadSegment = function(segment) {
      self.segmentController = new SegmentController();
      self.segmentController.loadSegment(segment.url, self.onSegmentLoadComplete, self.onSegmentLoadError);
    };

    self.onSegmentLoadComplete = function(segment) {
      self.parser.parseSegmentBinaryData(segment.binaryData);

      while (self.parser.tagsAvailable()) {
        self.sourceBuffer.appendBuffer(self.parser.getNextTag().bytes, self.player);
      }

      if (self.currentSegment < self.currentManifest.mediaItems.length - 1) {
        self.loadNextSegment();
      }
    };
    
    self.loadNextSegment = function() {
      self.currentSegment++;
      self.loadSegment(self.currentManifest.mediaItems[self.currentSegment]);
    };

    self.onSegmentLoadError = function() {};

  };
})(this);

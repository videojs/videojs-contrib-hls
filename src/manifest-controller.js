(function (window) {

  var parser = window.videojs.hls.M3U8Parser;

  window.videojs.hls.ManifestController = function() {
    var self = this;

    self.loadManifest = function(manifestUrl, onDataCallback, onErrorCallback, onUpdateCallback) {
      self.url = manifestUrl;

      if (onDataCallback) {
        self.onDataCallback = onDataCallback;
      }
      if (onErrorCallback) {
        self.onErrorCallback = onErrorCallback;
      }

      if (onUpdateCallback) {
        self.onUpdateCallback = onUpdateCallback;
      }

      window.vjs.get(manifestUrl, self.onManifestLoadComplete, self.onManifestLoadError);
    };

    self.parseManifest = function(manifest) {
      return parser.parse(manifest);
    };

    self.onManifestLoadComplete = function(response) {
      var output = self.parseManifest(response);

      if (self.onDataCallback !== undefined) {
        self.onDataCallback(output);
      }
    };

    self.onManifestLoadError = function(err) {
      if (self.onErrorCallback !== undefined) {
        self.onErrorCallback((err !== undefined) ? err : null);
      }
    };
  };
})(this);

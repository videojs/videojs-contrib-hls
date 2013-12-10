(function (window) {
  var
    M3U8Parser = window.videojs.hls.M3U8Parser;

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

    self.reload = function() {
      window.vjs.get(self.url, self.reloadManifest, self.onManifestLoadError);
    };

    self.reloadManifest = function(dataAsString) {
      self.parser.parse(dataAsString);
    };

    self.parseManifest = function(dataAsString) {
      self.parser = new M3U8Parser();
      self.parser.directory = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(self.url).slice(1)[1];
      self.data = self.parser.parse(dataAsString);

      return self.data;
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

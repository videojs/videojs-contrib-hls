(function(window) {

  window.videojs.hls.SegmentController = function() {
    var self = this;

    self.loadSegment = function(segmentUrl, onDataCallback, onErrorCallback, onUpdateCallback) {
      var request = new XMLHttpRequest();

      self.url = segmentUrl;
      self.onDataCallback = onDataCallback;
      self.onErrorCallback = onErrorCallback;
      self.onUpdateCallback = onUpdateCallback;
      self.requestTimestamp = +new Date();

      request.open('GET', segmentUrl, true);
      request.responseType = 'arraybuffer';
      request.onload = function() {
        self.onSegmentLoadComplete(new Uint8Array(request.response));
      };

      request.send(null);
    };

    self.parseSegment = function(incomingData) {
      self.data = {};
      self.data.binaryData = incomingData;
      self.data.url = self.url;
      self.data.isCached = false;
      self.data.requestTimestamp = self.requestTimestamp;
      self.data.responseTimestamp = self.responseTimestamp;
      self.data.byteLength = incomingData.byteLength;
      self.data.isCached = parseInt(self.responseTimestamp - self.requestTimestamp,10) < 75;
      self.data.throughput = self.calculateThroughput(self.data.byteLength, self.requestTimestamp ,self.responseTimestamp);

      return self.data;
    };

    self.calculateThroughput = function(dataAmount, startTime, endTime) {
      return Math.round(dataAmount / (endTime - startTime) * 1000) * 8;
    };

    self.onSegmentLoadComplete = function(response) {
      var output;

      self.responseTimestamp = +new Date();

      output = self.parseSegment(response);

      if (self.onDataCallback !== undefined) {
        self.onDataCallback(output);
      }
    };

    self.onSegmentLoadError = function(error) {
      if (error) {
        throw error;
      }

      if (self.onErrorCallback !== undefined) {
        self.onErrorCallback(error);
      }
    };
  };
})(this);

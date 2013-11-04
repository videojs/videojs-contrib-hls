(function(window) {

  var xhrGet = window.videojs.hls.xhrGet;

  window.videojs.hls.SegmentController = function() {
    var self = this;

    self.loadSegment = function(segmentUrl, onDataCallback, onErrorCallback, onUpdateCallback) {
      self.onDataCallback = onDataCallback;

      xhrGet(segmentUrl, function(error, data, request) {
        if (error) {
          return onErrorCallback(error);
        }
        return self.onSegmentLoadComplete(data);
      });
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
  };
})(this);

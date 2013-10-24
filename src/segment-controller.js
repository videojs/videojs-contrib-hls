(function(window) {

	window.videojs.hls.SegmentController = function(){

		var self = this;

		self.url;

		self.requestTimestamp;
		self.responseTimestamp;
		self.data;

		self.onDataCallback;
		self.onErrorCallback;
		self.onUpdateCallback;

		self.loadSegment = function ( segmentUrl, onDataCallback, onErrorCallback, onUpdateCallback ) {
			self.url = segmentUrl;
			self.onDataCallback = onDataCallback;
			self.onErrorCallback = onErrorCallback;
			self.onUpdateCallback = onUpdateCallback;
			self.requestTimestamp = new Date().getTime();

			var req = new XMLHttpRequest();
				req.open('GET', segmentUrl, true);
				req.responseType = 'arraybuffer';
				req.onload = function(response) {
					self.onSegmentLoadComplete(new Uint8Array(req.response));
				};

			req.send(null);

			//vjs.get(segmentUrl, self.onSegmentLoadComplete, self.onSegmentLoadError);
		};

		self.parseSegment = function ( incomingData ) {
			// Add David's code later //
			console.log('got segment data', incomingData.byteLength);

			self.data = {};
			self.data.binaryData = incomingData;
			self.data.url = self.url;
			self.data.isCached = false;
			self.data.requestTimestamp = self.requestTimestamp;
			self.data.responseTimestamp = self.responseTimestamp;
			self.data.byteLength = incomingData.byteLength;
			self.data.isCached = ( parseInt(self.responseTimestamp - self.requestTimestamp) < 75 );
			self.data.throughput = self.calculateThroughput(self.data.byteLength, self.requestTimestamp ,self.responseTimestamp);

			return self.data;
		};

		self.calculateThroughput = function(dataAmount, startTime, endTime) {
			return Math.round(dataAmount/(endTime-startTime)*1000)*8;
		}

		self.onSegmentLoadComplete = function(response) {
			self.responseTimestamp = new Date().getTime();

			var output = self.parseSegment(response);

			if(self.onDataCallback != undefined)
			{
				self.onDataCallback(output);
			}
		};

		self.onSegmentLoadError = function(err) {
			if(err)
			{
				console.log(err.message);
			}

			if(self.onErrorCallback != undefined)
			{
				onErrorCallback((err != undefined) ? err : null);
			}
		};
	}
})(this);

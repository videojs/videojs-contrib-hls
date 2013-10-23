(function(window) {
	var M3U8 = window.videojs.hls.M3U8;
	var M3U8Parser = window.videojs.hls.M3U8Parser;
	var M3U8TagTypes = window.videojs.hls.m3u8TagType;

	window.videojs.hls.ManifestController = function(){

		var self = this;
		var parser;
		var data;

		var onDataCallback;
		var onErrorCallback;
		var onUpdateCallback;

		self.loadManifest = function ( manifestUrl, onDataCallback, onErrorCallback, onUpdateCallback ) {
			self.onDataCallback = onDataCallback;
			self.onErrorCallback = onErrorCallback;
			self.onUpdateCallback = onUpdateCallback;

			vjs.get(manifestUrl, self.onManifestLoadComplete, self.onManifestLoadError);
		};

		self.parseManifest = function ( dataAsString ) {
			self.parser = new M3U8Parser();
			self.data = self.parser.parse( dataAsString );

			return self.data;
		};

		self.onManifestLoadComplete = function(response) {
			var output = self.parseManifest(response);

			if(self.onDataCallback != undefined)
			{
				self.onDataCallback(output);
			}
		};

		self.onManifestLoadError = function(err) {
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

/*
mc = new window.videojs.hls.ManifestController('myM3u8.m3u8', {
	onData: function(){},
	onError: function(){},
	onUpdate: function(){}
});
*/
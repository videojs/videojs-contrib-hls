(function(window) {
	window.videojs.hls.M3U8 = function() {
		this.allowCache = "NO";
		this.playlistItems = [];
		this.mediaItems = [];
		this.iFrameItems = [];
		this.invalidReasons = [];
		this.hasValidM3UTag = false;
		this.hasEndTag = false;
		this.targetDuration = -1;
		this.totalDuration = -1;
		this.isPlaylist = false;
		this.playlistType = "";
		this.mediaSequence = -1;
		this.version = -1;
	}
})(this);
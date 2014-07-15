/**
 * A stream-based mp2t to mp4 converter. This utility is used to
 * deliver mp4s to a SourceBuffer on platforms that support native
 * Media Source Extensions. The equivalent process for Flash-based
 * platforms can be found in segment-parser.js
 */
(function(window, videojs, undefined) {
'use strict';

var Transmuxer = function() {
  Transmuxer.prototype.init.call(this);
  this.push = function() {
    this.mp4 = new Uint8Array();
  };
};
Transmuxer.prototype = new videojs.Hls.Stream();

window.videojs.Hls.Transmuxer = Transmuxer;
})(window, window.videojs);

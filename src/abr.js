// import BandwidthTracker from './bandwidth-tracker';

// class AdaptiveBitrate {
//     constructor(options) {
//     super();

//     this.bandwidthTracker = new BandwidthTracker();
//     this.segmentLoaders = [];
//     this.selectPlaylist = options.selectPlaylist;
//   }

//   addSegmentLoader(segmentLoader) {
//     this.segmentLoaders.push(segmentLoader);
//     segmentLoader.on('bandwidth', ()=>this.bandwidth(segmentLoader.bandwidth));
//   }

//   bandwidth(bandwidth) {
//     this.bandwidthTracker.push(bandwidth);
//   }

//   playlistStateChanged() {

//   }

//   dispose() {
// //    segmentLoader.off('bandwidth', ()=>this.bandwidthTracker.push(segmentLoader.bandwidth));
//   }
// }

CHANGELOG
=========

--------------------
## 4.0.3 (2016-12-23)
* Fix a segment hop in live [#928](https://github.com/videojs/videojs-contrib-hls/pull/928)
* Map legacy AVC codecs to their modern equivalents when excluding incompatible playlists [#940](https://github.com/videojs/videojs-contrib-hls/pull/940)
* Update video.js to 5.15.1 [#941](https://github.com/videojs/videojs-contrib-hls/pull/941)

--------------------
## 4.0.2 (2016-11-29)
* Fix excessive segment loads on seeks [#925](https://github.com/videojs/videojs-contrib-hls/pull/925)
  * Fixed a few cases where seeking caused the player to load too many segments

--------------------
## 4.0.1 (2016-11-23)
* Revert "Upgrade aes-decrypter to use webcrypto for HLSe decryption where available. (#777)" [#922](https://github.com/videojs/videojs-contrib-hls/pull/922)
  * WebCrypto's subtle-crypto was failing to decrypt segments that worked previously with the JavaScript-only implementation

--------------------
## 4.0.0 (2016-11-21)
* Simplified the algorithm at the heart of SegmentLoader as much as possible [#875](https://github.com/videojs/videojs-contrib-hls/pull/875)
  * Introduced the concept of sync-points to help associate currentTime with segments across variants
  * More information available at: https://www.brightcove.com/en/blog/2016/10/improving-hls-playback
* Updated videojs-contrib-media-sources to 4.1.2
  * Start using remote TextTracks because they can be properly removed [#118](https://github.com/videojs/videojs-contrib-media-sources/pull/118)
  * Handle remove cues from track properly if cues is null [#112](https://github.com/videojs/videojs-contrib-media-sources/pull/112)
* Updated mux.js to 3.0.3
  * Stop applying the compositionTimestamp of the first frame to the baseMediaDecodeTime for the fragment [#108](https://github.com/videojs/mux.js/pull/108)
  * Fix coalesce stream to account for missing audio data in pending tracks [#125](https://github.com/videojs/mux.js/pull/125)
* Updated aes-decrypter to [2.0.0](https://github.com/videojs/aes-decrypter/blob/master/CHANGELOG.md#200-2016-11-15)
  * Use webcrypto for aes-cbc segment decryption when supported [#4](https://github.com/videojs/aes-decrypter/pull/4)

--------------------
## 3.6.13 (2016-11-17)
* Added the concept of systemBandwidth - a measure of the bandwidth (in mb/s) of the entire system from download through transmuxing and appending data to a flash or native media source
  * Adaptive bitrate selection is now based on the performance of the entire system

--------------------
## 3.6.12 (2016-11-14)
* Changed resolveUrl to use javascript only

--------------------
## 3.6.11 (2016-11-11)
* Updated the reloadSourceOnErrors plugin:
  * Don't try to set the source if getSource returns undefined or null
* resolve-url.js now uses an iframe to contain the base and anchor elements used to resolve relateive urls

--------------------
## 3.6.10 (2016-11-10)
* Updated the reloadSourceOnErrors plugin:
  * Option to pass a `getSource` function that can be used to provide a new source to load on error
  * Added the ability to override the default minimum time between errors in seconds
  * Plugin now cleans up event bindings when initialized multiple times
* Fix trimBuffer to compare correct segments and correctly trim in the live case

--------------------
## 3.6.9 (2016-11-09)
* Add a plugin that can be used to automatically reload a source if an
  error occurs
* Fix an error when checking if the lowest quality level is currently
  in use

--------------------
## 3.6.8 (2016-11-09)
* Enhance gap skipper to seek back into the live window if playback
  slips out of it. Renamed GapSkipper to PlaybackWatcher.

--------------------
## 3.6.7 (2016-11-03)
* Update videojs-contrib-media-sources to 4.0.5
  * Fix an issue with ID3 and 608 cue translation

--------------------
## 3.6.6 (2016-10-21)
* Use setTimeout in gap skipper instead of relying on timeupdate events
* Updated videojs-contrib-media-sources to 4.0.4
  * Append init segment to video buffer for every segmentw

--------------------
## 3.6.4 (2016-10-18)
* Fix 'ended' event not firing after replay
* Updated videojs-contrib-media-sources to 4.0.2
  * Only trim FLV tags when seeking to prevent triming I frames
  * Updated Mux.js to 3.0.2
    * Set h264Frame to null after we finish the frame

--------------------
## 3.6.3 (2016-10-18)
* Update videojs-contrib-media-sources to 4.0.1
  * Fix flash fallback

--------------------
## 3.6.2 (2016-10-17)
* Update videojs-contrib-media-sources to 4.0.0
  * Append init segment data on audio track changes
  * Normalize ID3 behavior to follow Safari's implementation

--------------------
## 3.6.1 (2016-10-13)
* Allow for initial bandwidth option of 0
* Added support for MAAT in Firefox 49
* Corrected deprecation warning for `player.hls`

--------------------
## 3.6.0 (2016-09-27)
* Updated Mux.js to 2.5.0
    * Added support for generating version 1 TFDT boxes
    * Added TS inspector
* Added bundle-collapser to create smaller dist files
* Added fMP4 support
* Fixed a bug that resulted in us loading the first segment on a live stream

--------------------
## 3.5.3 (2016-08-24)
* Updated videojs-contrib-mediasources to 3.1.5
  * Updated Mux.js to 2.4.2
    * Fixed caption-packet sorting to be stable on Chromium

--------------------
## 3.5.2 (2016-08-17)
* Changes to the underflow-detection in the gap-skipper to remove restrictions on the size of the gaps it is able to skip

--------------------
## 3.5.1 (2016-08-16)
* Fixes an issue where playback can stall when going in/out of fullscreen

--------------------
## 3.5.0 (2016-08-15)
* Updated support for #ext-x-cue-out, #ext-x-cue-in, and #ext-x-cue-out-cont to create a single cue spanning the range of time covered by the ad break
* Updated to videojs-media-sources 3.1.4
  * Increased the values of the FlashConstants to push more data into flash per chunk-interval

--------------------
## 3.4.0 (2016-07-29)
* Added support for #ext-x-cue-out, #ext-x-cue-in, and #ext-x-cue-out-cont via a special TextTrack
* Added the ability to skip gaps caused by video underflow behavior in Chrome

--------------------
## 3.3.0 (2016-07-25)
* No longer timeout segment requests if there is only one playlist left or if we are on the lowest rendition available
* Fixed a bug where sometimes the first segment was not fetched when it should have been

--------------------
## 3.2.0 (2016-07-15)
* Added an algorithm to seek over gaps in the video element's buffer when they are created because of missing video or audio frames
* Moved the AES decryption logic to it's [own project](https://github.com/videojs/aes-decrypter)

--------------------
## 3.1.0 (2016-06-09)
* Added manual rendition selection API via the `representations()` function on each instance of the HlsHandler class
* Pulled out and moved m3u8 parsing functionality into it's own project at https://github.com/videojs/m3u8-parser

--------------------
## 3.0.5 (2016-06-02)
* Fixed a bug where the adaptive bitrate selection algorithm would not switch to media playlists that had already been fetched from the server previously

--------------------
## 3.0.4 (2016-05-31)
* Added support for multiple alternate audio tracks
* New class SegmentLoader contains all buffer maintenence and segment fetching logic
* New class SourceUpdater tracks the state of asynchronous operations on a SourceBuffer and queues operations for future execution if the SoureBuffer is busy
* New class MasterPlaylistController now encapsulates operations on the master playlist and coordinates media playlists and segment loaders
* Bug fixes related to fetching and buffer maintenance

--------------------

## 2.0.1 (2016-03-11)
* First release of the ES6 version of the SourceHandler
* All new lint/build/test setup via the [generator-videojs-plugin](https://github.com/videojs/generator-videojs-plugin) project

--------------------

## 1.13.1 (2016-03-04)
* Converted from a Tech to a SourceHandler for Video.js 5.x compatibility
* Implemented a Media Source Extensions-based playback engine with a Flash-based fallback
* Rewrote the Transmuxer and moved it into it's own project [mux.js](https://github.com/videojs/mux.js)
* Added support for 608/708 captions

--------------------

## 0.17.6 (2015-07-29)
* autoplay at the live point. fix live id3 cue insertion. ([view](https://github.com/videojs/videojs-contrib-hls/pull/353))

## 0.17.5 (2015-07-14)
* do not assume media sequence starts at zero ([view](https://github.com/videojs/videojs-contrib-hls/pull/346))
* fix error with audio- or video-only streams ([view](https://github.com/videojs/videojs-contrib-hls/pull/348))

## 0.17.4 (2015-07-12)
* Fix seeks between segments. Improve duration calculation. ([view](https://github.com/videojs/videojs-contrib-hls/pull/339))

## 0.17.3 (2015-06-29)
* @dmlap improved video duration calculation. ([view](https://github.com/videojs/videojs-contrib-hls/pull/321))
* Clamp seeks to the seekable range ([view](https://github.com/videojs/videojs-contrib-hls/pull/327))
* Use getComputedStyle for player dimensions when filtering variants ([view](https://github.com/videojs/videojs-contrib-hls/pull/326))
* Add a functional test that runs in SauceLabs ([view](https://github.com/videojs/videojs-contrib-hls/pull/323))

## 0.17.2 (2015-06-15)
* @dmlap fix seeking in live streams ([view](https://github.com/videojs/videojs-contrib-hls/pull/308))

## 0.17.1 (2015-06-08)
* @dmlap do not preload live videos ([view](https://github.com/videojs/videojs-contrib-hls/pull/299))

## 0.17.0 (2015-06-05)
* @dmlap implement seekable for live streams. Fix in-band metadata timing for live streams. ([view](https://github.com/videojs/videojs-contrib-hls/pull/295))

## 0.16.1 (2015-05-29)
* @ntadej Do not unnecessarily reset to the live point when refreshing playlists. Clean up playlist loader timeouts. ([view](https://github.com/videojs/videojs-contrib-hls/pull/274))
* @gkatsev ensure segments without an initial IDR are not displayed in 4:3 initially ([view](https://github.com/videojs/videojs-contrib-hls/pull/272))
* @mikrohard: wait for an SPS to inject metadata tags. ([view](https://github.com/videojs/videojs-contrib-hls/pull/280))
* @mikrohard: Trim whitespace in playlist. ([view](https://github.com/videojs/videojs-contrib-hls/pull/282))
* @mikrohard allow playback of TS files with NITs. Don&#x27;t warn about PCR PIDs. ([view](https://github.com/videojs/videojs-contrib-hls/pull/284))
* @dmlap quicker quality switches when bandwidth changes. ([view](https://github.com/videojs/videojs-contrib-hls/pull/285))
* @dmlap fix temporary warped display after seeking. ([view](https://github.com/videojs/videojs-contrib-hls/pull/290))

## 0.16.0
* support preload=none

## 0.15.0
* expose all ID3 frames and handle tags larger than 188 bytes

## 0.14.0
* performance improvements for HLSe

## 0.13.0
* Improved audio/video synchronization
* Fixes for live, HLSe, and discontinuities
* Rename internal methods to clarify their intended visibility

## 0.12.0
* support for custom IVs with AES-128 encryption

## 0.11.0
* embedded ID3 tags are exposed as an in-band metadata track

## 0.10.0
* optimistic initial bitrate selection

## 0.9.0
* support segment level AES-128 encryption

## 0.8.0
* support for EXT-X-DISCONTINUITY

## 0.7.0
* convert the HLS plugin to a tech

## 0.6.0
* Refactor playlist loading
* Add testing via karma

## 0.5.0
* cookie-based content protection support (see `withCredentials`)

## 0.4.0
* Live stream support

## 0.3.0
* Performance fixes for high-bitrate streams

## 0.2.0
* Basic playback and adaptive bitrate selection

## 0.1.0
* Initial release

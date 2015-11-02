CHANGELOG
=========

## HEAD (Unreleased)
* buffer at the current time range end instead of incrementing a variable. ([view](https://github.com/videojs/videojs-contrib-hls/pull/423))

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

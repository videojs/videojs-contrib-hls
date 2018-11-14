CHANGELOG
=========

--------------------
## HEAD (Unreleased)
_(none)_
--------------------
## 5.15.0 (2018-11-14)
* Add redirect support for manifest and media requests ([#1213](https://github.com/videojs/videojs-contrib-hls/pull/1213))

--------------------
## 5.14.1 (2018-03-21)
* Fixed the minified dist file
  * update webwackify to 0.1.6 ([#1380](https://github.com/videojs/videojs-contrib-hls/pull/1380))
  * update videojs-contrib-media-sources to 4.7.2 ([#1382](https://github.com/videojs/videojs-contrib-hls/pull/1382))

--------------------
## 5.14.0 (2018-03-15)
* update videojs-contrib-media-sources to 4.7.1 and webwackify to 0.1.5 ([#1376](https://github.com/videojs/videojs-contrib-hls/pull/1376))
* More useful info in segment-metadata cue (bandwidth/resolution/codecs/byte-length) ([#1210](https://github.com/videojs/videojs-contrib-hls/pull/1210))

--------------------
## 5.13.0 (2018-03-07)
* use webwackify for webworkers to support webpack bundle ([#1363](https://github.com/videojs/videojs-contrib-hls/pull/1363))
* Fix tech.play() throwing unresolved promise errors on Chrome ([#1338](https://github.com/videojs/videojs-contrib-hls/pull/1338))
* update url-toolkit to ^2.1.3 ([#1327](https://github.com/videojs/videojs-contrib-hls/pull/1327))
* Add jsDelivr link ([#1274](https://github.com/videojs/videojs-contrib-hls/pull/1274))
* Update karma reconnect configuration to match video.js' ([#1323](https://github.com/videojs/videojs-contrib-hls/pull/1323))
  * Increase karma's browserDisconnectTolerance to 3
* Add nvmrc and update travis' chrome reference ([#1322](https://github.com/videojs/videojs-contrib-hls/pull/1322))
  * Update karma-chrome-launcher to ^2.2.0
  * Update karma to ^1.7.1 and remove firefox from travis configuration
  * enable node_modules caching on travis
  * Update videojs-contrib-quality-levels to ^2.0.4
  * Fix test for event handler cleanup on dispose by calling event handling methods

--------------------
## 5.12.2 (2017-11-06)
* Remove unused expected manifest js files [#1289](https://github.com/videojs/videojs-contrib-hls/pull/1289)
* Remove extraneous methods from PlaylistLoader [#1286](https://github.com/videojs/videojs-contrib-hls/pull/1286)
  * Move isLowestEnabledRendition to playlist module
* update contrib-media-sources to 4.6.2 [#1291](https://github.com/videojs/videojs-contrib-hls/pull/1291)
  * update mux.js to 4.3.2
    * flush pes packets when there is enough data

--------------------
## 5.12.1 (2017-10-24)
* update contrib-media-sources to 4.6.1 [#1284](https://github.com/videojs/videojs-contrib-hls/pull/1284)
  * update mux.js to 4.3.1
    * Set active data channel per-field instead of globally for CEA-608
    * Fixed an issue with captions being placed in the wrong CC

--------------------
## 5.12.0 (2017-10-19)
* use `lastSegmentDuration + 2 * targetDuration` for safe live point instead of 3 segments [#1271](https://github.com/videojs/videojs-contrib-hls/pull/1271)
  * do not let back buffer trimming remove within target duration of current time
  * increase threshold for stuck playlist checking
* Fix video corruption on rendition switches in IE11 Win 8.1+ and Edge [#1259](https://github.com/videojs/videojs-contrib-hls/pull/1259)
  * segment-time-mapping event
  * update contrib-media-sources to 4.6.0
* prioritize user enabled playlists over blacklist [#1269](https://github.com/videojs/videojs-contrib-hls/pull/1269)
  * never allow playlist selector to select a playlist that has been permanently blacklisted due to incompatible configuration
  * When filtering playlists within the playlist selectors, if there are no enabled playlists (i.e. not blacklisted internally AND not disabled by the user) available, then fall back to using the list of playlists not disabled by the user regardless of blacklist state.
  * make sure playlists blacklisted from an illegal media switch is permanently blacklisted, as there is no reason to try it again at a later time.
  * The representation api will return a list that filters out just incompatible playlists instead of both incompatible playlists and temporary blacklisted playlists.

--------------------
## 5.11.1 (2017-10-11)
* update videojs-contrib-media-sources to 4.5.3 [#1278](https://github.com/videojs/videojs-contrib-hls/pull/1278)
  * update mux.js to 4.2.2
    * Use the first audio and video tracks in the PMT
* fix InvalidStateError for live playback in IE11 [#1266](https://github.com/videojs/videojs-contrib-hls/pull/1266)

--------------------
## 5.11.0 (2017-09-20)
* Update videojs-contrib-media-sources to 4.5.2 [#1262](https://github.com/videojs/videojs-contrib-hls/pull/1262)
  * let video.js remoteTextTrack auto cleanup take care of text track cleanup
* Blacklist incompatible playlists on probe if codec information not in master manifest [#1257](https://github.com/videojs/videojs-contrib-hls/pull/1257)
* Seek to seekable start when seeking before the seekable window [#1260](https://github.com/videojs/videojs-contrib-hls/pull/1260)
* MediaGroups: various bug fixes and refactor [#1243](https://github.com/videojs/videojs-contrib-hls/pull/1243)
  * Removes the Firefox 48 check for for supporting a change in audio info
  * Fix delayed switching between audio tracks and intermittent desync.

--------------------
## 5.10.1 (2017-08-28)
* fix: flv metadata tags now appened when audio info changes [#1245](https://github.com/videojs/videojs-contrib-hls/pull/1245)

--------------------
## 5.10.0 (2017-08-22)
* CEA608: support for cc2-cc4, special/extended characters, formatting [#1096](https://github.com/videojs/videojs-contrib-hls/pull/1096)
  * All four CC tracks are now available
  * If CLOSED-CAPTIONS are specified in the master manifest, the corresponding CC text tracks will be labled appropriately, otherwise will be labled CC1 - CC4
  * Underline and italics will now be rendered.
  * Special thanks to @squarebracket

--------------------
## 5.9.0 (2017-08-16)
* Add option to select lowest bitrate video rendition available on startup [#1212](https://github.com/videojs/videojs-contrib-hls/pull/1212)
* always activate loading in segment loaders after a seek [#1234](https://github.com/videojs/videojs-contrib-hls/pull/1234)
* Wait for `canplay` event from tech before `PlaybackWatcher` begins monitoring [#1230](https://github.com/videojs/videojs-contrib-hls/pull/1230)
  * Fixes InvalidStateError in Win10 IE11
* Blacklist playlist for 2 minutes on early abort to prevent cache loop [#1220](https://github.com/videojs/videojs-contrib-hls/pull/1220)
  * Prevent rendition switch loop due to inconsistent network/caching
  * Don't fire bandwidthupdate when aborting early
* make sure text tracks added by hls are properly disposed [#1228](https://github.com/videojs/videojs-contrib-hls/pull/1228)
* Fixing Backward Seeking in IE11 Win8.1 [#1225](https://github.com/videojs/videojs-contrib-hls/pull/1225)

--------------------
## 5.8.3 (2017-08-07)
* Fix: Double caption issue [#1219](https://github.com/videojs/videojs-contrib-hls/pull/1219)
* attach attributes property to playlist objects in cases the m3u8-parser does not[#1214](https://github.com/videojs/videojs-contrib-hls/pull/1214)
  * add warning log when missing attribute for stream-inf

--------------------
## 5.8.2 (2017-07-12)
* fix: processing segments when mediaSource is closed [#1201](https://github.com/videojs/videojs-contrib-hls/pull/1201)

--------------------
## 5.8.1 (2017-07-12)
* fix: audio only playlists with videojs-contrib-media-sources v4.4.7 [#1195](https://github.com/videojs/videojs-contrib-hls/pull/1195)

--------------------
## 5.8.0 (2017-07-06)
* Abr Improvements [#1176](https://github.com/videojs/videojs-contrib-hls/pull/1176)
  * Use a starting `bandwidth` value of `0.0625 MB/s` on Android devices
  * Do not allow an up-switch in quality until a certain amount of forward buffer has been filled, `BUFFER_LOW_WATER_LINE`
  * Dynamically increase the `BUFFER_LOW_WATER_LINE` and `GOAL_BUFFER_LENGTH` from `0 - > 30` and `30 -> 60` respectively during the first 30 seconds of playback
  * Abort segment requests before completion if bandwidth reported by the XHR `progress` event shows that network conditions are not fast enough to complete the request without causing rebuffering

--------------------
## 5.7.0 (2017-06-27)
* update mux.js to 4.1.5 and videojs-contrib-media-sources to 4.4.6 [#1180](https://github.com/videojs/videojs-contrib-hls/pull/1180)
  * Only flush PES packets from TS parsing front end when they are complete
    * Complete is defined as any time PES_packet_length matches the data’s length OR is a video packets
    * Works around an issue with incomplete packets getting sent down the pipeline when the source has audio PES packets split between segments
* Add hls usage tracking events [#1166](https://github.com/videojs/videojs-contrib-hls/pull/1166)
  * Usage tracking events are fired when we detect a certain HLS feature, encoding setting, or API is used. Note that although these usage events are listed in the README, they may change at any time without a major version change.
* Fix endOfStream for demuxed audio and video [#1175](https://github.com/videojs/videojs-contrib-hls/pull/1175)

--------------------
## 5.6.0 (2017-06-20)
* Do not reset segmentloaders when switching media groups [#1155](https://github.com/videojs/videojs-contrib-hls/pull/1155)
  * set loader state to ready on aborts even when loader is paused
* don't crash when segment metadata cues can't be created [#1167](https://github.com/videojs/videojs-contrib-hls/pull/1167)
* Allow overrideNative to be set as a player-level option [#1156](https://github.com/videojs/videojs-contrib-hls/pull/1156)
* Create a moving-average playlist selector [#1125](https://github.com/videojs/videojs-contrib-hls/pull/1125)
  * Define a variant of the standard playlist selector that calculates a moving average of bandwidth and uses that to select a playlist.
* Trigger bandwidthupdate events on the tech [#1122](https://github.com/videojs/videojs-contrib-hls/pull/1122)

--------------------
## 5.5.3 (2017-05-16)
* update mux.js to 4.1.4 and videojs-contrib-media-sources to 4.4.5 [#1117](https://github.com/videojs/videojs-contrib-hls/pull/1117)
  * ts probe searches packets for first it can successfully parse
  * Fixed an issue that could cause updateend events to fire more than once per append or remove under very specific conditions on firefox
* Trigger error events when received empty response [#1072](https://github.com/videojs/videojs-contrib-hls/pull/1072)

--------------------
## 5.5.2 (2017-05-10)
* Fix playback stalls when everything appears okay [#1100](https://github.com/videojs/videojs-contrib-hls/pull/1100)
  * add playback watcher check for unknown player waiting
  * do not do unknownwaiting check when the tech fires a native waiting event
  * dont track current time waiting when at the end of the buffer
  * call techWaiting_ when we detect a stall at the end of buffer

--------------------
## 5.5.1 (2017-05-04)
* Use specified mediasequence for VOD expired sync instead of assuming 0 [#1097](https://github.com/videojs/videojs-contrib-hls/pull/1097)
  * use synccontroller for expired
* fix: CODEC to mime-type conversion now takes into account all possible scenarios [#1099](https://github.com/videojs/videojs-contrib-hls/pull/1099)

--------------------
## 5.5.0 (2017-04-25)
* Update mux.js to 4.1.3 and media-sources to 4.4.4 [#1098](https://github.com/videojs/videojs-contrib-hls/pull/1098)
* Trigger an event when a playlist is blacklisted or retried [#1080](https://github.com/videojs/videojs-contrib-hls/pull/1080)
 * Triggers `blacklistplaylist` when a playlist is blacklisted
 * Triggers `retryplaylist` when retrying to load an errored playlist
* Add option to modify blacklist duration [#1076](https://github.com/videojs/videojs-contrib-hls/pull/1076)

--------------------
## 5.4.1 (2017-04-10)
* update contrib-media-sources to 4.4.3 [#1077](https://github.com/videojs/videojs-contrib-hls/pull/1077)
* Fix exceptions from calling endOfStream when the media source isn't ready [#1061](https://github.com/videojs/videojs-contrib-hls/pull/1061)
* fix segment time mapping for fmp4 playback [#1067](https://github.com/videojs/videojs-contrib-hls/pull/1067)
* If beforeRequest is set, reuse it on source changes [#983](https://github.com/videojs/videojs-contrib-hls/pull/983)
  * Allow changing global xhr beforeRequest at runtime
  * Always use latest beforeRequest instead of setting it when creating hls object

--------------------
## 5.4.0 (2017-04-03)
* feature: support for in-manifest WebVTT [#1057](https://github.com/videojs/videojs-contrib-hls/pull/1057)
* fix: minor SegmentLoader fixes [#1065](https://github.com/videojs/videojs-contrib-hls/pull/1065)
* fix: enable fast quality change for alternate audio [#1046](https://github.com/videojs/videojs-contrib-hls/pull/1046)
* feature: blacklist live playlists that have stopped being updated [#1039](https://github.com/videojs/videojs-contrib-hls/pull/1039)
  * never blacklist final available final rendition
* chore: refactor all the XHR handling code and related state out of SegmentLoader and into a single mediaSegmentRequest function [#1044](https://github.com/videojs/videojs-contrib-hls/pull/1044)
* feature: add a segment-metadata TextTrack that contains cues for the segments currently in the buffer [#976](https://github.com/videojs/videojs-contrib-hls/pull/976)
* feature: add support for description audio tracks in hls [#1019](https://github.com/videojs/videojs-contrib-hls/pull/1019)
  * add support for description audio tracks (marked with characteristics of 'public.accessibility.describes-video')
  * add test for correctly setting alternative audio kinds

--------------------
## 5.3.3 (2017-03-03)
* update videojs-contrib-media-sources to v4.4.2 and mux.js to 4.1.1 [#1037](https://github.com/videojs/videojs-contrib-hls/pull/1037)
  * Fix silence insertion to not insert extra frames when audio is offset [#143](https://github.com/videojs/mux.js/pull/143)
  * Fixed metadata cue mapping so that it considers groups cues with the same startTime and remaps them collectively to the same endTime [#121](https://github.com/videojs/videojs-contrib-media-sources/pull/121)
  * add fudge factor to flash tag trim target [#137](https://github.com/videojs/videojs-contrib-media-sources/pull/137)
  * Feat/vjs6 compat [#130](https://github.com/videojs/videojs-contrib-media-sources/pull/130)
  * Fix flash tag trimming for misaligned audio and video [#136](https://github.com/videojs/videojs-contrib-media-sources/pull/136)
  * Revert "Revert flash transmuxing in a web worker (#133)" [#135](https://github.com/videojs/videojs-contrib-media-sources/pull/135)
* fix: do not timeout segment requests for non-master playlist source [#1032](https://github.com/videojs/videojs-contrib-hls/pull/1032)

--------------------
## 5.3.2 (2017-02-23)
* fix: Fix a bug with the combination of seek-to-live and resync-on-a-poor-guess behaviors [#1023](https://github.com/videojs/videojs-contrib-hls/pull/1023)

--------------------
## 5.3.1 (2017-02-22)
* Locking url-toolkit to 1.0.9 to support relative urls [#1027](https://github.com/videojs/videojs-contrib-hls/pull/1027)
* Resync on poor initial segment choice [#1016](https://github.com/videojs/videojs-contrib-hls/pull/1016)
* Fix resuming live playback after long pauses [#1006](https://github.com/videojs/videojs-contrib-hls/pull/1006)

--------------------
## 5.3.0 (2017-02-16)
* reset segment loaders on all flash seeks [#1008](https://github.com/videojs/videojs-contrib-hls/pull/1008)
  * update mux.js to 4.1.0 update videojs-contrib-media-sources to 4.4.0
* Reorganized the functions in SegmentLoader to better follow the flow of execution from top-down [#1015](https://github.com/videojs/videojs-contrib-hls/pull/1015)
* Remove ad-hoc logging in favor of a config-enabled logging like playback-watcher [#1014](https://github.com/videojs/videojs-contrib-hls/pull/1014)
* isLowestEnabledRendition worked with redundant streams [#1004](https://github.com/videojs/videojs-contrib-hls/pull/1004)
* Rename Worker to DecrypterWorker [#1003](https://github.com/videojs/videojs-contrib-hls/pull/1003)

--------------------
## 5.2.1 (2017-02-09)
* feature: Support for Akamai-style Redundant HLS [#990](https://github.com/videojs/videojs-contrib-hls/pull/990)
  * stable sorting and always pick primary first
* Fix routing of decrypter messages intended for audio segment loader [#1001](https://github.com/videojs/videojs-contrib-hls/pull/1001)

--------------------
## 5.2.0 (2017-02-08)
* update deps for 4.3.0 mediasources [#998](https://github.com/videojs/videojs-contrib-hls/pull/998)
* Remove HLS object events from README [#992](https://github.com/videojs/videojs-contrib-hls/pull/992)

--------------------
## 5.1.1 (2017-02-03)
* fix: introduce videojs 6 forward compatibility while maintaining backward compatibilty [#975](https://github.com/videojs/videojs-contrib-hls/pull/975)
  * fix: swap to use getTech and null-check flash tech
  * Fix #968
  * only registerComponent Hls in older vjs
  * use registerPlugin if it exists
  * addTrack cross-compat
* Add events for underflow and live resync [#989](https://github.com/videojs/videojs-contrib-hls/pull/989)
  * For QoS measurement purposes, it may be useful to know how often the playback watcher is activating. Add new events for when the player falls off the back of the live window or stalls due to a video buffer gap.

--------------------
## 5.1.0 (2017-01-31)
* Updated videojs-contrib-media-sources to v4.2.0
  * Added support for inserting silence when appending a new segment will introduce a gap in the audio SourceBuffer
* Remove hls-audio-track.js as this file was no longer being used [#985](https://github.com/videojs/videojs-contrib-hls/pull/985)
* Stop blacklisting audio codecs as there is now wide support for switching between audio codecs on-the-fly among all modern browsers [#981](https://github.com/videojs/videojs-contrib-hls/pull/981)
* Fix qualityLevels setup for videos with a source element [#979](https://github.com/videojs/videojs-contrib-hls/pull/979)
* Error early for misconfigured overrideNative [#980](https://github.com/videojs/videojs-contrib-hls/pull/980)

--------------------
## 5.0.0 (2017-01-25)
* Update issue template to use unpkg for latest versions [#967](https://github.com/videojs/videojs-contrib-hls/pull/967)
* Use a snapshot of the issue template JSBin to protect from changes by owner [#969](https://github.com/videojs/videojs-contrib-hls/pull/969)
* Fix any possible fillBuffer_ race conditions by debouncing all fillBuffers_ [#959](https://github.com/videojs/videojs-contrib-hls/pull/959)
  * Convert all calls to fillBuffer_ to calls to monitorBuffer_
  * Rename monitorBuffer_ to monitorBufferTick_ which becomes the 500ms buffer check timer loop
  * Make monitorBuffer_ schedule an immediate timer for monitorBufferTick_
* Processing segment reachable even after playlist update removes it [#939](https://github.com/videojs/videojs-contrib-hls/pull/939)
  * Change processing segment reference on playlist refresh
  * Test for correct segment references on pending segments
  * Fix unreachable segment tests after rebase on async monitor buffer change
  * Update media index on playlist refreshes for all requests (including syncs)
* Bubble progress events [#978](https://github.com/videojs/videojs-contrib-hls/pull/978)
  * If the segment request triggers progress events (that is, XHR2 is supported), bubble those up to the tech. This makes it clearer that buffering is happening even on very slow connections.
* run decryption in a webworker [#972](https://github.com/videojs/videojs-contrib-hls/pull/972)
  * drop support for IE10
* Fixed mediaIndex tracking so that it is consistent when the playlist updates during a live stream [#977](https://github.com/videojs/videojs-contrib-hls/pull/977)
  * Fixed mediaIndex tracking so that it is consistent when the playlist updates during a live stream
  * Removed any code in SegmentLoader#handleUpdateEnd_ that changed the mediaIndex
  * Reordered SegmentLoader#playlist to make it easier to follow
  * All changes to both mediaIndexes (SegmentLoader's and segmentInfo's) now happen in SegmentLoader#playlist
  * Added tests for proper mediaIndex tracking with live playlists

--------------------
## 4.1.1 (2017-01-20)
* Fixed the m3u8-parser to support ES3 [#965](https://github.com/videojs/videojs-contrib-hls/pull/965)

--------------------
## 4.1.0 (2017-01-13)
* Representations and Quality Levels [#929](https://github.com/videojs/videojs-contrib-hls/pull/929)
* Update m3u8-parser to 2.0.0 and videojs-contrib-media-sources to 4.1.4 [#958](https://github.com/videojs/videojs-contrib-hls/pull/958)

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

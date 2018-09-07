# Notice: this project will be deprecated and is succeeded by [videojs-http-streaming](https://github.com/videojs/http-streaming). VHS supports HLS and DASH and is built into video.js 7, see the [video.js 7 blog post](https://blog.videojs.com/video-js-7-is-here/)

# video.js HLS Source Handler

[![Build Status][travis-icon]][travis-link]
[![Slack Status][slack-icon]][slack-link]
[![Greenkeeper badge][greenkeeper-icon]][greenkeeper-link]

Play back HLS with video.js, even where it's not natively supported.

Maintenance Status: Deprecated

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Installation](#installation)
  - [NPM](#npm)
  - [CDN](#cdn)
  - [Releases](#releases)
  - [Manual Build](#manual-build)
- [Contributing](#contributing)
- [Talk to us](#talk-to-us)
- [Getting Started](#getting-started)
  - [Video.js 6](#videojs-6)
- [Documentation](#documentation)
  - [Options](#options)
    - [How to use](#how-to-use)
      - [Initialization](#initialization)
      - [Source](#source)
    - [List](#list)
      - [withCredentials](#withcredentials)
      - [useCueTags](#usecuetags)
      - [overrideNative](#overridenative)
      - [blacklistDuration](#blacklistduration)
      - [bandwidth](#bandwidth)
      - [enableLowInitialPlaylist](#enablelowinitialplaylist)
  - [Runtime Properties](#runtime-properties)
    - [hls.playlists.master](#hlsplaylistsmaster)
    - [hls.playlists.media](#hlsplaylistsmedia)
    - [hls.segmentXhrTime](#hlssegmentxhrtime)
    - [hls.bandwidth](#hlsbandwidth)
    - [hls.bytesReceived](#hlsbytesreceived)
    - [hls.selectPlaylist](#hlsselectplaylist)
    - [hls.representations](#hlsrepresentations)
    - [hls.xhr](#hlsxhr)
  - [Events](#events)
    - [loadedmetadata](#loadedmetadata)
  - [HLS Usage Events](#hls-usage-events)
    - [Presence Stats](#presence-stats)
    - [Use Stats](#use-stats)
  - [In-Band Metadata](#in-band-metadata)
  - [Segment Metadata](#segment-metadata)
- [Hosting Considerations](#hosting-considerations)
- [Known Issues](#known-issues)
  - [IE10 and Below](#ie10-and-below)
  - [Fragmented MP4 Support](#fragmented-mp4-support)
  - [Testing](#testing)
- [Release History](#release-history)
- [Building](#building)
- [Development](#development)
  - [Tools](#tools)
  - [Commands](#commands)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Installation
### NPM
To install `videojs-contrib-hls` with npm run

```bash
npm install --save videojs-contrib-hls
```

### CDN
Select a version of HLS from [cdnjs](https://cdnjs.com/libraries/videojs-contrib-hls) or [jsDelivr](https://www.jsdelivr.com/package/npm/videojs-contrib-hls)

### Releases
Download a release of [videojs-contrib-hls](https://github.com/videojs/videojs-contrib-hls/releases)

### Manual Build
Download a copy of this git repository and then follow the steps in [Building](#building)

## Contributing
See [CONTRIBUTING.md](/CONTRIBUTING.md)

## Talk to us
Drop by our slack channel (#playback) on the [Video.js slack][slack-link].

## Getting Started
Get a copy of [videojs-contrib-hls](#installation) and include it in your page along with video.js:

```html
<video id=example-video width=600 height=300 class="video-js vjs-default-skin" controls>
  <source
     src="https://example.com/index.m3u8"
     type="application/x-mpegURL">
</video>
<script src="video.js"></script>
<script src="videojs-contrib-hls.min.js"></script>
<script>
var player = videojs('example-video');
player.play();
</script>
```

Check out our [live example](http://jsbin.com/vokipos/8/edit?html,output) if you're having trouble.

### Video.js 6
With Video.js 6, by default there is no flash support. Instead, flash support is provided
through the [videojs-flash](https://github.com/videojs/videojs-flash) plugin. If you are
trying to use Video.js version 6 and want to include flash support, you must include
[videojs-flash](https://github.com/videojs/videojs-flash) on your page before including
videojs-contrib-hls

```html
<script src="https://unpkg.com/videojs-flash/dist/videojs-flash.js"></script>
<script src="https://unpkg.com/videojs-contrib-hls/dist/videojs-contrib-hls.js"></script>
```

Flash, and the [videojs-flash](https://github.com/videojs/videojs-flash) plugin, are not
required, but are recommended as a fallback option for browsers that don't have a native
HLS player or support for [Media Source Extensions](http://caniuse.com/#feat=mediasource).

## Documentation
[HTTP Live Streaming](https://developer.apple.com/streaming/) (HLS) has
become a de-facto standard for streaming video on mobile devices
thanks to its native support on iOS and Android. There are a number of
reasons independent of platform to recommend the format, though:

- Supports (client-driven) adaptive bitrate selection
- Delivered over standard HTTP ports
- Simple, text-based manifest format
- No proprietary streaming servers required

Unfortunately, all the major desktop browsers except for Safari are
missing HLS support. That leaves web developers in the unfortunate
position of having to maintain alternate renditions of the same video
and potentially having to forego HTML-based video entirely to provide
the best desktop viewing experience.

This project addresses that situation by providing a polyfill for HLS
on browsers that have support for [Media Source
Extensions](http://caniuse.com/#feat=mediasource), or failing that,
support Flash. You can deploy a single HLS stream, code against the
regular HTML5 video APIs, and create a fast, high-quality video
experience across all the big web device categories.

Check out the [full documentation](docs/) for details on how HLS works
and advanced configuration. A description of the [adaptive switching
behavior](docs/bitrate-switching.md) is available, too.

videojs-contrib-hls supports a bunch of HLS features. Here
are some highlights:

- video-on-demand and live playback modes
- backup or redundant streams
- mid-segment quality switching
- AES-128 segment encryption
- CEA-608 captions are automatically translated into standard HTML5
  [caption text tracks][0]
- In-Manifest WebVTT subtitles are automatically translated into standard HTML5
  subtitle tracks
- Timed ID3 Metadata is automatically translated into HTML5 metedata
  text tracks
- Highly customizable adaptive bitrate selection
- Automatic bandwidth tracking
- Cross-domain credentials support with CORS
- Tight integration with video.js and a philosophy of exposing as much
  as possible with standard HTML APIs
- Stream with multiple audio tracks and switching to those audio tracks
  (see the docs folder) for info
- Media content in
  [fragmented MP4s](https://developer.apple.com/videos/play/wwdc2016/504/)
  instead of the MPEG2-TS container format.

[0]: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track

### Options
#### How to use

##### Initialization
You may pass in an options object to the hls source handler at player
initialization. You can pass in options just like you would for other
parts of video.js:

```javascript
// html5 for html hls
videojs(video, {html5: {
  hls: {
    withCredentials: true
  }
}});

// or

// flash for flash hls
videojs(video, {flash: {
  hls: {
    withCredentials: true
  }
}});

// or

var options = {hls: {
  withCredentials: true
}};

videojs(video, {flash: options, html5: options});

```

##### Source
Some options, such as `withCredentials` can be passed in to hls during
`player.src`

```javascript

var player = videojs('some-video-id');

player.src({
  src: 'https://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/bipbop_16x9_variant.m3u8',
  type: 'application/x-mpegURL',
  withCredentials: true
});
```

#### List
##### withCredentials
* Type: `boolean`
* can be used as a source option
* can be used as an initialization option

When the `withCredentials` property is set to `true`, all XHR requests for
manifests and segments would have `withCredentials` set to `true` as well. This
enables storing and passing cookies from the server that the manifests and
segments live on. This has some implications on CORS because when set, the
`Access-Control-Allow-Origin` header cannot be set to `*`, also, the response
headers require the addition of `Access-Control-Allow-Credentials` header which
is set to `true`.
See html5rocks's [article](http://www.html5rocks.com/en/tutorials/cors/)
for more info.

##### handleManifestRedirects
* Type: `boolean`
* Default: `false`
* can be used as a source option
* can be used as an initialization option

When the `handleManifestRedirects` property is set to `true`, manifest requests
which are redirected will have their URL updated to the new URL for future
requests.

##### useCueTags
* Type: `boolean`
* can be used as an initialization option

When the `useCueTags` property is set to `true,` a text track is created with
label 'ad-cues' and kind 'metadata'. The track is then added to
`player.textTracks()`. Changes in active cue may be
tracked by following the Video.js cue points API for text tracks. For example:

```javascript
let textTracks = player.textTracks();
let cuesTrack;

for (let i = 0; i < textTracks.length; i++) {
  if (textTracks[i].label === 'ad-cues') {
    cuesTrack = textTracks[i];
  }
}

cuesTrack.addEventListener('cuechange', function() {
  let activeCues = cuesTrack.activeCues;

  for (let i = 0; i < activeCues.length; i++) {
    let activeCue = activeCues[i];

    console.log('Cue runs from ' + activeCue.startTime +
                ' to ' + activeCue.endTime);
  }
});
```

##### overrideNative
* Type: `boolean`
* can be used as an initialization option

Try to use videojs-contrib-hls even on platforms that provide some
level of HLS support natively. There are a number of platforms that
*technically* play back HLS content but aren't very reliable or are
missing features like CEA-608 captions support. When `overrideNative`
is true, if the platform supports Media Source Extensions
videojs-contrib-hls will take over HLS playback to provide a more
consistent experience.

__NOTE__: If you use this option, you must also set
`videojs.options.html5.nativeAudioTracks` and
`videojs.options.html5.nativeVideoTracks` to
`false`. videojs-contrib-hls relies on audio and video tracks to play
streams with alternate audio and requires additional capabilities only
supported by non-native tracks in video.js.

##### blacklistDuration
* Type: `number`
* can be used as an initialization option

When the `blacklistDuration` property is set to a time duration in seconds,
if a playlist is blacklisted, it will be blacklisted for a period of that
customized duration. This enables the blacklist duration to be configured
by the user.

##### bandwidth
* Type: `number`
* can be used as an initialization option

When the `bandwidth` property is set (bits per second), it will be used in
the calculation for initial playlist selection, before more bandwidth
information is seen by the player.

##### enableLowInitialPlaylist
* Type: `boolean`
* can be used as an initialization option

When `enableLowInitialPlaylist` is set to true, it will be used to select
the lowest bitrate playlist initially.  This helps to decrease playback start time.
This setting is `false` by default.

### Runtime Properties
Runtime properties are attached to the tech object when HLS is in
use. You can get a reference to the HLS source handler like this:

```javascript
var hls = player.tech({ IWillNotUseThisInPlugins: true }).hls;
```

If you *were* thinking about modifying runtime properties in a
video.js plugin, we'd recommend you avoid it. Your plugin won't work
with videos that don't use videojs-contrib-hls and the best plugins
work across all the media types that video.js supports. If you're
deploying videojs-contrib-hls on your own website and want to make a
couple tweaks though, go for it!

#### hls.playlists.master
Type: `object`

An object representing the parsed master playlist. If a media playlist
is loaded directly, a master playlist with only one entry will be
created.

#### hls.playlists.media
Type: `function`

A function that can be used to retrieve or modify the currently active
media playlist. The active media playlist is referred to when
additional video data needs to be downloaded. Calling this function
with no arguments returns the parsed playlist object for the active
media playlist. Calling this function with a playlist object from the
master playlist or a URI string as specified in the master playlist
will kick off an asynchronous load of the specified media
playlist. Once it has been retreived, it will become the active media
playlist.

#### hls.segmentXhrTime
Type: `number`

The number of milliseconds it took to download the last media segment.
This value is updated after each segment download completes.

#### hls.bandwidth
Type: `number`

The number of bits downloaded per second in the last segment download.
This value is used by the default implementation of `selectPlaylist`
to select an appropriate bitrate to play.

Before the first video segment has been downloaded, it's hard to
estimate bandwidth accurately. The HLS tech uses a heuristic based on
the playlist download times to do this estimation by default. If you
have a more accurate source of bandwidth information, you can override
this value as soon as the HLS tech has loaded to provide an initial
bandwidth estimate.

#### hls.bytesReceived
Type: `number`

The total number of content bytes downloaded by the HLS tech.

#### hls.selectPlaylist
Type: `function`

A function that returns the media playlist object to use to download
the next segment. It is invoked by the tech immediately before a new
segment is downloaded. You can override this function to provide your
adaptive streaming logic. You must, however, be sure to return a valid
media playlist object that is present in `player.hls.master`.

Overridding this function with your own is very powerful but is overkill
for many purposes. Most of the time, you should use the much simpler
function below to selectively enable or disable a playlist from the
adaptive streaming logic.

#### hls.representations
Type: `function`

It is recommended to include the [videojs-contrib-quality-levels](https://github.com/videojs/videojs-contrib-quality-levels) plugin to your page so that videojs-contrib-hls will automatically populate the QualityLevelList exposed on the player by the plugin. You can access this list by calling `player.qualityLevels()`. See the [videojs-contrib-quality-levels project page](https://github.com/videojs/videojs-contrib-quality-levels) for more information on how to use the api.

Example, only enabling representations with a width greater than or equal to 720:

```javascript
var qualityLevels = player.qualityLevels();

for (var i = 0; i < qualityLevels.length; i++) {
  var quality = qualityLevels[i];
  if (quality.width >= 720) {
    quality.enabled = true;
  } else {
    quality.enabled = false;
  }
}
```

If including [videojs-contrib-quality-levels](https://github.com/videojs/videojs-contrib-quality-levels) is not an option, you can use the representations api. To get all of the available representations, call the `representations()` method on `player.hls`. This will return a list of plain objects, each with `width`, `height`, `bandwidth`, and `id` properties, and an `enabled()` method.

```javascript
player.hls.representations();
```

To see whether the representation is enabled or disabled, call its `enabled()` method with no arguments. To set whether it is enabled/disabled, call its `enabled()` method and pass in a boolean value. Calling `<representation>.enabled(true)` will allow the adaptive bitrate algorithm to select the representation while calling `<representation>.enabled(false)` will disallow any selection of that representation.

Example, only enabling representations with a width greater than or equal to 720:

```javascript
player.hls.representations().forEach(function(rep) {
  if (rep.width >= 720) {
    rep.enabled(true);
  } else {
    rep.enabled(false);
  }
});
```

#### hls.xhr
Type: `function`

The xhr function that is used by HLS internally is exposed on the per-
player `hls` object. While it is possible, we do not recommend replacing
the function with your own implementation. Instead, the `xhr` provides
the ability to specify a `beforeRequest` function that will be called
with an object containing the options that will be used to create the
xhr request.

Example:
```javascript
player.hls.xhr.beforeRequest = function(options) {
  options.uri = options.uri.replace('example.com', 'foo.com');

  return options;
};
```

The global `videojs.Hls` also exposes an `xhr` property. Specifying a
`beforeRequest` function on that will allow you to intercept the options
for *all* requests in every player on a page. For consistency across
browsers the video source should be set at runtime once the video player
is ready.

Example
```javascript
videojs.Hls.xhr.beforeRequest = function(options) {
  /*
   * Modifications to requests that will affect every player.
   */

  return options;
};

var player = videojs('video-player-id');
player.ready(function() {
  this.src({
    src: 'https://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL',
  });
});
```

For information on the type of options that you can modify see the
documentation at [https://github.com/Raynos/xhr](https://github.com/Raynos/xhr).

### Events
Standard HTML video events are handled by video.js automatically and
are triggered on the player object.

#### loadedmetadata

Fired after the first segment is downloaded for a playlist. This will not happen
until playback if video.js's `metadata` setting is `none`

### HLS Usage Events

Usage tracking events are fired when we detect a certain HLS feature, encoding setting,
or API is used. These can be helpful for analytics, and to pinpoint the cause of HLS errors.
For instance, if errors are being fired in tandem with a usage event indicating that the
player was playing an AES encrypted stream, then we have a possible avenue to explore when
debugging the error.

Note that although these usage events are listed below, they may change at any time without
a major version change.

HLS usage events are triggered on the tech with the exception of the 3 hls-reload-error
events, which are triggered on the player.

#### Presence Stats

Each of the following usage events are fired once per source if (and when) detected:

| Name          | Description   |
| ------------- | ------------- |
| hls-webvtt    | master manifest has at least one segmented WebVTT playlist |
| hls-aes       | a playlist is AES encrypted |
| hls-fmp4      | a playlist used fMP4 segments |
| hls-demuxed   | audio and video are demuxed by default |
| hls-alternate-audio | alternate audio available in the master manifest |
| hls-playlist-cue-tags | a playlist used cue tags (see useCueTags(#usecuetags) for details) |

#### Use Stats

Each of the following usage events are fired per use:

| Name          | Description   |
| ------------- | ------------- |
| hls-gap-skip  | player skipped a gap in the buffer |
| hls-player-access | player.hls was accessed |
| hls-audio-change | a user selected an alternate audio stream |
| hls-rendition-disabled | a rendition was disabled |
| hls-rendition-enabled | a rendition was enabled |
| hls-rendition-blacklisted | a rendition was blacklisted |
| hls-timestamp-offset | a timestamp offset was set in HLS (can identify discontinuities) |
| hls-unknown-waiting | the player stopped for an unknown reason and we seeked to current time try to address it |
| hls-live-resync | playback fell off the back of a live playlist and we resynced to the live point |
| hls-video-underflow | we seeked to current time to address video underflow |
| hls-error-reload-initialized | the reloadSourceOnError plugin was initialized |
| hls-error-reload | the reloadSourceOnError plugin reloaded a source |
| hls-error-reload-canceled | an error occurred too soon after the last reload, so we didn't reload again (to prevent error loops) |


### In-Band Metadata
The HLS tech supports [timed
metadata](https://developer.apple.com/library/ios/#documentation/AudioVideo/Conceptual/HTTP_Live_Streaming_Metadata_Spec/Introduction/Introduction.html)
embedded as [ID3 tags](http://id3.org/id3v2.3.0). When a stream is
encountered with embedded metadata, an [in-band metadata text
track](https://html.spec.whatwg.org/multipage/embedded-content.html#text-track-in-band-metadata-track-dispatch-type)
will automatically be created and populated with cues as they are
encountered in the stream. UTF-8 encoded
[TXXX](http://id3.org/id3v2.3.0#User_defined_text_information_frame)
and [WXXX](http://id3.org/id3v2.3.0#User_defined_URL_link_frame) ID3
frames are mapped to cue points and their values set as the cue
text. Cues are created for all other frame types and the data is
attached to the generated cue:

```javascript
cue.value.data
```

There are lots of guides and references to using text tracks [around
the web](http://www.html5rocks.com/en/tutorials/track/basics/).

### Segment Metadata
You can get metadata about the segments currently in the buffer by using the `segment-metadata`
text track. You can get the metadata of the currently rendered segment by looking at the
track's `activeCues` array. The metadata will be attached to the `cue.value` property and
will have this structure

```javascript
cue.value = {
  byteLength, // The size of the segment in bytes
  bandwidth, // The peak bitrate reported by the segment's playlist
  resolution, // The resolution reported by the segment's playlist
  codecs, // The codecs reported by the segment's playlist
  uri, // The Segment uri
  timeline, // Timeline of the segment for detecting discontinuities
  playlist, // The Playlist uri
  start, // Segment start time
  end // Segment end time
};
```

Example:
Detect when a change in quality is rendered on screen
```javascript
let tracks = player.textTracks();
let segmentMetadataTrack;

for (let i = 0; i < tracks.length; i++) {
  if (tracks[i].label === 'segment-metadata') {
    segmentMetadataTrack = tracks[i];
  }
}

let previousPlaylist;

if (segmentMetadataTrack) {
  segmentMetadataTrack.on('cuechange', function() {
    let activeCue = segmentMetadataTrack.activeCues[0];

    if (activeCue) {
      if (previousPlaylist !== activeCue.value.playlist) {
        console.log('Switched from rendition ' + previousPlaylist +
                    ' to rendition ' + activeCue.value.playlist);
      }
      previousPlaylist = activeCue.value.playlist;
    }
  });
}
```

## Hosting Considerations
Unlike a native HLS implementation, the HLS tech has to comply with
the browser's security policies. That means that all the files that
make up the stream must be served from the same domain as the page
hosting the video player or from a server that has appropriate [CORS
headers](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS)
configured. Easy [instructions are
available](http://enable-cors.org/server.html) for popular webservers
and most CDNs should have no trouble turning CORS on for your account.


## Known Issues
Issues that are currenty know about with workarounds. If you want to
help find a solution that would be appreciated!

### IE10 and Below
As of version 5.0.0, IE10 and below are no longer supported.

### Fragmented MP4 Support
Edge has native support for HLS but only in the MPEG2-TS container. If
you attempt to play an HLS stream with fragmented MP4 segments, Edge
will stall. Fragmented MP4s are only supported on browser that have
[Media Source Extensions](http://caniuse.com/#feat=mediasource) available.

### Testing

For testing, you run `npm run test`. This will run tests using any of the
browsers that karma-detect-browsers detects on your machine.

## Release History
Check out the [changelog](CHANGELOG.md) for a summary of each release.

## Building
To build a copy of videojs-contrib-hls run the following commands

```bash
git clone https://github.com/videojs/videojs-contrib-hls
cd videojs-contrib-hls
npm i
npm run build
```

videojs-contrib-hls will have created all of the files for using it in a dist folder

## Development

### Tools
* Download stream locally with the [HLS Fetcher](https://github.com/imbcmdth/hls-fetcher)
* Simulate errors with [Murphy](https://github.com/mrocajr/murphy)

### Commands
All commands for development are listed in the `package.json` file and are run using
```bash
npm run <command>
```

[slack-icon]: http://slack.videojs.com/badge.svg
[slack-link]: http://slack.videojs.com
[travis-icon]: https://travis-ci.org/videojs/videojs-contrib-hls.svg?branch=master
[travis-link]: https://travis-ci.org/videojs/videojs-contrib-hls
[greenkeeper-icon]: https://badges.greenkeeper.io/videojs/videojs-contrib-hls.svg
[greenkeeper-link]: https://greenkeeper.io/

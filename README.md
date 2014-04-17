# video.js HLS Plugin

A video.js plugin that plays HLS video on platforms that don't support it but have Flash.

[![Build Status](https://travis-ci.org/videojs/videojs-contrib-hls.svg?branch=master)](https://travis-ci.org/videojs/videojs-contrib-hls)

## Getting Started
Download the [plugin](https://github.com/videojs/videojs-contrib-hls/releases). On your web page:

```html
<script src="video.js"></script>
<script src="videojs-hls.min.js"></script>
<script>
  var player = videojs('video');
  player.hls('http://example.com/video.m3u8');
  player.play();
</script>
```

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

This plugin attempts to address that situation by providing a polyfill
for HLS on browsers that have Flash support. You can deploy a single
HLS stream, code against the regular HTML5 video APIs, and create a
fast, high-quality video experience across all the big web device
categories.

The videojs-hls plugin is still working towards a 1.0 release so it
may not fit your requirements today. Specifically, there is _no_
support for:

- Alternate audio and video tracks
- Subtitles
- Segment codecs _other than_ H.264 with AAC audio
- Internet Explorer < 10

### Plugin Options

You may pass in an options object to the hls plugin upon initialization. This
object may contain one of the following properties:

#### withCredentials
Type: `boolean`

When the `withCredentials` property is set to `true`, all XHR requests for
manifests and segments would have `withCredentials` set to `true` as well. This
enables storing and passing cookies from the server that the manifests and
segments live on. This has some implications on CORS because when set, the
`Access-Control-Allow-Origin` header cannot be set to `*`, also, the response
headers require the addition of `Access-Control-Allow-Credentials` header which
is set to `true`.
See html5rocks's [article](http://www.html5rocks.com/en/tutorials/cors/)
for more info.

### Runtime Properties
#### player.hls.master
Type: `object`

An object representing the parsed master playlist. If a media playlist
is loaded directly, a master playlist with only one entry will be
created.

#### player.hls.media
Type: `object`

An object representing the currently selected media playlist. This is
the playlist that is being referred to when a additional video data
needs to be downloaded.

#### player.hls.mediaIndex
Type: `number`

The index of the next video segment to be downloaded from
`player.hls.media`.

#### player.hls.selectPlaylist
Type: `function`

A function that returns the media playlist object to use to download
the next segment. It is invoked by the plugin immediately before a new
segment is downloaded. You can override this function to provide your
adaptive streaming logic. You must, however, be sure to return a valid
media playlist object that is present in `player.hls.master`.

### Events
#### loadedmetadata

Fired after the first media playlist is downloaded for a stream.

#### loadedmanifest

Fired immediately after a new master or media playlist has been
downloaded. By default, the plugin only downloads playlists as they
are needed.

## Hosting Considerations
Unlike a native HLS implementation, the HLS plugin has to comply with
the browser's security policies. That means that all the files that
make up the stream must be served from the same domain as the page
hosting the video player or from a server that has appropriate [CORS
headers](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS)
configured. Easy [instructions are
available](http://enable-cors.org/server.html) for popular webservers
and most CDNs should have no trouble turning CORS on for your account.

## MBR Rendition Selection Logic
In situations where manifests have multiple renditions, the player will
go through the following algorithm to determine the best rendition by
bandwidth and viewport dimensions.

- Start on index 0 as defined in the HLS Spec (link above)
- On a successful load complete per segment determine the following;
    - player.hls.bandwidth set to value as segment byte size over download time
    - Viewport width/height as determined by player.width()/player.height()
    - Playlists mapped and sorted by BANDWIDTH less than or equal to 1.1x player.hls.bandwidth
    - Best playlist variant by BANDWIDTH determined
    - Subset of bandwidth appropriate renditions mapped
    - Subset validated for RESOLUTION attributes less than or equal to player dimensions
    - Best playlist variant by RESOLUTION determined
- Result is as follows;
    - [Best RESOLUTION variant] OR [Best BANDWIDTH variant] OR [inital playlist in manifest]

## Release History
 - 0.4.0: Live stream support
 - 0.3.0: Performance fixes for high-bitrate streams
 - 0.2.0: Basic playback and adaptive bitrate selection
 - 0.1.0: Initial release

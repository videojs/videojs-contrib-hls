# video.js HLS Source Handler

Play back HLS with video.js, even where it's not natively supported.

[![Build Status](https://travis-ci.org/videojs/videojs-contrib-hls.svg?branch=master)](https://travis-ci.org/videojs/videojs-contrib-hls)

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Getting Started](#getting-started)
- [Known Issues](#known-issues)
  - [IE11](#ie11)
- [Documentation](#documentation)
  - [Options](#options)
    - [withCredentials](#withcredentials)
  - [Runtime Properties](#runtime-properties)
    - [hls.playlists.master](#hlsplaylistsmaster)
    - [hls.playlists.media](#hlsplaylistsmedia)
    - [hls.segmentXhrTime](#hlssegmentxhrtime)
    - [hls.bandwidth](#hlsbandwidth)
    - [hls.bytesReceived](#hlsbytesreceived)
    - [hls.selectPlaylist](#hlsselectplaylist)
    - [hls.xhr](#hlsxhr)
  - [Events](#events)
    - [loadedmetadata](#loadedmetadata)
    - [loadedplaylist](#loadedplaylist)
    - [mediachange](#mediachange)
  - [In-Band Metadata](#in-band-metadata)
- [Hosting Considerations](#hosting-considerations)
  - [Testing](#testing)
- [Release History](#release-history)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


## Getting Started
Download
[videojs-contrib-hls](https://github.com/videojs/videojs-contrib-hls/releases)
and include it in your page along with video.js:

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

Check out our [live example](http://videojs.github.io/videojs-contrib-hls/) if you're having trouble.

## Known Issues
Issues that are currenty know about with workarounds. If you want to
help find a solution that would be appreciated!

### IE11
In some IE11 setups there are issues working with it's native HTML
SourceBuffers functionality. This leads to various issues, such as
videos stopping playback with media decode errors. The known workaround
for this issues is to force the player to use flash when running on IE11.

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

videojs-contrib-hls support a bunch of HLS v2 and v3 features. Here
are some highlights:

- video-on-demand and live playback modes
- backup or redundant streams
- mid-segment quality switching
- AES-128 segment encryption
- CEA-608 captions are automatically translated into standard HTML5
  [caption text tracks][0]
- Timed ID3 Metadata is automatically translated into HTML5 metedata
  text tracks
- Highly customizable adaptive bitrate selection
- Automatic bandwidth tracking
- Cross-domain credentials support with CORS
- Tight integration with video.js and a philosophy of exposing as much
  as possible with standard HTML APIs
- Stream with multiple audio tracks and switching to those audio tracks
  (see the docs folder) for info

[0]: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track

### Options

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

```

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
Runtime properties are attached to the tech object when HLS is in
use. You can get a reference to the HLS source handler like this:

```js
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
for *all* requests in every player on a page.

Example
```javascript
videojs.Hls.xhr.beforeRequest = function(options) {
  /*
   * Modifications to requests that will affect every player.
   */

  return options;
};
```

For information on the type of options that you can modify see the
documentation at [https://github.com/Raynos/xhr](https://github.com/Raynos/xhr).


### Events
Standard HTML video events are handled by video.js automatically and
are triggered on the player object. In addition, there are a couple
specialized events you can listen to on the HLS object during
playback:

#### loadedmetadata

Fired after the first media playlist is downloaded for a stream.

#### loadedplaylist

Fired immediately after a new master or media playlist has been
downloaded. By default, the tech only downloads playlists as they
are needed.

#### mediachange

Fired when a new playlist becomes the active media playlist. Note that
the actual rendering quality change does not occur simultaneously with
this event; a new segment must be requested and the existing buffer
depleted first.

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

```js
cue.value.data
```

There are lots of guides and references to using text tracks [around
the web](http://www.html5rocks.com/en/tutorials/track/basics/).

## Hosting Considerations
Unlike a native HLS implementation, the HLS tech has to comply with
the browser's security policies. That means that all the files that
make up the stream must be served from the same domain as the page
hosting the video player or from a server that has appropriate [CORS
headers](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS)
configured. Easy [instructions are
available](http://enable-cors.org/server.html) for popular webservers
and most CDNs should have no trouble turning CORS on for your account.

### Testing

For testing, you run `npm run test`. This will run tests using any of the
browsers that karma-detect-browsers detects on your machine.

## Release History
Check out the [changelog](CHANGELOG.md) for a summary of each release.

# video.js HLS Tech

A video.js tech that plays HLS video on platforms that don't support it but have Flash.

[![Build Status](https://travis-ci.org/videojs/videojs-contrib-hls.svg?branch=master)](https://travis-ci.org/videojs/videojs-contrib-hls)

## Getting Started
Download [videojs-contrib-media-sources](https://github.com/videojs/videojs-contrib-media-sources/releases) and [videojs-contrib-hls](https://github.com/videojs/videojs-contrib-hls/releases). Include them both in your web page along with video.js:

```html
<video id=example-video width=600 height=300 class="video-js vjs-default-skin" controls>
  <source
     src="https://example.com/index.m3u8"
     type="application/x-mpegURL">
</video>
<script src="video.js"></script>
<script src="videojs-media-sources.js"></script>
<script src="videojs-hls.min.js"></script>
<script>
var player = videojs('example-video');
player.play();
</script>
```

Check out our [live example](http://videojs.github.io/videojs-contrib-hls/) if you're having trouble.

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

This tech attempts to address that situation by providing a polyfill
for HLS on browsers that have Flash support. You can deploy a single
HLS stream, code against the regular HTML5 video APIs, and create a
fast, high-quality video experience across all the big web device
categories.

Check out the [full documentation](docs/) for details on how HLS works
and advanced configuration. A description of the [adaptive switching
behavior](docs/bitrate-switching.md) is available, too.

The videojs-hls tech is still working towards a 1.0 release so it
may not fit your requirements today. Specifically, there is _no_
support for:

- Alternate audio and video tracks
- Subtitles
- Segment codecs _other than_ H.264 with AAC audio
- Internet Explorer < 10

### Options

You may pass in an options object to the hls tech at player
initialization. You can pass in options just like you would for any
other tech:

```javascript
videojs(video, {
  hls: {
    withCredentials: true
  }
});
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
#### player.hls.playlists.master
Type: `object`

An object representing the parsed master playlist. If a media playlist
is loaded directly, a master playlist with only one entry will be
created.

#### player.hls.playlists.media
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

#### player.hls.mediaIndex
Type: `number`

The index of the next video segment to be downloaded from
`player.hls.media`.

#### player.hls.segmentXhrTime
Type: `number`

The number of milliseconds it took to download the last media segment.
This value is updated after each segment download completes.

#### player.hls.bandwidth
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

#### player.hls.bytesReceived
Type: `number`

The total number of content bytes downloaded by the HLS tech.

#### player.hls.selectPlaylist
Type: `function`

A function that returns the media playlist object to use to download
the next segment. It is invoked by the tech immediately before a new
segment is downloaded. You can override this function to provide your
adaptive streaming logic. You must, however, be sure to return a valid
media playlist object that is present in `player.hls.master`.

### Events
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
cue.frame.data
```

There are lots of guides and references to using text tracks [around
the web](http://www.html5rocks.com/en/tutorials/track/basics/).

### Testing

For testing, you can either run `npm test` or use `grunt` directly.
If you use `npm test`, it will only run the karma and end-to-end tests using chrome.
You can specify which browsers you want the tests to run via grunt's `test` task.
You can use either grunt-style arguments or comma separated arguments:
```
grunt test:chrome:firefox	# grunt-style
grunt test:chrome,firefox	# comma-separated
```
Possible options are:
* `chromecanary`
* `phantomjs`
* `opera`
* `chrome`<sup>1</sup>
* `safari`<sup>1, 2</sup>
* `firefox`<sup>1</sup>
* `ie`<sup>1</sup>


_<sup>1</sup>supported end-to-end browsers_<br />
_<sup>2</sup>requires the [SafariDriver extension]( https://code.google.com/p/selenium/wiki/SafariDriver) to be installed_

## Hosting Considerations
Unlike a native HLS implementation, the HLS tech has to comply with
the browser's security policies. That means that all the files that
make up the stream must be served from the same domain as the page
hosting the video player or from a server that has appropriate [CORS
headers](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS)
configured. Easy [instructions are
available](http://enable-cors.org/server.html) for popular webservers
and most CDNs should have no trouble turning CORS on for your account.

## Release History
Check out the [changelog](CHANGELOG.md) for a summary of each release.

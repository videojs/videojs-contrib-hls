[![Build Status](https://travis-ci.org/bclwhitaker/videojs-contrib-hls.png)](https://travis-ci.org/bclwhitaker/videojs-contrib-hls)

# video.js HLS Plugin

A video.js plugin that plays HLS video on platforms that don't support it but have Flash.

## Getting Started
Download the [plugin](https://raw.github.com/videojs/videojs-contrib-hls/master/dist/videojs-hls.min.js). On your web page:

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
(HTTP Live Streaming)[https://developer.apple.com/streaming/](HLS) has
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
- Dynamic bitrate switching
- Segment codecs _other than_ H.264 with AAC audio
- Live streams
- Internet Explorer 8

## Hosting Considerations
Unlike a native HLS implementation, the HLS plugin has to comply with
the browser's security policies. That means that all the files that
make up the stream must be served from the same domain as the page
hosting the video player or from a server that has appropriate [CORS
headers](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS)
configured. Easy [instructions are
available](http://enable-cors.org/server.html) for popular webservers
and most CDNs should have no trouble turning CORS on for your account.

## Release History
_(Nothing yet)_

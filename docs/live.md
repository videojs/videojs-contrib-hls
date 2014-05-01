# Live HLS Research
This document is a collection of notes on Live HLS implementations in the wild.

There are two varieties of Live HLS. In the first, playlists are
persistent and strictly appended to. In the alternative form, the
maximum number of segments in a playlist is relatively stable and an
old segment is removed every time a new segment becomes available.

On iOS devices, both stream types report a duration of `Infinity`. The
`currentTime` is equal to the amount of the stream that has been
played back on the device.

## Akamai HD2

## OnceLIVE
"Sliding window" live streams.

### Variant Playlists
Once variant playlists look like standard HLS variant playlists.

### Media Playlists
OnceLIVE uses "sliding window" manifests for live playback. The media
playlists do not have an `EXT-X-ENDLIST` and don't declare a
`EXT-X-PLAYLIST-TYPE`.  On first request, the stream media playlist
returned four segment URLs with a starting media sequence of one,
preceded by a `EXT-X-DISCONTINUITY` tag. As playback progressed, that
number grew to 13 segment URLs, at which point it stabilized. That
would equate to a steady-state 65 second window at 5 seconds per
segment.

OnceLive documentation is [available on the Unicorn Media
website](http://www.unicornmedia.com/documents/2013/02/oncelive_implementationguide.pdf).

Here's a script to quickly parse out segment URLs:

```shell
curl $ONCE_MEDIA_PLAYLIST | grep '^http'
```

An example media playlist might look something like this:
```m3u8
#EXTM3U
#EXT-X-TARGETDURATION:5
#EXT-X-MEDIA-SEQUENCE:3
#EXTINF:5,3
http://example.com/0/1/content.ts?visitguid=uuid&asseturl=http://once.example.com/asset.lrm&failoverurl=http://example.com/blank.jpg
#EXTINF:5,4
http://example.com/1/2/content.ts?visitguid=uuid&asseturl=http://once.example.com/asset.lrm&failoverurl=http://example.com/blank.jpg
#EXTINF:5,5
http://example.com/2/3/content.ts?visitguid=uuid&asseturl=http://once.example.com/asset.lrm&failoverurl=http://example.com/blank.jpg
#EXTINF:5,6
http://example.com/3/4/content.ts?visitguid=uuid&asseturl=http://once.example.com/asset.lrm&failoverurl=http://example.com/blank.jpg
```

## Zencoder Live

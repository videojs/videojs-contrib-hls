(function(window) {
  window.videojs.hls.m3u8TagType = {
    /*
     * Derived from the HTTP Live Streaming Spec V8
     * http://tools.ietf.org/html/draft-pantos-http-live-streaming-08
     */

    /**
     *  Identifies manifest as Extended M3U - must be present on first line!
     */
    EXTM3U:"#EXTM3U",

    /**
     *  Specifies duration.
     *  Syntax:  #EXTINF:<duration>,<title>
     *  Example: #EXTINF:10,
     */
    EXTINF:"#EXTINF:",

    /**
     *  Indicates that a media segment is a sub-range of the resource identified by its media URI.
     *  Syntax:  #EXT-X-BYTERANGE:<n>[@o]
     */
    BYTERANGE:"#EXT-X-BYTERANGE:",

    /**
     *  Specifies the maximum media segment duration - applies to entire manifest.
     *  Syntax:  #EXT-X-TARGETDURATION:<s>
     *  Example: #EXT-X-TARGETDURATION:10
     */
    TARGETDURATION:"#EXT-X-TARGETDURATION:",

    /**
     *  Specifies the sequence number of the first URI in a manifest.
     *  Syntax:  #EXT-X-MEDIA-SEQUENCE:<i>
     *  Example: #EXT-X-MEDIA-SEQUENCE:50
     */
    MEDIA_SEQUENCE:"#EXT-X-MEDIA-SEQUENCE:",

    /**
     *  Specifies a method by which media segments can be decrypted, if encryption is present.
     *  Syntax:  #EXT-X-KEY:<attribute-list>
     *  Note: This is likely irrelevant in the context of the Flash Player.
     */
    KEY:"#EXT-X-KEY:",

    /**
     *  Associates the first sample of a media segment with an absolute date and/or time.  Applies only to the next media URI.
     *  Syntax:  #EXT-X-PROGRAM-DATE-TIME:<YYYY-MM-DDThh:mm:ssZ>
     *  Example: #EXT-X-PROGRAM-DATE-TIME:2010-02-19T14:54:23.031+08:00
     */
    PROGRAM_DATE_TIME:"#EXT-X-PROGRAM-DATE-TIME:",

    /**
     *  Indicates whether the client MAY or MUST NOT cache downloaded media segments for later replay.
     *  Syntax:  #EXT-X-ALLOW-CACHE:<YES|NO>
     *  Note: This is likely irrelevant in the context of the Flash Player.
     */
    ALLOW_CACHE:"#EXT-X-ALLOW_CACHE:",

    /**
     *  Provides mutability information about the manifest.
     *  Syntax:  #EXT-X-PLAYLIST-TYPE:<EVENT|VOD>
     */
    PLAYLIST_TYPE:"#EXT-X-PLAYLIST-TYPE:",

    /**
     *  Indicates that no more media segments will be added to the manifest. May occur ONCE, anywhere in the mainfest file.
     */
    ENDLIST:"#EXT-X-ENDLIST",

    /**
     *  Used to relate Playlists that contain alternative renditions of the same content.
     *  Syntax:  #EXT-X-MEDIA:<attribute-list>
     */
    MEDIA:"#EXT-X-MEDIA:",

    /**
     *  Identifies a media URI as a Playlist file containing a multimedia presentation and provides information about that presentation.
     *  Syntax:  #EXT-X-STREAM-INF:<attribute-list>
     *           <URI>
     */
    STREAM_INF:"#EXT-X-STREAM-INF:",

    /**
     *  Indicates an encoding discontinuity between the media segment that follows it and the one that preceded it.
     */
    DISCONTINUITY:"#EXT-X-DISCONTINUITY",

    /**
     *  Indicates that each media segment in the manifest describes a single I-frame.
     */
    I_FRAMES_ONLY:"#EXT-X-I-FRAMES-ONLY",

    /**
     *  Identifies a manifest file containing the I-frames of a multimedia presentation.  It stands alone, in that it does not apply to a particular URI in the manifest.
     *  Syntax:  #EXT-X-I-FRAME-STREAM-INF:<attribute-list>
     */
    I_FRAME_STREAM_INF:"#EXT-X-I-FRAME-STREAM-INF:",

    /**
     *  Indicates the compatibility version of the Playlist file.
     *  Syntax:  #EXT-X-VERSION:<n>
     */
    VERSION:"#EXT-X-VERSION:",

    /**
     *  Indicates the total duration as reported by Zencoder.
     *  Syntax:  #ZEN-TOTAL-DURATION:<n>
     */
    ZEN_TOTAL_DURATION: "#ZEN-TOTAL-DURATION:"

  };
})(this);

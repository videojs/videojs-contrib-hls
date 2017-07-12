{
  allowCache: true,
  discontinuityStarts: [],
  mediaGroups: {
    // TYPE
    AUDIO: {
      // GROUP-ID
      "audio": {
        // NAME
        "en": {
          language: 'en',
          autoselect: true,
          default: true,
          uri: "audio.m3u8"
        }
      }
    },
    VIDEO: {},
    "CLOSED-CAPTIONS": {},
    SUBTITLES: {}
  },
  playlists: [{
    attributes: {
      "PROGRAM-ID": 1,
      BANDWIDTH: 564300,
      CODECS: "mp4a.40.2,avc1.420015",
      AUDIO: 'audio'
    },
    timeline: 0,
    uri: "video.m3u8"
  }]
}

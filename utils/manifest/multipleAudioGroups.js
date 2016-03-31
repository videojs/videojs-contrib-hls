{
  allowCache: true,
  discontinuityStarts: [],
  mediaGroups: {
    AUDIO: {
      "audio-lo": {
        "English": {
          autoselect: true,
          default: true,
          language: "eng",
          uri: "englo/prog_index.m3u8"
        },
        "Français": {
          autoselect: true,
          default: false,
          language: "fre",
          uri: "frelo/prog_index.m3u8"
        },
        "Espanol": {
          autoselect: true,
          default: false,
          language: "sp",
          uri: "splo/prog_index.m3u8"
        }
      },
      "audio-hi": {
        "English": {
          autoselect: true,
          default: true,
          language: "eng",
          uri: "eng/prog_index.m3u8"
        },
        "Français": {
          autoselect: true,
          default: false,
          language: "fre",
          uri: "fre/prog_index.m3u8"
        },
        "Espanol": {
          autoselect: true,
          default: false,
          language: "sp",
          uri: "sp/prog_index.m3u8"
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
      BANDWIDTH: 195023,
      CODECS: "mp4a.40.5",
      AUDIO: "audio-lo",
    },
    uri: "lo/prog_index.m3u8"
  }, {
    attributes: {
      "PROGRAM-ID": 1,
      BANDWIDTH: 260000,
      CODECS: "avc1.42e01e,mp4a.40.2",
      AUDIO: "audio-lo"
    },
    uri: "hi/prog_index.m3u8"
  }, {
    attributes: {
      "PROGRAM-ID": 1,
      BANDWIDTH: 591680,
      CODECS: "mp4a.40.2, avc1.64001e",
      AUDIO: "audio-hi"
    },
    uri: "lo/prog_index.m3u8"
  }, {
    attributes: {
      "PROGRAM-ID": 1,
      BANDWIDTH: 650000,
      CODECS: "avc1.42e01e,mp4a.40.2",
      AUDIO: "audio-hi"
    },
    uri: "hi/prog_index.m3u8"
  }]
}

(function(window) {
  var M3U8 = window.videojs.hls.M3U8;

  window.videojs.hls.M3U8Parser = function() {
    var
      self = this,
      tagTypes = window.videojs.hls.m3u8TagType,
      lines = [],
      data;

    self.getTagType = function(lineData) {
      for (var s in tagTypes) {
        if (lineData.indexOf(tagTypes[s]) === 0) {
          return tagTypes[s];
        }
      }
    };

    self.getTagValue = function(lineData) {
      for (var s in tagTypes) {
        if (lineData.indexOf(tagTypes[s]) === 0) {
          return lineData.substr(tagTypes[s].length);
        }
      }
    };

    self.parse = function(rawDataString) {
      if (!data) {
        data = new M3U8();
      }

      if (self.directory) {
        data.directory = self.directory;
      }

      if (rawDataString === undefined || rawDataString.length <= 0) {
        data.invalidReasons.push("Empty Manifest");
        return;
      }
      lines = rawDataString.split('\n');

      lines.forEach(function(value,index) {
        var segment, rendition, attributes;

        switch (self.getTagType(value)) {
        case tagTypes.EXTM3U:
          data.hasValidM3UTag = (index === 0);
          if (!data.hasValidM3UTag) {
            data.invalidReasons.push("Invalid EXTM3U Tag");
          }
          break;

        case tagTypes.DISCONTINUITY:
          break;

        case tagTypes.PLAYLIST_TYPE:
          if (self.getTagValue(value) === "VOD" ||
              self.getTagValue(value) === "EVENT") {
            data.playlistType = self.getTagValue(value);

          } else {
            data.invalidReasons.push("Invalid Playlist Type Value");
          }
          break;

        case tagTypes.EXTINF:
          segment = {
            url: "unknown",
            byterange: -1,
            targetDuration: data.targetDuration
          };

          if (self.getTagType(lines[index + 1]) === tagTypes.BYTERANGE) {
            segment.byterange = self.getTagValue(lines[index + 1]).split('@');
            segment.url = lines[index + 2];
          } else {
            segment.url = lines[index + 1];
          }

          if (segment.url.indexOf("http") === -1 && self.directory) {
            if (data.directory[data.directory.length-1] === segment.url[0] &&
                segment.url[0] === "/") {
              segment.url = segment.url.substr(1);
            }
            segment.url = self.directory + segment.url;
          }

          self.pushUniqueSegment(segment);
          break;

        case tagTypes.STREAM_INF:
          rendition = {};
          attributes = value.substr(tagTypes.STREAM_INF.length).split(',');

          attributes.forEach(function(attrValue) {
            if (isNaN(attrValue.split('=')[1])) {
              rendition[attrValue.split('=')[0].toLowerCase()] = attrValue.split('=')[1];

              if (rendition[attrValue.split('=')[0].toLowerCase()].split('x').length === 2) {
                rendition.resolution = {
                  width: parseInt(rendition[attrValue.split('=')[0].toLowerCase()].split('x')[0],10),
                  height: parseInt(rendition[attrValue.split('=')[0].toLowerCase()].split('x')[1],10)
                };
              }
            } else {
              rendition[attrValue.split('=')[0].toLowerCase()] = parseInt(attrValue.split('=')[1],10);
            }
          });

          if (self.getTagType(lines[index + 1]) === tagTypes.BYTERANGE) {
            rendition.byterange = self.getTagValue(lines[index + 1]).split('@');
            rendition.url = lines[index + 2];
          } else {
            rendition.url = lines[index + 1];
          }

          data.isPlaylist = true;
          data.playlistItems.push(rendition);
          break;

        case tagTypes.TARGETDURATION:
          data.targetDuration = parseFloat(self.getTagValue(value).split(',')[0]);
          break;

        case tagTypes.ZEN_TOTAL_DURATION:
          data.totalDuration = parseFloat(self.getTagValue(value));
          break;

        case tagTypes.VERSION:
          data.version = parseFloat(self.getTagValue(value));
          break;

        case tagTypes.MEDIA_SEQUENCE:
          data.mediaSequence = parseInt(self.getTagValue(value),10);
          break;

        case tagTypes.ALLOW_CACHE:
          if (self.getTagValue(value) === "YES" || self.getTagValue(value) === "NO") {
            data.allowCache = self.getTagValue(value);
          } else {
            data.invalidReasons.push("Invalid ALLOW_CACHE Value");
          }
          break;

        case tagTypes.ENDLIST:
          data.hasEndTag = true;
          break;
        }
      });

      return data;
    };

    self.pushUniqueSegment = function(segment) {
      // This is going to be horrible for performance as the mediaItems list grows
      if(segment.byterange === -1) {
        for (var i = 0, l=data.mediaItems.length; i < l; i++) {
          if (data.mediaItems[i].url === segment.url) {
            return;
          }
        }
      }
      console.log('adding new segment');
      data.mediaItems.push(segment);
    };
  };
})(this);

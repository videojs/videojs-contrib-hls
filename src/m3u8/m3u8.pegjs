/***** Start *****/
start
  = tags:lines+ .* {
      var obj = {},
          choices = {
            segments: 1,
            comments: 1,
            renditions: 1
          };
      tags.forEach(function(tag) {
        for (var p in tag) {
          if (p in choices) {
            if (Object.prototype.toString.call(obj[p]) === '[object Array]') {
              obj[p].push(tag[p]);
            } else {
              obj[p] = [tag[p]];
            }
          } else {
            obj[p] = tag[p];
          }
        }
      });
      return obj;
    }

lines
  = comment:comment _ { var obj = {}; obj["comments"] = comment; return obj; }
  / ! comment tag:tag _ { return tag; }

tag
  = & comment
  / tag:m3uTag _ { return tag; }
  / tag:extinfTag _ { return tag; }
  / tag:targetDurationTag _ { return tag; }
  / tag:mediaSequenceTag _ { return tag; }
  / tag:keyTag _ { return tag; }
  / tag:programDateTimeTag _ { return tag; }
  / tag:allowCacheTag _ { return tag; }
  / tag:playlistTypeTag _ { return tag; }
  / tag:endlistTag _ { return tag; }
  / tag:mediaTag _ { return tag; }
  / tag:streamInfTag _ { return tag; }
  / tag:discontinuityTag _ { return tag; }
  / tag:discontinuitySequenceTag _ { return tag; }
  / tag:iframesOnlyTag _ { return tag; }
  / tag:mapTag _ { return tag; }
  / tag:iframeStreamInf _ { return tag; }
  / tag:startTag _ { return tag; }
  / tag:versionTag _ { return tag; }

comment "comment"
  = & "#" ! "#EXT" text:text+ { return text.join(); }

/***** Tags *****/

m3uTag
  = tag:"#EXTM3U" { return {openTag: true}; }

extinfTag
  = tag:'#EXTINF' ":" duration:number "," optional:extinfOptionalParts _ url:mediaURL {
      return {segments: {
          byterange: optional.byteRange || -1,
          title: optional.title,
          targetDuration: duration,
          url: url
        }
      };
    }

byteRangeTag
  = tag:"#EXT-X-BYTERANGE" ":" length:int ("@" offset:int)? { return {length: length, offset: offset}; }

targetDurationTag
  = tag:"#EXT-X-TARGETDURATION" ":" seconds:int { return {targetDuration: seconds}; }

mediaSequenceTag
  = tag:'#EXT-X-MEDIA-SEQUENCE' ":" sequenceNumber:int { return {mediaSequence: sequenceNumber}; }

keyTag
  = tag:'#EXT-X-KEY' ":" attrs:keyAttributes { return {key: attrs}; }

programDateTimeTag
  = tag:'#EXT-X-PROGRAM-DATE-TIME' ":" date:date

allowCacheTag
  = tag:'#EXT-X-ALLOW-CACHE' ":" answer:answer { return {allowCache: answer}; }

playlistTypeTag
  = tag:'#EXT-X-PLAYLIST-TYPE' ":" type:playlistType { return {playlistType: type}; }

endlistTag
  = tag:'#EXT-X-ENDLIST' { return {closeTag: true}; }

mediaTag
  = tag:'#EXT-MEDIA' ":" attrs:mediaAttributes { return {media: attrs}; }

streamInfTag
  = tag:'#EXT-X-STREAM-INF' ":" attrs:streamInfAttrs _ url:mediaURL? {
      return {renditions: {
          attributes: attrs,
          url: url
        }
      };
    }

discontinuityTag
  = tag:'#EXT-X-DISCONTINUITY'

discontinuitySequenceTag
  = tag:'#EXT-X-DISCONTINUITY-SEQUENCE' ":" sequence:int { return {discontinuitySequence: sequence}; }

iframesOnlyTag
  = tag:'#EXT-X-I-FRAMES-ONLY'

mapTag
  = tag:'#EXT-X-MAP' ":" attrs:mapAttributes { return {map: attrs}; }

iframeStreamInf
  = tag:'#EXT-X-I-FRAME-STREAM-INF' ":" attrs:iframeStreamAttrs { return {iframeStream: attrs}; }

startTag
  = tag:'EXT-X-START' ":" attrs:startAttributes { return {start: attrs}; }

versionTag
  = tag:'#EXT-X-VERSION' ":" version:int { return {version: version}; }

/***** Helpers *****/

extinfOptionalParts
  = nonbreakingWhitespace title:text _ byteRange:byteRangeTag? { return {title: title, byteRange: byteRange} }
  / _ byteRange:byteRangeTag? { return {title: '', byteRange: byteRange}; }

mediaURL
  = & tag
  / ! tag file:[ -~]+ { return file.join(''); }

keyAttributes
  = (attr:keyAttribute rest:(attrSeparator streamInfAttrs)*) {
      return rest.reduce(function(prev, curr) {
        var p,
            currentItem = curr.pop();
        for (p in currentItem) {
          prev[p] = currentItem[p];
        };
        return prev;
      }, attr);
    }
  / attr:keyAttribute? { return [attr]; }

keyAttribute
  = "METHOD" "=" method:keyMethod { return {keyMethod: method}; }
  / "URI" "=" uri:quotedString { return {uri: uri}; }
  / "IV" "=" iv:hexint { return {IV: iv}; }
  / "KEYFORMAT" "=" keyFormat:quotedString { return {keyFormat: keyFormat}; }
  / "KEYFORMATVERSIONS" "=" keyFormatVersions:quotedString { return {keyFormatVersions: keyFormatVersions}; }

keyMethod
  = "NONE"
  / "AES-128"
  / "SAMPLE-AES"

mediaAttributes
  = (attr:mediaAttribute rest:(attrSeparator mediaAttribute)*) {
      return rest.reduce(function(prev, curr) {
        var p,
            currentItem = curr.pop();
        for (p in currentItem) {
          prev[p] = currentItem[p];
        };
        return prev;
      }, attr);
    }
  / attr:mediaAttribute? { return [attr] }

mediaAttribute
  = "TYPE" "=" type:mediaTypes { return {type: type}; }
  / "URI" "=" uri:quotedString { return {uri: uri}; }
  / "GROUP-ID" "=" groupId:quotedString { return {groupId: groupdId}; }
  / "LANGUAGE" "=" langauge:quotedString { return {language: language}; }
  / "ASSOC-LANGUAGE" "=" assocLanguage:quotedString { return {assocLanguage: assocLanguage}; }
  / "NAME" "=" name:quotedString { return {name: name}; }
  / "DEFAULT" "=" def:answer { return {defaultAnswer: def}; }
  / "AUTOSELECT" "=" autoselect:answer { return {autoselect: autoselect}; }
  / "FORCE" "=" force:answer { return {force: force}; }
  / "INSTREAM-ID" "=" instreamId:quotedString { return {instreamId: instreamId}; }
  / "CHARACTERISTICS" "=" characteristics:quotedString { return {characteristics: characteristics}; }

streamInfAttrs
  = (attr:streamInfAttr rest:(attrSeparator streamInfAttr)*) {
      return rest.reduce(function(prev, curr) {
        var p,
            currentItem = curr.pop();
        for (p in currentItem) {
          prev[p] = currentItem[p];
        };
        return prev;
      }, attr);
    }
  / attr:streamInfAttr?

streamInfAttr
  = streamInfSharedAttr
  / "AUDIO" "=" audio:quotedString { return {audio: audio}; }
  / "SUBTITLES" "=" subtitles:quotedString { return {video: video}; }
  / "CLOSED-CAPTIONS" "=" captions:"NONE" { return {closedCaptions: captions}; }
  / "CLOSED-CAPTIONS" "=" captions:quotedString { return {closedCaptions: captions}; }

streamInfSharedAttr
  = "PROGRAM-ID" "=" programId:int { return {programId: programId}; }
  / "BANDWIDTH" "=" bandwidth:int { return {bandwidth: bandwidth}; }
  / "CODECS" "=" codec:quotedString { return {codecs: codec}; }
  / "RESOLUTION" "=" resolution:resolution { return {resolution: resolution}; }
  / "VIDEO" "=" video:quotedString { return {video: video}; }

mapAttributes
  = (attr:mapAttribute rest:(attrSeparator mapAttribute)*) {
      return rest.reduce(function(prev, curr) {
        var p,
            currentItem = curr.pop();
        for (p in currentItem) {
          prev[p] = currentItem[p];
        };
        return prev;
      }, attr);
    }
  / attr:mapAttribute?

mapAttribute
  = "URI" "=" uri:quotedString { return {uri: uri}; }
  / "BYTERANGE" "=" byteRange:quotedString { return {byterange: byterange}; }

iframeStreamAttrs
  = (attr:iframeStreamAttr rest:(attrSeparator iframeStreamAttr)*) {
      return rest.reduce(function(prev, curr) {
        var p,
            currentItem = curr.pop();
        for (p in currentItem) {
          prev[p] = currentItem[p];
        };
        return prev;
      }, attr);
    }
  / attr:iframeStreamAttr?

iframeStreamAttr
  = streamInfSharedAttr
  / "URI" "=" uri:quotedString { return {uri: uri}; }

startAttributes
  = (attr:startAttribute rest:(attrSeparator startAttribute)*) {
      return rest.reduce(function(prev, curr) {
        var p,
            currentItem = curr.pop();
        for (p in currentItem) {
          prev[p] = currentItem[p];
        };
        return prev;
      }, attr);
    }
  / attr:startAttribute?

startAttribute
  = "TIME-OFFSET" "=" timeOffset:number { return {timeOffset: timeOffset}; }
  / "PRECISE" "=" precise:answer { return {precise: precise}; }

answer "answer"
  = "YES"
  / "NO"

mediaTypes
  = "AUDIO"
  / "VIDEO"
  / "SUBTITLES"
  / "CLOSED-CAPTIONS"

playlistType
  = "EVENT"
  / "VOD"

attrSeparator
  = "," nonbreakingWhitespace { return; }

/***** Date *****/

date "date"
  = year:year "-" month:month "-" day:day "T" time:time timezone:timezone

year "year"
  = digit digit digit digit

month "month"
  = [01] digit

day "day"
  = [0-3] digit

time "time"
  = [0-2] digit ":" [0-5] digit ":" [0-5] digit "." digit+
  / [0-2] digit ":" [0-5] digit ":" [0-5] digit
  / [0-2] digit ":" [0-5] digit

timezone "timezone"
  = [+-] [0-2] digit ":" [0-5] digit
  / "Z"

/***** Numbers *****/

number "number"
  = parts:(int frac) _ { return parseFloat(parts.join('')); }
  / parts:(int) _ { return parts; }

resolution
  = width:int "x" height:int { return {resolution: {width: width, height: height}}; }

int
  = first:digit19 rest:digits { return parseInt(first + rest.join(''), 10); }
  / digit:digit { return parseInt(digit, 10); }
  / neg:"-" first:digit19 rest:digits { return parseInt(neg + first + rest.join(''), 10); }
  / neg:"-" digit { return parseInt(neg + digit, 10); }

hexint
  = "0x" hexDigits:hexDigit+ { return '0x' + hexDigits.join(''); }
  / "0X" hexDigits:hexDigit+ { return '0x' + hexDigits.join(''); }

frac
  = dec:"." digits:digits { return dec + digits.join(''); }

digits
  = digit+

digit
  = [0-9]

digit19
  = [1-9]

hexDigit
  = [0-9a-fA-F]

/***** Text *****/

quotedString
  = '"' '"' _ { return ""; }
  / '"' chars:quotedChar+ '"' _ { return chars.join(''); }

quotedChar
  = [^\r\n"]
  / char:char

text "text"
  = text:char+ { return text.join(''); }

char "char"
  = [ -~]

_ "whitespace"
  = whitespace*

whitespace
  = [ \t\n\r]

nonbreakingWhitespace
  = [ \t]*

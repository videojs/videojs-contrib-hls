import Stream from '../stream';

// "forgiving" attribute list psuedo-grammar:
// attributes -> keyvalue (',' keyvalue)*
// keyvalue   -> key '=' value
// key        -> [^=]*
// value      -> '"' [^"]* '"' | [^,]*
const attributeSeparator = function() {
  let key = '[^=]*';
  let value = '"[^"]*"|[^,]*';
  let keyvalue = '(?:' + key + ')=(?:' + value + ')';

  return new RegExp('(?:^|,)(' + keyvalue + ')');
};

const parseAttributes = function(attributes) {
  // split the string using attributes as the separator
  let attrs = attributes.split(attributeSeparator());
  let i = attrs.length;
  let result = {};
  let attr;

  while (i--) {
    // filter out unmatched portions of the string
    if (attrs[i] === '') {
      continue;
    }

    // split the key and value
    attr = (/([^=]*)=(.*)/).exec(attrs[i]).slice(1);
    // trim whitespace and remove optional quotes around the value
    attr[0] = attr[0].replace(/^\s+|\s+$/g, '');
    attr[1] = attr[1].replace(/^\s+|\s+$/g, '');
    attr[1] = attr[1].replace(/^['"](.*)['"]$/g, '$1');
    result[attr[0]] = attr[1];
  }
  return result;
};

/**
 * A line-level M3U8 parser event stream. It expects to receive input one
 * line at a time and performs a context-free parse of its contents. A stream
 * interpretation of a manifest can be useful if the manifest is expected to
 * be too large to fit comfortably into memory or the entirety of the input
 * is not immediately available. Otherwise, it's probably much easier to work
 * with a regular `Parser` object.
 *
 * Produces `data` events with an object that captures the parser's
 * interpretation of the input. That object has a property `tag` that is one
 * of `uri`, `comment`, or `tag`. URIs only have a single additional
 * property, `line`, which captures the entirety of the input without
 * interpretation. Comments similarly have a single additional property
 * `text` which is the input without the leading `#`.
 *
 * Tags always have a property `tagType` which is the lower-cased version of
 * the M3U8 directive without the `#EXT` or `#EXT-X-` prefix. For instance,
 * `#EXT-X-MEDIA-SEQUENCE` becomes `media-sequence` when parsed. Unrecognized
 * tags are given the tag type `unknown` and a single additional property
 * `data` with the remainder of the input.
 */
export default class ParseStream extends Stream {
  constructor() {
    super();
  }

  /**
   * Parses an additional line of input.
   * @param line {string} a single line of an M3U8 file to parse
   */
  push(line) {
    let match;
    let event;

    // strip whitespace
    line = line.replace(/^[\u0000\s]+|[\u0000\s]+$/g, '');
    if (line.length === 0) {
      // ignore empty lines
      return;
    }

    // URIs
    if (line[0] !== '#') {
      this.trigger('data', {
        type: 'uri',
        uri: line
      });
      return;
    }

    // Comments
    if (line.indexOf('#EXT') !== 0) {
      this.trigger('data', {
        type: 'comment',
        text: line.slice(1)
      });
      return;
    }

    // strip off any carriage returns here so the regex matching
    // doesn't have to account for them.
    line = line.replace('\r', '');

    // Tags
    match = (/^#EXTM3U/).exec(line);
    if (match) {
      this.trigger('data', {
        type: 'tag',
        tagType: 'm3u'
      });
      return;
    }
    match = (/^#EXTINF:?([0-9\.]*)?,?(.*)?$/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'inf'
      };
      if (match[1]) {
        event.duration = parseFloat(match[1]);
      }
      if (match[2]) {
        event.title = match[2];
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-TARGETDURATION:?([0-9.]*)?/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'targetduration'
      };
      if (match[1]) {
        event.duration = parseInt(match[1], 10);
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#ZEN-TOTAL-DURATION:?([0-9.]*)?/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'totalduration'
      };
      if (match[1]) {
        event.duration = parseInt(match[1], 10);
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-VERSION:?([0-9.]*)?/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'version'
      };
      if (match[1]) {
        event.version = parseInt(match[1], 10);
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-MEDIA-SEQUENCE:?(\-?[0-9.]*)?/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'media-sequence'
      };
      if (match[1]) {
        event.number = parseInt(match[1], 10);
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-DISCONTINUITY-SEQUENCE:?(\-?[0-9.]*)?/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'discontinuity-sequence'
      };
      if (match[1]) {
        event.number = parseInt(match[1], 10);
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-PLAYLIST-TYPE:?(.*)?$/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'playlist-type'
      };
      if (match[1]) {
        event.playlistType = match[1];
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-BYTERANGE:?([0-9.]*)?@?([0-9.]*)?/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'byterange'
      };
      if (match[1]) {
        event.length = parseInt(match[1], 10);
      }
      if (match[2]) {
        event.offset = parseInt(match[2], 10);
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-ALLOW-CACHE:?(YES|NO)?/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'allow-cache'
      };
      if (match[1]) {
        event.allowed = !(/NO/).test(match[1]);
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-STREAM-INF:?(.*)$/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'stream-inf'
      };
      if (match[1]) {
        event.attributes = parseAttributes(match[1]);

        if (event.attributes.RESOLUTION) {
          let split = event.attributes.RESOLUTION.split('x');
          let resolution = {};

          if (split[0]) {
            resolution.width = parseInt(split[0], 10);
          }
          if (split[1]) {
            resolution.height = parseInt(split[1], 10);
          }
          event.attributes.RESOLUTION = resolution;
        }
        if (event.attributes.BANDWIDTH) {
          event.attributes.BANDWIDTH = parseInt(event.attributes.BANDWIDTH, 10);
        }
        if (event.attributes['PROGRAM-ID']) {
          event.attributes['PROGRAM-ID'] = parseInt(event.attributes['PROGRAM-ID'], 10);
        }
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-MEDIA:?(.*)$/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'media'
      };
      if (match[1]) {
        event.attributes = parseAttributes(match[1]);
      }
      this.trigger('data', event);
      return;
    }
    match = (/^#EXT-X-ENDLIST/).exec(line);
    if (match) {
      this.trigger('data', {
        type: 'tag',
        tagType: 'endlist'
      });
      return;
    }
    match = (/^#EXT-X-DISCONTINUITY/).exec(line);
    if (match) {
      this.trigger('data', {
        type: 'tag',
        tagType: 'discontinuity'
      });
      return;
    }
    match = (/^#EXT-X-KEY:?(.*)$/).exec(line);
    if (match) {
      event = {
        type: 'tag',
        tagType: 'key'
      };
      if (match[1]) {
        event.attributes = parseAttributes(match[1]);
        // parse the IV string into a Uint32Array
        if (event.attributes.IV) {
          if (event.attributes.IV.substring(0, 2) === '0x') {
            event.attributes.IV = event.attributes.IV.substring(2);
          }

          event.attributes.IV = event.attributes.IV.match(/.{8}/g);
          event.attributes.IV[0] = parseInt(event.attributes.IV[0], 16);
          event.attributes.IV[1] = parseInt(event.attributes.IV[1], 16);
          event.attributes.IV[2] = parseInt(event.attributes.IV[2], 16);
          event.attributes.IV[3] = parseInt(event.attributes.IV[3], 16);
          event.attributes.IV = new Uint32Array(event.attributes.IV);
        }
      }
      this.trigger('data', event);
      return;
    }

    // unknown tag type
    this.trigger('data', {
      type: 'tag',
      data: line.slice(4, line.length)
    });
  }
}

/**
 * A parser for M3U8 files. The current interpretation of the input is
 * exposed as a property `manifest` on parser objects. It's just two lines to
 * create and parse a manifest once you have the contents available as a string:
 *
 * ```js
 * var parser = new videojs.m3u8.Parser();
 * parser.push(xhr.responseText);
 * ```
 *
 * New input can later be applied to update the manifest object by calling
 * `push` again.
 *
 * The parser attempts to create a usable manifest object even if the
 * underlying input is somewhat nonsensical. It emits `info` and `warning`
 * events during the parse if it encounters input that seems invalid or
 * requires some property of the manifest object to be defaulted.
 */
import Stream from '../stream' ;
import LineStream from './line-stream';
import ParseStream from './parse-stream';
import {mergeOptions} from 'video.js';

export default class Parser extends Stream {
  constructor() {
    super();
    this.lineStream = new LineStream();
    this.parseStream = new ParseStream();
    this.lineStream.pipe(this.parseStream);
    this.uris = [];
    this.currentUri = {};
    this.key = null;

    // the manifest is empty until the parse stream begins delivering data
    this.manifest = {
      allowCache: true,
      discontinuityStarts: []
    };

    // update the manifest with the m3u8 entry from the parse stream
    this.parseStream.on('data', (entry) => {
      switch (entry.type) {
      case 'tag':
        this.tag_(entry);
        break;
      case 'uri':
        this.uri_(entry);
        break;
      case 'comment':
        this.comment_(entry);
        break;
      default:
        break;
      }
    });
  }

  tag_(entry) {
    // switch based on the tag type
    switch (entry.tagType) {
    case 'allow-cache':
      this.manifest.allowCache = entry.allowed;
      if (!('allowed' in entry)) {
        this.trigger('info', {
          message: 'defaulting allowCache to YES'
        });
        this.manifest.allowCache = true;
      }
      break;
    case 'byterange':
      let byterange = {};

      if ('length' in entry) {
        this.currentUri.byterange = byterange;
        byterange.length = entry.length;

        if (!('offset' in entry)) {
          this.trigger('info', {
            message: 'defaulting offset to zero'
          });
          entry.offset = 0;
        }
      }
      if ('offset' in entry) {
        this.currentUri.byterange = byterange;
        byterange.offset = entry.offset;
      }
      break;
    case 'endlist':
      this.manifest.endList = true;
      break;
    case 'inf':
      if (!('mediaSequence' in this.manifest)) {
        this.manifest.mediaSequence = 0;
        this.trigger('info', {
          message: 'defaulting media sequence to zero'
        });
      }
      if (!('discontinuitySequence' in this.manifest)) {
        this.manifest.discontinuitySequence = 0;
        this.trigger('info', {
          message: 'defaulting discontinuity sequence to zero'
        });
      }
      if (entry.duration >= 0) {
        this.currentUri.duration = entry.duration;
      }
      this.manifest.segments = this.uris;
      break;
    case 'key':
      if (!entry.attributes) {
        this.trigger('warn', {
          message: 'ignoring key declaration without attribute list'
        });
        return;
      }
      // clear the active encryption key
      if (entry.attributes.METHOD === 'NONE') {
        this.key = null;
        return;
      }
      if (!entry.attributes.URI) {
        this.trigger('warn', {
          message: 'ignoring key declaration without URI'
        });
        return;
      }
      if (!entry.attributes.METHOD) {
        this.trigger('warn', {
          message: 'defaulting key method to AES-128'
        });
      }

      // setup an encryption key for upcoming segments
      this.key = {
        method: entry.attributes.METHOD || 'AES-128',
        uri: entry.attributes.URI
      };

      if (typeof entry.attributes.IV !== 'undefined') {
        this.key.iv = entry.attributes.IV;
      }
      break;
    case 'media-sequence':
      if (!isFinite(entry.number)) {
        this.trigger('warn', {
          message: 'ignoring invalid media sequence: ' + entry.number
        });
        return;
      }
      this.manifest.mediaSequence = entry.number;
      break;
    case 'discontinuity-sequence':
      if (!isFinite(entry.number)) {
        this.trigger('warn', {
          message: 'ignoring invalid discontinuity sequence: ' + entry.number
        });
        return;
      }
      this.manifest.discontinuitySequence = entry.number;
      break;
    case 'playlist-type':
      if (!(/VOD|EVENT/).test(entry.playlistType)) {
        this.trigger('warn', {
          message: 'ignoring unknown playlist type: ' + entry.playlist
        });
        return;
      }
      this.manifest.playlistType = entry.playlistType;
      break;
    case 'stream-inf':
      this.manifest.playlists = this.uris;

      if (!entry.attributes) {
        this.trigger('warn', {
          message: 'ignoring empty stream-inf attributes'
        });
        return;
      }
      if (!this.currentUri.attributes) {
        this.currentUri.attributes = {};
      }
      this.currentUri.attributes = mergeOptions(this.currentUri.attributes,
                                                entry.attributes);
      break;
    case 'discontinuity':
      this.currentUri.discontinuity = true;
      this.manifest.discontinuityStarts.push(this.uris.length);
      break;
    case 'targetduration':
      if (!isFinite(entry.duration) || entry.duration < 0) {
        this.trigger('warn', {
          message: 'ignoring invalid target duration: ' + entry.duration
        });
        return;
      }
      this.manifest.targetDuration = entry.duration;
      break;
    case 'totalduration':
      if (!isFinite(entry.duration) || entry.duration < 0) {
        this.trigger('warn', {
          message: 'ignoring invalid total duration: ' + entry.duration
        });
        return;
      }
      this.manifest.totalDuration = entry.duration;
      break;
    default:
      break;
    }
  }

  uri_(entry) {
    this.currentUri.uri = entry.uri;
    this.uris.push(this.currentUri);

    // if no explicit duration was declared, use the target duration
    if (this.manifest.targetDuration &&
        !('duration' in this.currentUri)) {
      this.trigger('warn', {
        message: 'defaulting segment duration to the target duration'
      });
      this.currentUri.duration = this.manifest.targetDuration;
    }
    // annotate with encryption information, if necessary
    if (this.key) {
      this.currentUri.key = this.key;
    }

    // prepare for the next URI
    this.currentUri = {};
  }

  comment_(entry) {
    // comments are not important for playback
  }

  /**
   * Parse the input string and update the manifest object.
   * @param chunk {string} a potentially incomplete portion of the manifest
   */
  push(chunk) {
    this.lineStream.push(chunk);
  }

  /**
   * Flush any remaining input. This can be handy if the last line of an M3U8
   * manifest did not contain a trailing newline but the file has been
   * completely received.
   */
  end() {
    // flush any buffered input
    this.lineStream.push('\n');
  }

}


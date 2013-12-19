(function(parseInt, undefined) {
  var Stream, Tokenizer, Parser;

  Stream = function() {
    var listeners = {};
    this.on = function(type, listener) {
      if (!listeners[type]) {
        listeners[type] = [];
      }
      listeners[type].push(listener);
    };
    this.off = function(type, listener) {
      var index;
      if (!listeners[type]) {
        return false;
      }
      index = listeners[type].indexOf(listener);
      listeners[type].splice(index, 1);
      return index > -1;
    };
    this.trigger = function(type) {
      var callbacks, i, length, args;
      callbacks = listeners[type];
      if (!callbacks) {
        return;
      }
      args = Array.prototype.slice.call(arguments, 1);
      length = callbacks.length;
      for (i = 0; i < length; ++i) {
        callbacks[i].apply(this, args);
      }
    };
  };
  Stream.prototype.pipe = function(destination) {
    this.on('data', function(data) {
      destination.push(data);
    });
  };

  Tokenizer = function() {
    var
    buffer = '',
    tokenizer;

    this.push = function(data) {
      var nextNewline;

      buffer += data;
      nextNewline = buffer.indexOf('\n');

      for (; nextNewline > -1; nextNewline = buffer.indexOf('\n')) {
        this.trigger('data', buffer.substring(0, nextNewline));
        buffer = buffer.substring(nextNewline + 1);
      }
    };
  };
  Tokenizer.prototype = new Stream();

  Parser = function() {};
  Parser.prototype = new Stream();
  Parser.prototype.push = function(line) {
    var match, event;
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

    // Tags
    match = /^#EXTM3U/.exec(line);
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
        event.duration = parseInt(match[1], 10);
      }
      if (match[2]) {
        event.title = match[2];
      }
      this.trigger('data', event);
      return;
    }

    // unknown tag type
    this.trigger('data', {
      type: 'tag',
      data: line.slice(4, line.length)
    });
  };

  window.videojs.m3u8 = {
    Tokenizer: Tokenizer,
    Parser: Parser
  };
})(window.parseInt);

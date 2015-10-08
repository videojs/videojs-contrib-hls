(function(window) {
  var textRange = function(range, i) {
    return range.start(i) + '-' + range.end(i);
  };
  var module = {
    hexDump: function(data) {
      var
        bytes = Array.prototype.slice.call(data),
        step = 16,
        formatHexString = function(e, i) {
          var value = e.toString(16);
          return "00".substring(0, 2 - value.length) + value + (i % 2 ? ' ' : '');
        },
        formatAsciiString = function(e) {
          if (e >= 0x20 && e < 0x7e) {
            return String.fromCharCode(e);
          }
          return '.';
        },
        result = '',
        hex,
        ascii;
      for (var j = 0; j < bytes.length / step; j++) {
        hex = bytes.slice(j * step, j * step + step).map(formatHexString).join('');
        ascii = bytes.slice(j * step, j * step + step).map(formatAsciiString).join('');
        result += hex + ' ' + ascii + '\n';
      }
      return result;
    },
    tagDump: function(tag) {
      return module.hexDump(tag.bytes);
    },
    textRanges: function(ranges) {
      var result = '', i;
      for (i = 0; i < ranges.length; i++) {
        result += textRange(ranges, i) + ' ';
      }
      return result;
    }
  };

  window.videojs.Hls.utils = module;
})(this);

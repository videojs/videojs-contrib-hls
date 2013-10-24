(function(window) {
  var module = {
    hexDump: function(data) {
      var
        bytes = Array.prototype.slice.call(data),
        step = 16,
        formatHexString = function(e) {
          var value = e.toString(16);
          return "00".substring(0, 2 - value.length) + value;
        },
        formatAsciiString = function(e) {
          if (e > 32 && e < 125) {
            return String.fromCharCode(e);
          }
          return '.';
        },
        hex,
        ascii;
      for (var j = 0; j < bytes.length / step; j++) {
        hex = bytes.slice(j * step, j * step + step).map(formatHexString).join(' ');
        ascii = bytes.slice(j * step, j * step + step).map(formatAsciiString).join('');
        return hex + '  ' + ascii;
      }
    },
    tagDump: function(tag) {
      return module.hexDump(tag.bytes);
    }
  };

  window.videojs.hls.utils = module;
})(this);

const textRange = function(range, i) {
  return range.start(i) + '-' + range.end(i);
};

const formatHexString = function(e, i) {
  let value = e.toString(16);

  return '00'.substring(0, 2 - value.length) + value + (i % 2 ? ' ' : '');
};
const formatAsciiString = function(e) {
  if (e >= 0x20 && e < 0x7e) {
    return String.fromCharCode(e);
  }
  return '.';
};

const utils = {
  hexDump(data) {
    let bytes = Array.prototype.slice.call(data);
    let step = 16;
    let result = '';
    let hex;
    let ascii;

    for (let j = 0; j < bytes.length / step; j++) {
      hex = bytes.slice(j * step, j * step + step).map(formatHexString).join('');
      ascii = bytes.slice(j * step, j * step + step).map(formatAsciiString).join('');
      result += hex + ' ' + ascii + '\n';
    }
    return result;
  },
  tagDump(tag) {
    return utils.hexDump(tag.bytes);
  },
  textRanges(ranges) {
    let result = '';
    let i;

    for (i = 0; i < ranges.length; i++) {
      result += textRange(ranges, i) + ' ';
    }
    return result;
  }
};

export default utils;

/**
 * @file bin-utils.js
 */

/**
 * convert a TimeRange to text
 *
 * @param {TimeRange} range the timerange to use for conversion
 * @param {Number} i the iterator on the range to convert
 */
const textRange = function(range, i) {
  return range.start(i) + '-' + range.end(i);
};

/**
 * format a number as hex string
 *
 * @param {Number} e The number
 * @param {Number} i the iterator
 */
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

/**
 * Creates an object for sending to a web worker modifying properties that are TypedArrays
 * into a new object with seperated properties for the buffer, byteOffset, and byteLength.
 *
 * @param {Object} message
 *        Object of properties and values to send to the web worker
 * @return {Object}
 *         Modified message with TypedArray values expanded
 * @function createTransferableMessage
 */
const createTransferableMessage = function(message) {
  const transferable = {};

  Object.keys(message).forEach((key) => {
    const value = message[key];

    if (ArrayBuffer.isView(value)) {
      transferable[key] = {
        bytes: value.buffer,
        byteOffset: value.byteOffset,
        byteLength: value.byteLength
      };
    } else {
      transferable[key] = value;
    }
  });

  return transferable;
};

/**
 * Returns a unique string identifier for a media initialization
 * segment.
 */
const initSegmentId = function(initSegment) {
  let byterange = initSegment.byterange || {
    length: Infinity,
    offset: 0
  };

  return [
    byterange.length, byterange.offset, initSegment.resolvedUri
  ].join(',');
};

/**
 * utils to help dump binary data to the console
 */
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
  },
  createTransferableMessage,
  initSegmentId
};

export default utils;

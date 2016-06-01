import Ranges from '../src/ranges';
import {createTimeRanges} from 'video.js';
import QUnit from 'qunit';

QUnit.module('TimeRanges Utilities');

QUnit.test('finds the overlapping time range', function() {
  let range = Ranges.findRange(createTimeRanges([[0, 5], [6, 12]]), 3);

  QUnit.equal(range.length, 1, 'found one range');
  QUnit.equal(range.end(0), 5, 'inside the first buffered region');

  range = Ranges.findRange(createTimeRanges([[0, 5], [6, 12]]), 6);
  QUnit.equal(range.length, 1, 'found one range');
  QUnit.equal(range.end(0), 12, 'inside the second buffered region');
});

QUnit.module('Buffer Inpsection');

QUnit.test('detects time range end-point changed by updates', function() {
  let edge;

  // Single-range changes
  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 10]]),
                                              createTimeRanges([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'detected a forward addition');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[5, 10]]),
                                              createTimeRanges([[0, 10]]));
  QUnit.strictEqual(edge, null, 'ignores backward addition');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[5, 10]]),
                                              createTimeRanges([[0, 11]]));
  QUnit.strictEqual(edge, 11,
                    'detected a forward addition & ignores a backward addition');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 10]]),
                                              createTimeRanges([[0, 9]]));
  QUnit.strictEqual(edge, null,
                    'ignores a backwards addition resulting from a shrinking range');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 10]]),
                                              createTimeRanges([[2, 7]]));
  QUnit.strictEqual(edge, null,
                    'ignores a forward & backwards addition resulting from a shrinking ' +
                    'range');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[2, 10]]),
                                              createTimeRanges([[0, 7]]));
  QUnit.strictEqual(
    edge,
    null,
    'ignores a forward & backwards addition resulting from a range shifted backward'
  );

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[2, 10]]),
                                              createTimeRanges([[5, 15]]));
  QUnit.strictEqual(edge, 15,
                    'detected a forwards addition resulting from a range shifted foward');

  // Multiple-range changes
  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 10]]),
                                              createTimeRanges([[0, 11], [12, 15]]));
  QUnit.strictEqual(edge, null, 'ignores multiple new forward additions');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 10], [20, 40]]),
                                              createTimeRanges([[20, 50]]));
  QUnit.strictEqual(edge, 50, 'detected a forward addition & ignores range removal');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 10], [20, 40]]),
                                              createTimeRanges([[0, 50]]));
  QUnit.strictEqual(edge, 50, 'detected a forward addition & ignores merges');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 10], [20, 40]]),
                                              createTimeRanges([[0, 40]]));
  QUnit.strictEqual(edge, null, 'ignores merges');

  // Empty input
  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges(),
                                              createTimeRanges([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'handle an empty original TimeRanges object');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 11]]),
                                              createTimeRanges());
  QUnit.strictEqual(edge, null, 'handle an empty update TimeRanges object');

  // Null input
  edge = Ranges.findSoleUncommonTimeRangesEnd(null, createTimeRanges([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'treat null original buffer as an empty TimeRanges object');

  edge = Ranges.findSoleUncommonTimeRangesEnd(createTimeRanges([[0, 11]]), null);
  QUnit.strictEqual(edge, null, 'treat null update buffer as an empty TimeRanges object');
});

QUnit.module('Segment Percent Buffered Calculations');

QUnit.test('calculates the percent buffered for segments in the simple case', function() {
  let segmentStart = 10;
  let segmentDuration = 10;
  let currentTime = 0;
  let buffered = createTimeRanges([[15, 19]]);
  let percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered);

  QUnit.equal(percentBuffered, 40, 'calculated the buffered amount correctly');
});

QUnit.test('consider the buffer before currentTime to be filled if the ' +
           'segement begins at or before the currentTime', function() {
  let segmentStart = 10;
  let segmentDuration = 10;
  let currentTime = 15;
  let buffered = createTimeRanges([[15, 19]]);
  let percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered);

  QUnit.equal(percentBuffered, 90, 'calculated the buffered amount correctly');
});

QUnit.test('does not consider the buffer before currentTime as filled if the segment ' +
           'begins after the currentTime', function() {
  let segmentStart = 10;
  let segmentDuration = 10;
  let currentTime = 18;
  let buffered = createTimeRanges([[19, 30]]);
  let percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered);

  QUnit.equal(percentBuffered, 10, 'calculated the buffered amount correctly');
});

QUnit.test('calculates the percent buffered for segments with multiple buffered ' +
           'regions', function() {
  let segmentStart = 10;
  let segmentDuration = 10;
  let currentTime = 0;
  let buffered = createTimeRanges([[0, 11], [12, 19]]);
  let percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered);

  QUnit.equal(percentBuffered, 80, 'calculated the buffered amount correctly');
});

QUnit.test('calculates the percent buffered for segments with multiple buffered ' +
           'regions taking into account currentTime', function() {
  let segmentStart = 10;
  let segmentDuration = 10;
  let currentTime = 12;
  let buffered = createTimeRanges([[0, 11], [12, 19]]);
  let percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered);

  QUnit.equal(percentBuffered, 90, 'calculated the buffered amount correctly');
});

QUnit.test('calculates the percent buffered as 0 for zero-length segments', function() {
  let segmentStart = 10;
  let segmentDuration = 0;
  let currentTime = 0;
  let buffered = createTimeRanges([[0, 19]]);
  let percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered);

  QUnit.equal(percentBuffered, 0, 'calculated the buffered amount correctly');
});

QUnit.test('calculates the percent buffered as 0 for segments that do not overlap ' +
           'buffered regions taking into account currentTime', function() {
  let segmentStart = 10;
  let segmentDuration = 10;
  let currentTime = 19;
  let buffered = createTimeRanges([[20, 30]]);
  let percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered);

  QUnit.equal(percentBuffered, 0, 'calculated the buffered amount correctly');
});

QUnit.test('calculates the percent buffered for segments ' +
           'that end before currentTime', function() {
  let segmentStart = 10;
  let segmentDuration = 10;
  let currentTime = 19.6;
  let buffered = createTimeRanges([[0, 19.5]]);
  let percentBuffered = Ranges.getSegmentBufferedPercent(
    segmentStart,
    segmentDuration,
    currentTime,
    buffered);

  QUnit.equal(percentBuffered, 95, 'calculated the buffered amount correctly');
});

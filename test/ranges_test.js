/* Tests for the playlist utilities */
(function(window, videojs) {
  'use strict';
  var Ranges = videojs.Hls.Ranges, createTimeRanges = videojs.createTimeRanges;

  module('TimeRanges Utilities');

  test('finds the overlapping time range', function() {
    var range;
    range = Ranges.findRange_(createTimeRanges([[0, 5], [6, 12]]), 3);
    equal(range.length, 1, 'found one range');
    equal(range.end(0), 5, 'inside the first buffered region');

    range = Ranges.findRange_(createTimeRanges([[0, 5], [6, 12]]), 6);
    equal(range.length, 1, 'found one range');
    equal(range.end(0), 12, 'inside the second buffered region');
  });

  module('Buffer Inpsection');

  test('detects time range end-point changed by updates', function() {
    var edge;

    // Single-range changes
    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10]]),
                                                 createTimeRanges([[0, 11]]));
    strictEqual(edge, 11, 'detected a forward addition');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[5, 10]]),
                                                 createTimeRanges([[0, 10]]));
    strictEqual(edge, null, 'ignores backward addition');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[5, 10]]),
                                                 createTimeRanges([[0, 11]]));
    strictEqual(edge, 11, 'detected a forward addition & ignores a backward addition');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10]]),
                                                 createTimeRanges([[0, 9]]));
    strictEqual(edge, null, 'ignores a backwards addition resulting from a shrinking range');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10]]),
                                                 createTimeRanges([[2, 7]]));
    strictEqual(edge, null, 'ignores a forward & backwards addition resulting from a shrinking range');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[2, 10]]),
                                                 createTimeRanges([[0, 7]]));
    strictEqual(edge, null, 'ignores a forward & backwards addition resulting from a range shifted backward');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[2, 10]]),
                                                 createTimeRanges([[5, 15]]));
    strictEqual(edge, 15, 'detected a forwards addition resulting from a range shifted foward');

    // Multiple-range changes
    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10]]),
                                                 createTimeRanges([[0, 11], [12, 15]]));
    strictEqual(edge, null, 'ignores multiple new forward additions');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10], [20, 40]]),
                                                 createTimeRanges([[20, 50]]));
    strictEqual(edge, 50, 'detected a forward addition & ignores range removal');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10], [20, 40]]),
                                                 createTimeRanges([[0, 50]]));
    strictEqual(edge, 50, 'detected a forward addition & ignores merges');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10], [20, 40]]),
                                                 createTimeRanges([[0, 40]]));
    strictEqual(edge, null, 'ignores merges');

    // Empty input
    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges(),
                                                 createTimeRanges([[0, 11]]));
    strictEqual(edge, 11, 'handle an empty original TimeRanges object');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 11]]),
                                                 createTimeRanges());
    strictEqual(edge, null, 'handle an empty update TimeRanges object');

    // Null input
    edge = Ranges.findSoleUncommonTimeRangesEnd_(null,
                                                 createTimeRanges([[0, 11]]));
    strictEqual(edge, 11, 'treat null original buffer as an empty TimeRanges object');

    edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 11]]),
                                                 null);
    strictEqual(edge, null, 'treat null update buffer as an empty TimeRanges object');
  });


})(window, window.videojs);

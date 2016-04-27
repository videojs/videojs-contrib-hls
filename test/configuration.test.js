import {Hls} from '../src/videojs-contrib-hls';
import SegmentLoader from '../src/segment-loader';
import QUnit from 'qunit';

QUnit.module('Configuration - GOAL_BUFFER_LENGTH', {
  beforeEach() {
    this.oldSegmentLoader = SegmentLoader.GOAL_BUFFER_LENGTH;
    this.oldHls = Hls.GOAL_BUFFER_LENGTH;
  },
  afterEach() {
    SegmentLoader.GOAL_BUFFER_LENGTH = this.oldSegmentLoader;
    Hls.GOAL_BUFFER_LENGTH = this.oldHls;
  }
});

QUnit.test('starts at default', function() {
  QUnit.equal(Hls.GOAL_BUFFER_LENGTH, 30, 'default value');
  QUnit.equal(SegmentLoader.GOAL_BUFFER_LENGTH, 30, 'default value');
});

QUnit.test('HLS changes, change SegmentLoader', function() {
  Hls.GOAL_BUFFER_LENGTH = 10;
  QUnit.equal(Hls.GOAL_BUFFER_LENGTH, 10, 'value is 10');
  QUnit.equal(SegmentLoader.GOAL_BUFFER_LENGTH, 10, 'value is 10');
});

QUnit.test('SegmentLoader changes, change Hls', function() {
  SegmentLoader.GOAL_BUFFER_LENGTH = 15;
  QUnit.equal(Hls.GOAL_BUFFER_LENGTH, 15, 'value is 15');
  QUnit.equal(SegmentLoader.GOAL_BUFFER_LENGTH, 15, 'value is 15');
});

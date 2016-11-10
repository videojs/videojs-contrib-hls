import QUnit from 'qunit';
import videojs from 'video.js';
import sinon from 'sinon';
import reloadSourceOnError from '../src/reload-source-on-error';

QUnit.module('ReloadSourceOnError', {
  beforeEach() {
    this.clock = sinon.useFakeTimers();

    // setup a player
    this.player = new videojs.EventTarget();
    this.player.currentValues = {
      currentTime: 10,
      duration: 12
    };

    this.player.currentSource = () => {
      return {
        src: 'thisisasource.m3u8',
        type: 'doesn\'t/matter'
      };
    };

    this.player.duration = () => {
      return this.player.currentValues.duration;
    };

    this.player.src = (source) => {
      this.player.currentValues.currentTime = 0;
      this.player.src.calledWith.push(source);
    };
    this.player.src.calledWith = [];

    this.player.currentTime = (time) => {
      if (time) {
        this.player.currentTime.calledWith.push(time);
        this.player.currentValues.currentTime = time;
      }
      return this.player.currentValues.currentTime;
    };
    this.player.currentTime.calledWith = [];

    this.player.play = () => {
      this.player.play.called++;
    };
    this.player.play.called = 0;

    reloadSourceOnError.call(this.player);
    this.clock.tick(60 * 1000);
  },

  afterEach() {
    this.clock.restore();
  }
});

QUnit.test('triggers on player error', function() {
  this.player.trigger('error', -2);

  QUnit.equal(this.player.src.calledWith.length, 1, 'player.src was called');
  QUnit.deepEqual(this.player.src.calledWith[0], this.player.currentSource(), 'player.src was called with player.currentSource');
});

QUnit.test('seeks to currentTime in VOD', function() {
  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  QUnit.equal(this.player.currentTime.calledWith.length, 1, 'player.currentTime was called');
  QUnit.deepEqual(this.player.currentTime.calledWith[0], 10, 'player.currentTime was called with the right value');
});

QUnit.test('doesn\'t seek to currentTime in live', function() {
  this.player.currentValues.duration = Infinity;

  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  QUnit.equal(this.player.currentTime.calledWith.length, 0, 'player.currentTime was not called');
  QUnit.deepEqual(this.player.currentTime(), 0, 'player.currentTime is still zero');
});

QUnit.test('only allows a retry once every 30 seconds', function() {
  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  QUnit.equal(this.player.src.calledWith.length, 1, 'player.src was called once');

  // Advance 60 seconds
  this.clock.tick(60 * 1000);
  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  QUnit.equal(this.player.src.calledWith.length, 2, 'player.src was called twice');

  // Advance 29 seconds
  this.clock.tick(29 * 1000);
  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  QUnit.equal(this.player.src.calledWith.length, 2, 'player.src was called twice');
});

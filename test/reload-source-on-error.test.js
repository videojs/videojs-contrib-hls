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

    this.player.ready = (callback) => {
      callback.call(this.player);
    };

    this.tech = {
      currentSource_: {
        src: 'thisisasource.m3u8',
        type: 'doesn\'t/matter'
      }
    };

    this.player.tech = () => {
      return this.tech;
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

    this.player.reloadSourceOnError = reloadSourceOnError;
    this.clock.tick(60 * 1000);

    this.oldLog = videojs.log.error;
    this.errors = [];

    videojs.log.error = (...args) => {
      this.errors.push(...args);
    };
  },

  afterEach() {
    this.clock.restore();
    videojs.log.error = this.oldLog;
  }
});

QUnit.test('triggers on player error', function(assert) {
  this.player.reloadSourceOnError();
  this.player.trigger('error', -2);

  assert.equal(this.player.src.calledWith.length, 1, 'player.src was only called once');
  assert.deepEqual(this.player.src.calledWith[0],
                   this.tech.currentSource_,
                   'player.src was called with player.currentSource');
});

QUnit.test('seeks to currentTime in VOD', function(assert) {
  this.player.reloadSourceOnError();
  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  assert.equal(this.player.currentTime.calledWith.length,
               1,
               'player.currentTime was only called once');
  assert.deepEqual(this.player.currentTime.calledWith[0],
                   10,
                   'player.currentTime was called with the right value');
});

QUnit.test('doesn\'t seek to currentTime in live', function(assert) {
  this.player.reloadSourceOnError();
  this.player.currentValues.duration = Infinity;

  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  assert.equal(this.player.currentTime.calledWith.length,
               0,
               'player.currentTime was not called');
  assert.deepEqual(this.player.currentTime(), 0, 'player.currentTime is still zero');
});

QUnit.test('by default, only allows a retry once every 30 seconds', function(assert) {
  let hlsErrorReloadInitializedEvents = 0;
  let hlsErrorReloadEvents = 0;
  let hlsErrorReloadCanceledEvents = 0;

  this.player.on('usage', (event) => {
    if (event.name === 'hls-error-reload-initialized') {
      hlsErrorReloadInitializedEvents++;
    }
  });

  this.player.on('usage', (event) => {
    if (event.name === 'hls-error-reload') {
      hlsErrorReloadEvents++;
    }
  });

  this.player.on('usage', (event) => {
    if (event.name === 'hls-error-reload-canceled') {
      hlsErrorReloadCanceledEvents++;
    }
  });

  assert.equal(hlsErrorReloadInitializedEvents, 0, 'the plugin has not been initialized');
  assert.equal(hlsErrorReloadEvents, 0, 'no source was set');
  assert.equal(hlsErrorReloadCanceledEvents, 0,
    'reload canceled event has not been triggered');

  this.player.reloadSourceOnError();
  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  assert.equal(hlsErrorReloadInitializedEvents, 1, 'the plugin has been initialized');
  assert.equal(hlsErrorReloadEvents, 1, 'src was set after an error caused the reload');
  assert.equal(this.player.src.calledWith.length, 1, 'player.src was only called once');

  // Advance 59 seconds
  this.clock.tick(59 * 1000);
  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  assert.equal(this.player.src.calledWith.length, 2, 'player.src was called twice');

  // Advance 29 seconds
  this.clock.tick(29 * 1000);
  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  assert.equal(hlsErrorReloadCanceledEvents, 1,
    'did not reload the source because not enough time has elapsed');
  assert.equal(this.player.src.calledWith.length, 2, 'player.src was called twice');
});

QUnit.test('allows you to override the default retry interval', function(assert) {
  this.player.reloadSourceOnError({
    errorInterval: 60
  });

  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  assert.equal(this.player.src.calledWith.length, 1, 'player.src was only called once');

  // Advance 59 seconds
  this.clock.tick(59 * 1000);
  this.player.trigger('error', -2);
  this.player.trigger('loadedmetadata');

  assert.equal(this.player.src.calledWith.length, 1, 'player.src was only called once');
});

QUnit.test('the plugin cleans up after it\'s previous incarnation when called again',
function(assert) {
  this.player.reloadSourceOnError();
  this.player.reloadSourceOnError();

  this.player.trigger('error', -2);

  assert.equal(this.player.src.calledWith.length, 1, 'player.src was only called once');
});

QUnit.test('allows you to provide a getSource function', function(assert) {
  const newSource = {
    src: 'newsource.m3u8',
    type: 'this/matters'
  };

  this.player.reloadSourceOnError({
    getSource: (next) => {
      return next(newSource);
    }
  });

  this.player.trigger('error', -2);

  assert.equal(this.player.src.calledWith.length, 1, 'player.src was only called once');
  assert.deepEqual(this.player.src.calledWith[0],
                   newSource,
                   'player.src was called with return value of options.getSource()');
});

QUnit.test('errors if getSource is not a function', function(assert) {
  this.player.reloadSourceOnError({
    getSource: 'totally not a function'
  });

  this.player.trigger('error', -2);

  assert.equal(this.player.src.calledWith.length, 0, 'player.src was never called');
  assert.equal(this.errors.length, 1, 'videojs.log.error was called once');
});

QUnit.test('should not set source if getSource returns null or undefined',
function(assert) {
  this.player.reloadSourceOnError({
    getSource: () => undefined
  });

  this.player.trigger('error', -2);

  assert.equal(this.player.src.calledWith.length, 0, 'player.src was never called');

  this.player.reloadSourceOnError({
    getSource: () => null
  });

  this.player.trigger('error', -2);

  assert.equal(this.player.src.calledWith.length, 0, 'player.src was never called');
});

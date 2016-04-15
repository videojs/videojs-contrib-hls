import HlsAudioTrack from '../src/hls-audio-track';
import QUnit from 'qunit';

// Most of these tests will be done in video.js.AudioTrack unit tests
QUnit.module('HlsAudioTrack - Props');

QUnit.test('verify that props are readonly and can be set', function() {
  let props = {
    default: true,
    language: 'en',
    label: 'English',
    autoselect: true,
    withCredentials: true,
    // below props won't be used, its used for checking
    kind: 'main'
  };

  let track = new HlsAudioTrack(props);

  for (let k in props) {
    QUnit.equal(track[k], props[k], `${k} should be stored in track`);
  }

  for (let k in props) {
    let v = false;

    if (typeof props[k] !== 'boolean') {
      v = 'alternative';
    }
    track[k] = v;
    QUnit.notEqual(track[k], v, `${k} should be changed to ${v}`);
  }
});

QUnit.test('can start with a playlist loader', function() {
  let props = {
    default: true,
    language: 'en',
    label: 'English',
    autoselect: true,
    mediaGroup: 'foo',
    withCredentials: true,
    resolvedUri: 'http://some.test.url/playlist.m3u8',
    // below props won't be used, its used for checking
    enabled: true,
    kind: 'main'
  };

  let track = new HlsAudioTrack(props);

  QUnit.ok(track.getLoader('foo'), 'loader was created for mediaGroup foo');
});

QUnit.module('HlsAudioTrack - Loader', {
  beforeEach() {
    this.track = new HlsAudioTrack({
      mediaGroup: 'default',
      default: true,
      language: 'en',
      label: 'English',
      autoselect: true,
      withCredentials: true
    });
  },
  afterEach() {
    this.track = null;
  }
});

QUnit.test('can add a playlist loader', function() {
  QUnit.equal(Object.keys(this.track.mediaGroups).length, 1, '1 loader to start');

  this.track.addLoader('foo', 'someurl');
  this.track.addLoader('bar', 'someurl');
  this.track.addLoader('baz', 'someurl');

  QUnit.equal(Object.keys(this.track.mediaGroups).length, 4, 'now has four loaders');
});

QUnit.test('can remove playlist loader', function() {
  QUnit.equal(Object.keys(this.track.mediaGroups).length, 1, 'one loaders to start');

  this.track.addLoader('foo', 'someurl');
  this.track.addLoader('baz', 'someurl');

  QUnit.equal(Object.keys(this.track.mediaGroups).length, 3, 'now has three loaders');

  this.track.removeLoader('baz');
  QUnit.equal(Object.keys(this.track.mediaGroups).length, 2, 'now has two loaders');

});

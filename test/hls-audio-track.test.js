import HlsAudioTrack from '../src/hls-audio-track';
import QUnit from 'qunit';

// Most of these tests will be done in video.js.AudioTrack unit tests
QUnit.module('HlsAudioTrack - Props');

QUnit.test('verify that props are readonly and can be set', function(assert) {
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
    assert.equal(track[k], props[k], `${k} should be stored in track`);
  }
});

QUnit.test('can start with a mediaGroup that has a uri', function(assert) {
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

  assert.equal(track.mediaGroups_.length, 1, 'loader was created');
  let loader = track.getLoader('foo');

  assert.ok(loader, 'can getLoader on foo');

  track.dispose();
  assert.equal(track.mediaGroups_.length, 0, 'loader disposed');
});

QUnit.test('can start with a mediaGroup that has no uri', function(assert) {
  let props = {
    default: true,
    language: 'en',
    label: 'English',
    autoselect: true,
    mediaGroup: 'foo',
    withCredentials: true,
    // below props won't be used, its used for checking
    enabled: true,
    kind: 'main'
  };
  let track = new HlsAudioTrack(props);

  assert.equal(track.mediaGroups_.length, 1, 'mediaGroupLoader was created for foo');
  assert.ok(!track.getLoader('foo'), 'can getLoader on foo, but it is undefined');

  track.dispose();
  assert.equal(track.mediaGroups_.length, 0, 'loaders disposed');
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
  afterEach(assert) {
    this.track.dispose();
    assert.equal(this.track.mediaGroups_.length, 0, 'zero loaders after dispose');
  }
});

QUnit.test('can add a playlist loader', function(assert) {
  assert.equal(this.track.mediaGroups_.length, 1, '1 loader to start');

  this.track.addLoader('foo', 'someurl');
  this.track.addLoader('bar', 'someurl');
  this.track.addLoader('baz', 'someurl');

  assert.equal(this.track.mediaGroups_.length, 4, 'now has four loaders');
});

QUnit.test('can remove playlist loader', function(assert) {
  assert.equal(this.track.mediaGroups_.length, 1, 'one loaders to start');

  this.track.addLoader('foo', 'someurl');
  this.track.addLoader('baz', 'someurl');

  assert.equal(this.track.mediaGroups_.length, 3, 'now has three loaders');

  this.track.removeLoader('baz');
  assert.equal(this.track.mediaGroups_.length, 2, 'now has two loaders');

});

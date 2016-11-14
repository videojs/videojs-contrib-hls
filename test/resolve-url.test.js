import QUnit from 'qunit';
import window from 'global/window';
import resolveUrl from '../src/resolve-url';

// Tests pulled over from hls.js

QUnit.module('URL resolver');

QUnit.test('works with a selection of valid urls', function() {
  let currentLocation = window.location.protocol + '//' + window.location.host;

  QUnit.equal(resolveUrl('http://a.com/b/cd/e.m3u8', 'https://example.com/z.ts'), 'https://example.com/z.ts');
  QUnit.equal(resolveUrl('http://a.com/b/cd/e.m3u8', 'g:h'), 'g:h');
  QUnit.equal(resolveUrl('http://a.com/b/cd/e.m3u8', 'https://example.com:8080/z.ts'), 'https://example.com:8080/z.ts');

  QUnit.equal(resolveUrl('http://a.com/b/cd/e.m3u8', 'z.ts'), 'http://a.com/b/cd/z.ts');
  QUnit.equal(resolveUrl('http://a.com:8080/b/cd/e.m3u8', 'z.ts'), 'http://a.com:8080/b/cd/z.ts');
  QUnit.equal(resolveUrl('http://a.com/b/cd/', 'z.ts'), 'http://a.com/b/cd/z.ts');
  QUnit.equal(resolveUrl('http://a.com/b/cd', 'z.ts'), 'http://a.com/b/z.ts');
  QUnit.equal(resolveUrl('http://a.com/b/cd?test=1', 'z.ts'), 'http://a.com/b/z.ts');
  QUnit.equal(resolveUrl('http://a.com/b/cd#something', 'z.ts'), 'http://a.com/b/z.ts');
  QUnit.equal(resolveUrl('http://a.com/b/cd?test=1#something', 'z.ts'), 'http://a.com/b/z.ts');
  QUnit.equal(resolveUrl('http://a.com/b/cd?test=1#something', 'z.ts?abc=1'), 'http://a.com/b/z.ts?abc=1');
  QUnit.equal(resolveUrl('http://a.com/b/cd?test=1#something', 'z.ts#test'), 'http://a.com/b/z.ts#test');
  QUnit.equal(resolveUrl('http://a.com/b/cd?test=1#something', 'z.ts?abc=1#test'), 'http://a.com/b/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('http://a.com/b/cd?test=1#something', ';x'), 'http://a.com/b/;x');
  QUnit.equal(resolveUrl('http://a.com/b/cd?test=1#something', 'g;x'), 'http://a.com/b/g;x');
  QUnit.equal(resolveUrl('http://a_b.com/b/cd?test=1#something', 'g;x'), 'http://a_b.com/b/g;x');
  QUnit.equal(resolveUrl('http://a-b.com/b/cd?test=1#something', 'g;x'), 'http://a-b.com/b/g;x');
  QUnit.equal(resolveUrl('http://a.b.com/b/cd?test=1#something', 'g;x'), 'http://a.b.com/b/g;x');
  QUnit.equal(resolveUrl('http://a~b.com/b/cd?test=1#something', 'g;x'), 'http://a~b.com/b/g;x');

  QUnit.equal(resolveUrl('http://a.com/b/cd/e.m3u8?test=1#something', 'subdir/z.ts?abc=1#test'), 'http://a.com/b/cd/subdir/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('http://a.com/b/cd/e.m3u8?test=1#something', '/subdir/z.ts?abc=1#test'), 'http://a.com/subdir/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('http://a.com/b/cd/e.m3u8?test=1#something', '//example.com/z.ts?abc=1#test'), 'http://example.com/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', '//example.com/z.ts?abc=1#test'), 'https://example.com/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', './z.ts?abc=1#test'), 'https://a.com/b/cd/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', '../z.ts?abc=1#test'), 'https://a.com/b/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', './../z.ts?abc=1#test'), 'https://a.com/b/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', '././z.ts?abc=1#test'), 'https://a.com/b/cd/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e/f.m3u8?test=1#something', '../../z.ts?abc=1#test'), 'https://a.com/b/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', '../../z.ts?abc=1#test'), 'https://a.com/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', '../../z.ts?abc=1&something=blah/./../test#test'), 'https://a.com/z.ts?abc=1&something=blah/./../test#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e/f.m3u8?test=1#something', './../../z.ts?abc=1#test'), 'https://a.com/b/z.ts?abc=1#test');

  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', 'subdir/pointless/../z.ts?abc=1#test'), 'https://a.com/b/cd/subdir/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', '/subdir/pointless/../z.ts?abc=1#test'), 'https://a.com/subdir/z.ts?abc=1#test');
  QUnit.equal(resolveUrl('https://a.com/b/cd/e.m3u8?test=1#something', '//example.com/subdir/pointless/../z.ts?abc=1#test'), 'https://example.com/subdir/z.ts?abc=1#test');

  QUnit.equal(resolveUrl('https://a-b.something.com/b/cd/e.m3u8?test=1#something', '//example.com/subdir/pointless/../z.ts?abc=1#test'), 'https://example.com/subdir/z.ts?abc=1#test');

  QUnit.equal(resolveUrl('//a.com/b/cd/e.m3u8', 'https://example.com/z.ts'), 'https://example.com/z.ts');
  QUnit.equal(resolveUrl('//a.com/b/cd/e.m3u8', 'g:h'), 'g:h');
  QUnit.equal(resolveUrl('//a.com/b/cd/e.m3u8', 'https://example.com:8080/z.ts'), 'https://example.com:8080/z.ts');
  QUnit.equal(resolveUrl('//a.com/b/cd/e.m3u8', 'z.ts'), '//a.com/b/cd/z.ts');
  QUnit.equal(resolveUrl('//a.com/b/cd/e.m3u8', '../../z.ts'), '//a.com/z.ts');

  QUnit.equal(resolveUrl('/a/b/cd/e.m3u8', 'https://example.com/z.ts'), 'https://example.com/z.ts');
  QUnit.equal(resolveUrl('/a/b/cd/e.m3u8', 'g:h'), 'g:h');
  QUnit.equal(resolveUrl('/a/b/cd/e.m3u8', 'https://example.com:8080/z.ts'), 'https://example.com:8080/z.ts');
  QUnit.equal(resolveUrl('/a/b/cd/e.m3u8', 'z.ts'), currentLocation + '/a/b/cd/z.ts');
  QUnit.equal(resolveUrl('/a/b/cd/e.m3u8', '../../../z.ts'), currentLocation + '/z.ts');
});

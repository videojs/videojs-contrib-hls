import QUnit from 'qunit';
import window from 'global/window';
import resolveUrl from '../src/resolve-url';

// A modified subset of tests from https://github.com/tjenkinson/url-toolkit

QUnit.module('URL resolver');

QUnit.test('works with a selection of valid urls', function() {
  let currentLocation = window.location.protocol + '//' + window.location.host;

  QUnit.equal(resolveUrl('http://a.com/b/cd/e.m3u8', 'https://example.com/z.ts'), 'https://example.com/z.ts');
  QUnit.equal(resolveUrl('http://a.com/b/cd/e.m3u8', 'z.ts'), 'http://a.com/b/cd/z.ts');
  QUnit.equal(resolveUrl('//a.com/b/cd/e.m3u8', 'z.ts'), '//a.com/b/cd/z.ts');
  QUnit.equal(resolveUrl('/a/b/cd/e.m3u8', 'https://example.com:8080/z.ts'), 'https://example.com:8080/z.ts');
  QUnit.equal(resolveUrl('/a/b/cd/e.m3u8', 'z.ts'), currentLocation + '/a/b/cd/z.ts');
  QUnit.equal(resolveUrl('/a/b/cd/e.m3u8', '../../../z.ts'), currentLocation + '/z.ts');
});

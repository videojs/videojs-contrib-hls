/**
 * Rollup configuration for packaging the plugin in a test bundle.
 *
 * This includes all dependencies for both the plugin and its tests.
 */
import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import multiEntry from 'rollup-plugin-multi-entry';
import resolve from 'rollup-plugin-node-resolve';
import worker from 'rollup-plugin-bundle-worker';

export default {
  moduleName: 'videojs-contrib-hls-tests',
  entry: 'test/**/*.test.js',
  dest: 'test/dist/bundle.js',
  format: 'iife',
  external: [
    'qunit',
    'qunitjs',
    'sinon',
    'video.js'
  ],
  globals: {
    'qunit': 'QUnit',
    'qunitjs': 'QUnit',
    'sinon': 'sinon',
    'video.js': 'videojs'
  },
  legacy: true,
  plugins: [
    multiEntry({
      exports: false
    }),
    worker(),
    resolve({
      browser: true,
      main: true,
      jsnext: true
    }),
    json(),
    commonjs({
      sourceMap: false
    }),
    babel({
      babelrc: false,
      exclude: 'node_modules/**',
      presets: [
        ['es2015', {
          loose: true,
          modules: false
        }]
      ],
      plugins: [
        'external-helpers',
        'transform-object-assign'
      ]
    })
  ]
};

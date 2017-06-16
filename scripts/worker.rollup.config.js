/**
 * Rollup configuration for packaging the plugin in a module that is consumable
 * as the `src` of a `script` tag or via AMD or similar client-side loading.
 *
 * This module DOES include its dependencies.
 */
import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import resolve from 'rollup-plugin-node-resolve';
import worker from '@gkatsev/rollup-plugin-bundle-worker';

export default {
  moduleName: 'worker',
  entry: 'src/decrypter-worker.js',
  dest: 'src/worker.js',
  format: 'iife',
  external: ['video.js', 'videojs-flash'],
  globals: {
    'video.js': 'videojs'
  },
  legacy: true,
  plugins: [
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

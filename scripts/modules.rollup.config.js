/**
 * Rollup configuration for packaging the plugin in a module that is consumable
 * by either CommonJS (e.g. Node or Browserify) or ECMAScript (e.g. Rollup).
 *
 * These modules DO NOT include their dependencies as we expect those to be
 * handled by the module system.
 */
import babel from 'rollup-plugin-babel';
import json from 'rollup-plugin-json';
import worker from 'rollup-plugin-bundle-worker';

export default {
  moduleName: 'videojs-contrib-hls',
  entry: 'src/videojs-contrib-hls.js',
  external: ['video.js'],
  globals: {
    'video.js': 'videojs'
  },
  legacy: true,
  plugins: [
    worker(),
    json(),
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
  ],
  targets: [
    {dest: 'dist/videojs-contrib-hls.cjs.js', format: 'cjs'},
    {dest: 'dist/videojs-contrib-hls.es.js', format: 'es'}
  ]
};

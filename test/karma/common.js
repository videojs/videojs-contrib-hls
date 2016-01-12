var merge = require('lodash-compat/object/merge');

var DEFAULTS = {
  basePath: '../..',
  frameworks: ['browserify', 'qunit'],

  files: [
    'node_modules/sinon/pkg/sinon.js',
    'node_modules/sinon/pkg/sinon-ie.js',
    'node_modules/video.js/dist/video.js',
    'test/**/*.js'
  ],

  exclude: [
    'test/bundle.js',
    'test/files/**',
    'test/manifest/**',
    'test/test-data/ts-segment-bc*'
  ],

  plugins: [
    'karma-browserify',
    'karma-qunit'
  ],

  preprocessors: {
    'test/**/*.js': ['browserify']
  },

  reporters: ['dots'],
  port: 9876,
  colors: true,
  autoWatch: false,
  singleRun: true,
  concurrency: Infinity,

  browserify: {
    debug: true,
    transform: [
      'babelify',
      'browserify-shim'
    ],
    noparse: [
      'test/files/**',
      'test/test-data/**'
    ]
  }
};

/**
 * Customizes target/source merging with lodash merge.
 *
 * @param  {Mixed} target
 * @param  {Mixed} source
 * @return {Mixed}
 */
var customizer = function(target, source) {
  if (Array.isArray(target)) {
    return target.concat(source);
  }
};

/**
 * Generates a new Karma config with a common set of base configuration.
 *
 * @param  {Object} custom
 *         Configuration that will be deep-merged. Arrays will be
 *         concatenated.
 * @return {Object}
 */
module.exports = function(custom) {
  return merge({}, custom, DEFAULTS, customizer);
};

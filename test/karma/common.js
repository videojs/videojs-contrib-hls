var merge = require('lodash/mergeWith');
var istanbul = require('browserify-istanbul');
var isparta = require('isparta');

var DEFAULTS = {
  basePath: '../..',
  frameworks: ['browserify', 'qunit'],


  files: [
    'node_modules/sinon/pkg/sinon.js',
    'node_modules/sinon/pkg/sinon-ie.js',
    'test/dist/browserify-test.js',
    'test/dist/webpack-test.js',
    'node_modules/video.js/dist/video.js',
    'node_modules/video.js/dist/video-js.css',
    'node_modules/videojs-flash/dist/videojs-flash.js',
    'node_modules/videojs-contrib-quality-levels/dist/videojs-contrib-quality-levels.js',
    'node_modules/videojs-contrib-media-sources/dist/videojs-contrib-media-sources.js',
    'test/dist/bundle.js'
  ],

  exclude: [],

  plugins: [
    'karma-browserify',
    'karma-coverage',
    'karma-qunit'
  ],

  browserConsoleLogOptions: {
    level: 'error',
    terminal: false
  },

  preprocessors: {
    'test/**/*.test.js': ['browserify']
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
      ['browserify-shim', { global: true }]
    ],
    noParse: [
      'test/data/**',
    ]
  },

  babelPreprocessor: {
    options: {
      presets: ['es2015'],
      sourceMap: 'inline'
    },
    sourceFileName: function (file) {
      return file.originalPath;
    }
  },

  customLaunchers: {
    travisChrome: {
      base: 'Chrome',
      flags: ['--no-sandbox']
    }
  }
};

// Coverage reporting
// Coverage is enabled by passing the flag --coverage to npm test
var coverageFlag = process.env.npm_config_coverage;
var reportCoverage = process.env.TRAVIS || coverageFlag;

if (reportCoverage) {
  DEFAULTS.reporters.push('coverage');
  DEFAULTS.browserify.transform.push(istanbul({
    instrumenter: isparta,
    ignore: ['**/node_modules/**', '**/test/**']
  }));
  DEFAULTS.preprocessors['src/**/*.js'] = ['browserify', 'coverage'];
}

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

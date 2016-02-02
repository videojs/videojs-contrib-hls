var merge = require('lodash-compat/object/merge');

var DEFAULTS = {
  basePath: '../..',
  frameworks: ['browserify', 'qunit'],


  files: [
    'node_modules/sinon/pkg/sinon.js',
    'node_modules/sinon/pkg/sinon-ie.js',
    'node_modules/video.js/dist/video.js',
    'node_modules/video.js/dist/video-js.css',

    // REMOVE ME WHEN BROWSERIFIED
    'node_modules/pkcs7/dist/pkcs7.unpad.js',
    'node_modules/videojs-contrib-media-sources/src/videojs-media-sources.js',

    // these two stub old functionality
    'src/videojs-contrib-hls.js',
    'src/xhr.js',
    'dist/videojs-contrib-hls.js',

    'src/playlist.js',
    'src/playlist-loader.js',
    'src/decrypter.js',
    'src/bin-utils.js',

    'test/stub.test.js',

    'test/videojs-contrib-hls.test.js',
    'test/m3u8.test.js',
    'test/playlist.test.js',
    'test/playlist-loader.test.js',
    'test/decrypter.test.js',
    // END REMOVE ME
    // 'test/**/*.js'
  ],

  exclude: [
    'test/bundle.js',
//    'test/data/**'
  ],

  plugins: [
    'karma-browserify',
    'karma-qunit'
  ],

  preprocessors: {
    'test/{stub,m3u8}.test.js': ['browserify']
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
    noParse: [
      'test/data/**',
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

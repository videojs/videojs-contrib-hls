var merge = require('lodash-compat/object/merge');

var DEFAULTS = {
  basePath: '../..',
  //frameworks: ['browserify', 'qunit'],
  frameworks: ['qunit'],


  files: [
    'node_modules/sinon/pkg/sinon.js',
    'node_modules/sinon/pkg/sinon-ie.js',
    'node_modules/video.js/dist/video.js',
    'node_modules/video.js/dist/video-js.css',

    // REMOVE ME WHEN BROWSERIFIED
    'node_modules/pkcs7/dist/pkcs7.unpad.js',
    'node_modules/videojs-contrib-media-sources/src/videojs-media-sources.js',

    'src/videojs-hls.js',
    'src/xhr.js',
    'src/stream.js',
    'src/m3u8/m3u8-parser.js',
    'src/playlist.js',
    'src/playlist-loader.js',
    'src/decrypter.js',
    'src/bin-utils.js',

    'test/data/manifests.js',
    'test/data/expected.js',
    'test/data/ts-segment-bc.js',

    'test/videojs-hls.test.js',
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
  //  'karma-browserify',
    'karma-qunit'
  ],

  preprocessors: {
   // 'test/**/*.js': ['browserify']
  },

  reporters: ['dots'],
  port: 9876,
  colors: true,
  autoWatch: false,
  singleRun: true,
  concurrency: Infinity,

  /*
  browserify: {
    debug: true,
    transform: [
      'babelify',
      'browserify-shim'
    ],
    noparse: [
      'test/data/**',
    ]
  }
  */
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

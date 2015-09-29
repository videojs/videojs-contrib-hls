// Karma example configuration file
// NOTE: To configure Karma tests, do the following:
//       1.  Copy this file and rename the copy with a .conf.js extension, for example:  karma.conf.js
//       2.  Configure the properties below in your conf.js copy
//       3.  Run your tests

module.exports = function(config) {
  config.set({
    // base path, that will be used to resolve files and exclude
    basePath: '',

    frameworks: ['qunit'],

    // Set autoWatch to true if you plan to run `grunt karma` continuously, to automatically test changes as you make them.
    autoWatch: false,

    // Setting singleRun to true here will start up your specified browsers, run tests, and then shut down the browsers.  Helpful to have in a CI environment, where you don't want to leave browsers running continuously.
    singleRun: true,

    // Start these browsers, currently available:
    // - Chrome
    // - ChromeCanary
    // - Firefox
    // - Opera
    // - Safari (only Mac)
    // - PhantomJS
    // - IE (only Windows)
    // Example usage:
    // browsers: [],
    // List of files / patterns to load in the browser
    // Add any new src files to this list.
    // If you add new unit tests, they will be picked up automatically by Karma,
    // unless you've added them to a nested directory, in which case you should
    // add their paths to this list.

    files: [
      '../node_modules/sinon/pkg/sinon.js',
      '../node_modules/video.js/dist/video-js.css',
      '../node_modules/video.js/dist/video.js',
      '../node_modules/videojs-contrib-media-sources/src/videojs-media-sources.js',
      '../node_modules/pkcs7/dist/pkcs7.unpad.js',
      '../test/karma-qunit-shim.js',
      '../src/videojs-hls.js',
      '../src/stream.js',
      '../src/m3u8/m3u8-parser.js',
      '../src/xhr.js',
      '../src/playlist.js',
      '../src/playlist-loader.js',
      '../src/decrypter.js',
      '../tmp/manifests.js',
      '../tmp/expected.js',
      'tsSegment-bc.js',
      '../src/bin-utils.js',
      '../test/*.js',
      ],

    plugins: [
      'karma-qunit',
      'karma-chrome-launcher',
      'karma-firefox-launcher',
      'karma-ie-launcher',
      'karma-opera-launcher',
      'karma-phantomjs-launcher',
      'karma-safari-launcher'
    ],

    // list of files to exclude
    exclude: [

    ],


    // test results reporter to use
    // possible values: 'dots', 'progress', 'junit'
    reporters: ['progress'],


    // web server port
    port: 9876,


    // cli runner port
    runnerPort: 9100,


    // enable / disable colors in the output (reporters and logs)
    colors: true,


    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_DISABLE,

    // If browser does not capture in given timeout [ms], kill it
    captureTimeout: 60000
  });
};

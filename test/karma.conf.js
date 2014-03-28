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
    browsers: ['chrome_test']
              //'firefox_test',
              //'safari_test',
              //'ipad_test',
              //'android_test'

    // List of files / patterns to load in the browser
    // Add any new src files to this list.
    // If you add new unit tests, they will be picked up automatically by Karma,
    // unless you've added them to a nested directory, in which case you should
    // add their paths to this list.

    files: [
      '../node_modules/video.js/dist/video-js/video.js',
      '../node_modules/videojs-contrib-media-sources/videojs-media-sources.js',
      '../test/karma-qunit-shim.js',
      "../src/videojs-hls.js",
      "../src/flv-tag.js",
      "../src/exp-golomb.js",
      "../src/h264-stream.js",
      "../src/aac-stream.js",
      "../src/segment-parser.js",
      "../src/stream.js",
      "../src/m3u8/m3u8-parser.js",
      "../tmp/manifests.js",
      "../tmp/expected.js",
      "tsSegment-bc.js",
      "../src/bin-utils.js",
      "../src/async-queue.js",
      '../test/*.js' 
      ],

    plugins: [
      'karma-qunit',
      'karma-chrome-launcher',
      'karma-firefox-launcher',
      'karma-ie-launcher',
      'karma-opera-launcher',
      'karma-phantomjs-launcher',
      'karma-safari-launcher',
      'karma-sauce-launcher'
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
    //logLevel: config.LOG_INFO,

    // If browser does not capture in given timeout [ms], kill it
    captureTimeout: 60000,

    // global config for SauceLabs
    sauceLabs: {
      username: "sheff555",
      accessKey: "d04372cc-0fc3-4e59-aa02-3cfd9df03240",
      startConnect: true,
      tunnelIdentifier: 'uniquekarmaidentifier',
      testName: 'ps test sample'
    },

    //define SL browsers
    customLaunchers: {
      chrome_test: { 
        singleRun: true,
        base: 'SauceLabs', 
        browserName: 'chrome',
        platform: 'Windows XP'
      },

      firefox_test: {
        singleRun: true,
        base: 'SauceLabs',
        browserName: 'firefox',
        platform: 'Windows 8'
      },

      safari_test: {
        singleRun: true,
        base: 'SauceLabs',
        browserName: 'safari',
        platform: 'OS X 10.8'
      },

      ipad_test: {
        singleRun: true,
        base: 'SauceLabs',
        browserName: 'ipad',
        platform:'OS X 10.8'
      },

      android_test: {
        singleRun: true,
        base: 'SauceLabs',
        browserName: 'android',
        platform:'Linux'
      }

    }

  });
};

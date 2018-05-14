var istanbul = require('browserify-istanbul');
var isparta = require('isparta');

module.exports = function(config) {

  // Only run chrome in no sandbox mode
  let customLaunchers = {};

  ['Chrome', 'ChromeCanary', 'Chromium'].forEach((browser) => {
    customLaunchers[browser + 'WithFlags'] = {
      base: browser,
      flags: ['--no-sandbox']
    };
    customLaunchers[browser + 'HeadlessWithFlags'] = {
      base: browser + 'Headless',
      flags: ['--no-sandbox']
    };
  });

  let detectBrowsers = {
    usePhantomJS: false,
    // use headless mode automatically for browsers that support it
    preferHeadless: true,
    // replace chrome headless with one that is suitable for automatic testing
    postDetection: function(availableBrowsers) {
      let browsers = [];

      for (let index in availableBrowsers) {
        let browser = availableBrowsers[index];

        if (/^(Chromium.*|Chrome.*)/.test(browser)) {
          browsers.push(browser + 'WithFlags');
        } else if (!/Safari/.test(browser)) {
          browsers.push(browser);
        }
      }
      return browsers;
    }
  };

  // If no browsers are specified, we enable `karma-detect-browsers`
  // this will detect all browsers that are available for testing
  if (!config.browsers.length) {
    detectBrowsers.enabled = true;
  }

  config.set({
    basePath: '..',
    frameworks: ['qunit', 'browserify', 'detectBrowsers'],
    client: {
      clearContext: false,
      qunit: {
        showUI: true,
        testTimeout: 30000
      }
    },
    files: [
      'node_modules/sinon/pkg/sinon.js',
      'node_modules/sinon/pkg/sinon-ie.js',
      'node_modules/video.js/dist/video.js',
      'node_modules/video.js/dist/video-js.css',
      'node_modules/videojs-flash/dist/videojs-flash.js',
      'dist-test/browserify-test.js',
      'dist-test/webpack-test.js',
      'dist-test/videojs-contrib-hls.js'
    ],
    browserConsoleLogOptions: {
      level: 'error',
      terminal: false
    },
    preprocessors: {
      'test/**/*.test.js': ['browserify']
    },
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
    customLaunchers,
    detectBrowsers: detectBrowsers,
    reporters: ['dots'],
    port: 9876,
    colors: true,
    autoWatch: false,
    singleRun: true,
    concurrency: 1,
    captureTimeout: 300000,
    browserNoActivityTimeout: 300000,
    browserDisconnectTimeout: 300000,
    browserDisconnectTolerance: 3
  });

  // Coverage reporting
  // Coverage is enabled by passing the flag --coverage to npm test
  var coverageFlag = process.env.npm_config_coverage;
  var reportCoverage = process.env.TRAVIS || coverageFlag;

  if (reportCoverage) {
    config.reporters.push('coverage');
    config.browserify.transform.push(istanbul({
      instrumenter: isparta,
      ignore: ['**/node_modules/**', '**/test/**']
    }));
    config.preprocessors['src/**/*.js'] = ['browserify', 'coverage'];
  }

};

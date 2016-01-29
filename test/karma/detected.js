var common = require('./common');

// Runs default testing configuration in multiple environments.

module.exports = function(config) {

  // Travis CI should run in its available Firefox headless browser.
  if (process.env.TRAVIS) {

    config.set(common({
      browsers: ['Firefox'],
      plugins: ['karma-firefox-launcher']
    }))
  } else {
    config.set(common({

      frameworks: ['detectBrowsers'],

      plugins: [
        'karma-chrome-launcher',
        'karma-detect-browsers',
        'karma-firefox-launcher',
        'karma-ie-launcher',
        'karma-safari-launcher'
      ],

      detectBrowsers: {
        // disable safari as it was not previously supported and causes test failures
        postDetection: function(availableBrowsers) {
          var safariIndex = availableBrowsers.indexOf('Safari');
          if(safariIndex !== -1) {
            console.log("Not running safari it is/was broken");
            availableBrowsers.splice(safariIndex, 1);
          }
          return availableBrowsers;
        },
        usePhantomJS: false
      }
    }));
  }
};

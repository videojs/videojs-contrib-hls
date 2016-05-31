var browsersToSkip = function(availableBrowsers) {
  var skip = ['Safari', 'IE'];

  skip.forEach(function(s) {
    var skipIndex = availableBrowsers.indexOf(s);
    if(skipIndex !== -1) {
      console.log('NOTE: Unit tests will not and cannot be run on ' + s + '!');
      availableBrowsers.splice(skipIndex, 1);
    }
  })
  return availableBrowsers;
};

module.exports = function(config) {
  var frameworks = ['qunit'];


  // If no browsers are specified, we will do a `karma-detect-browsers` run,
  // which means we need to set up that plugin and all the browser plugins
  // we are supporting.
  if (!config.browsers.length) {
    frameworks.push('detectBrowsers');
  }

  config.set({
    basePath: '..',
    frameworks: frameworks,

    files: [
      'node_modules/sinon/pkg/sinon.js',
      'node_modules/sinon/pkg/sinon-ie.js',
      'node_modules/video.js/dist/video.js',
      'node_modules/video.js/dist/video-js.css',
      'test/dist/bundle.js'
    ],

    detectBrowsers: {
      usePhantomJS: false,
      postDetection: browsersToSkip
    },

    reporters: ['dots'],
    port: 9876,
    colors: true,
    autoWatch: false,
    singleRun: true,
    concurrency: Infinity
  });
};

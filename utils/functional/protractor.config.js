/* global browser */

var config = {};

if (process.env.SAUCE_USERNAME) {
  config.multiCapabilities = [{
    browserName: 'chrome',
    platform: 'Windows 8.1'
  }].map(function(caps) {
    caps.name = process.env.TRAVIS_BUILD_NUMBER + process.env.TRAVIS_BRANCH;
    caps.build = process.env.TRAVIS_BUILD_NUMBER;
    caps['tunnel-identifier'] = process.env.TRAVIS_JOB_NUMBER;
    caps.recordScreenshots = false;
    return caps;
  });

  config.sauceUser = process.env.SAUCE_USERNAME;
  config.sauceKey = process.env.SAUCE_ACCESS_KEY;
  config.maxSessions = 5;
  config.maxDuration = 300;
}

config.baseUrl = 'http://127.0.0.1:9999/';
config.specs = ['spec.js'];

config.framework = 'jasmine2';
config.onPrepare = function() {
  browser.ignoreSynchronization = true;
};
config.jasmineNodeOpts = {
  showColors: true,
  defaultTimeoutInterval: 60000
};

exports.config = config;

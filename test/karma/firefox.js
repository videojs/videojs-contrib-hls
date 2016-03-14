var common = require('./common');

module.exports = function(config) {
  config.set(common({
    plugins: ['karma-firefox-launcher'],
    browsers: ['Firefox']
  }));
};

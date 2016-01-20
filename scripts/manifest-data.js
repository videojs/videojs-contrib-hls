var fs = require('fs');
var path = require('path');

var basePath  = path.resolve(__dirname + '/..');
var testDataDir = basePath + '/test/data';
var manifestDir = basePath + '/utils/manifest';
var manifestFilepath = testDataDir + '/manifests.js';
var expectedFilepath = testDataDir + '/expected.js';


var build = function() {
  var manifests = 'window.manifests = {\n';
  var expected = 'window.expected = {\n';

  var files = fs.readdirSync(manifestDir);
  while (files.length > 0) {
    var file = path.resolve(manifestDir, files.shift());
    var extname = path.extname(file);

    if (extname === '.m3u8') {
      // translate this manifest
      manifests += '  \'' + path.basename(file, '.m3u8') + '\': ';
      manifests += fs.readFileSync(file, 'utf8')
        .split(/\r\n|\n/)
        // quote and concatenate
        .map(function(line) {
          return '    \'' + line + '\\n\' +\n';
        }).join('')
        // strip leading spaces and the trailing '+'
        .slice(4, -3);
      manifests += ',\n';
    } else if (extname === '.js') {
      // append the expected parse
      expected += '  "' + path.basename(file, '.js') + '": ';
      expected += fs.readFileSync(file, 'utf8');
      expected += ',\n';
    } else {
      console.log('Unknown file ' + file + ' found in manifest dir ' + manifestDir);
    }

  }

  // clean up and close the objects
  manifests = manifests.slice(0, -2);
  manifests += '\n};\n';
  expected = expected.slice(0, -2);
  expected += '\n};\n';

  fs.writeFileSync(manifestFilepath, manifests);
  fs.writeFileSync(expectedFilepath, expected);
  console.log('Wrote test data file ' + manifestFilepath);
  console.log('Wrote test data file ' + expectedFilepath);
};

var watch = function() {
  build();
  fs.watch(manifestDir, function(event, filename) {
    console.log('files in manifest dir were changed rebuilding manifest data');
    build();
  });
};

var clean = function() {
  try {
    fs.unlinkSync(manifestFilepath);
  } catch(e) {
    // ignore error, must not exist
  }
  try {
    fs.unlinkSync(expectedFilepath);
  } catch(e) {
    // ignore error, must not exist
  }
}

module.exports = {
  build: build,
  watch: watch,
  clean: clean
};

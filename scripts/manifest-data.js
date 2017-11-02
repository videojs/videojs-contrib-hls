var fs = require('fs');
var path = require('path');

var basePath  = path.resolve(__dirname, '..');
var testDataDir = path.join(basePath,'test');
var manifestDir = path.join(basePath, 'utils', 'manifest');
var manifestFilepath = path.join(testDataDir, 'test-manifests.js');

var build = function() {
  var manifests = 'export default {\n';

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
    } else {
      console.log('Unknown file ' + file + ' found in manifest dir ' + manifestDir);
    }

  }

  // clean up and close the objects
  manifests = manifests.slice(0, -2);
  manifests += '\n};\n';

  fs.writeFileSync(manifestFilepath, manifests);
  console.log('Wrote test data file ' + manifestFilepath);
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
    console.log(e);
  }
}

module.exports = {
  build: build,
  watch: watch,
  clean: clean
};

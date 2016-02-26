var browserify = require('browserify');
var fs = require('fs');
var glob = require('glob');

glob('test/**/*.test.js', function(err, files) {
  browserify(files)
    .transform('babelify')
    .bundle()
    .pipe(fs.createWriteStream('dist-test/videojs-contrib-hls.js'));
});

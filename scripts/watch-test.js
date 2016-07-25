import browserify from 'browserify';
import fs from 'fs';
import glob from 'glob';
import watchify from 'watchify';

glob('test/**/*.test.js', function(err, files) {
  if (err) {
    throw err;
  }
  let b = browserify(files, {
    cache: {},
    packageCache: {},
    plugin: [watchify]
  })
  .transform('babelify')
  .transform('browserify-shim', {global: true});

  let bundle = function() {
    b.bundle().pipe(fs.createWriteStream('test/dist/videojs-contrib-hls.js'));
  };

  b.on('log', function(msg) {
    process.stdout.write(msg + ' test/dist/videojs-contrib-hls.js\n');
  });

  b.on('update', bundle);
  bundle();
});

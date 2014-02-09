var grunt = require('grunt'),
    extname = require('path').extname;

grunt.file.recurse(process.cwd(), function(path) {
  var json;
  if (extname(path) === '.json') {
    json = grunt.file.readJSON(path);
    if (json.totalDuration) {
      delete json.totalDuration;
      grunt.file.write(path, JSON.stringify(json, null, '  '));
    }
  }
});

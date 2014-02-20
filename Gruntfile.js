'use strict';

var basename = require('path').basename;

module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    // Metadata.
    pkg: grunt.file.readJSON('package.json'),
    banner: '/*! <%= pkg.name %> - v<%= pkg.version %> - ' +
      '<%= grunt.template.today("yyyy-mm-dd") %>\n' +
      '* Copyright (c) <%= grunt.template.today("yyyy") %> Brightcove;' +
      ' Licensed <%= _.pluck(pkg.licenses, "type").join(", ") %> */\n',
    // Task configuration.
    clean: {
      files: ['build', 'dist', 'tmp']
    },
    concat: {
      options: {
        banner: '<%= banner %>',
        stripBanners: true
      },
      dist: {
        nonull: true,
        src: ['src/videojs-hls.js',
              'src/async-queue.js',
              'src/flv-tag.js',
              'src/exp-golomb.js',
              'src/h264-stream.js',
              'src/aac-stream.js',
              'src/segment-parser.js',
              'src/m3u8/m3u8-parser.js'
            ],
        dest: 'dist/videojs.hls.js'
      },
    },
    uglify: {
      options: {
        banner: '<%= banner %>'
      },
      dist: {
        src: '<%= concat.dist.dest %>',
        dest: 'dist/videojs.hls.min.js'
      },
    },
    qunit: {
      files: ['test/**/*.html', '!test/perf.html']
    },
    jshint: {
      gruntfile: {
        options: {
          jshintrc: '.jshintrc'
        },
        src: 'Gruntfile.js'
      },
      src: {
        options: {
          jshintrc: 'src/.jshintrc'
        },
        src: ['src/**/*.js']
      },
      test: {
        options: {
          jshintrc: 'test/.jshintrc'
        },
        src: ['test/**/*.js',
              '!test/tsSegment.js',
              '!test/fixtures/*.js',
              '!test/manifest/**']
      },
    },
    watch: {
      gruntfile: {
        files: '<%= jshint.gruntfile.src %>',
        tasks: ['jshint:gruntfile']
      },
      src: {
        files: '<%= jshint.src.src %>',
        tasks: ['jshint:src', 'qunit']
      },
      test: {
        files: '<%= jshint.test.src %>',
        tasks: ['jshint:test', 'qunit']
      },
    },
    karma: {
      options: {
        configFile: 'test/karma.conf.js'
      },
      dev: {
        configFile: 'test/karma.conf.js',
        autoWatch: true
      },
      ci: {
        configFile: 'test/karma.conf.js',
        autoWatch: false
      }
    }
  });

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-qunit');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-karma');

  grunt.registerTask('manifests-to-js', 'Wrap the test fixtures and output' +
                     ' so they can be loaded in a browser',
                     function() {
    var
      jsManifests = 'window.manifests = {\n',
      jsExpected = 'window.expected = {\n';
    grunt.file.recurse('test/manifest/',
                       function(abspath, root, sub, filename) {
      if ((/\.m3u8$/).test(abspath)) {

        // translate this manifest
        jsManifests += '  \'' + basename(filename, '.m3u8') + '\': ' +
          grunt.file.read(abspath)
            .split('\n')

            // quote and concatenate
            .map(function(line) {
              return '    \'' + line + '\\n\' +\n';
            }).join('')

            // strip leading spaces and the trailing '+'
            .slice(4, -3);
        jsManifests += ',\n';
      }

      if ((/\.json$/).test(abspath)) {

        // append the JSON
        jsExpected += '  "' + basename(filename, '.json') + '": ' +
          grunt.file.read(abspath) + ',\n';
      }
    });

    // clean up and close the objects
    jsManifests = jsManifests.slice(0, -2);
    jsManifests += '\n};\n';
    jsExpected = jsExpected.slice(0, -2);
    jsExpected += '\n};\n';

    // write out the manifests
    grunt.file.write('tmp/manifests.js', jsManifests);
    grunt.file.write('tmp/expected.js', jsExpected);
  });

  // Default task.
  grunt.registerTask('default',
                     ['clean',
                      'jshint',
                      'manifests-to-js',
                      'qunit',
                      'concat',
                      'uglify']);

};

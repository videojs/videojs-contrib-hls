'use strict';

var peg = require('pegjs');

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
      files: ['build', 'dist']
    },
    concat: {
      options: {
        banner: '<%= banner %>',
        stripBanners: true
      },
      dist: {
        src: ['src/video-js-hls.js',
              'src/flv-tag.js',
              'src/exp-golomb.js',
              'src/h264-stream.js',
              'src/aac-stream.js',
              'src/segment-parser.js',
              'src/segment-controller.js',
              'src/m3u8/m3u8.js',
              'src/m3u8/m3u8-tag-types.js',
              'src/m3u8/m3u8-parser.js',
              'src/manifest-controller.js',
              'src/segment-controller.js',
              'src/hls-playback-controller.js'],
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
  });

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-qunit');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-watch');

  grunt.registerTask('peg', 'generate the manifest parser', function() {
    var parser = peg.buildParser(grunt.file.read('src/m3u8/m3u8.pegjs'));
    grunt.file.write('build/m3u8-parser.js',
                     'window.videojs.hls.M3U8Parser = ' + parser.toSource());
  });

  // Default task.
  grunt.registerTask('default',
                     ['peg',
                      'jshint',
                      'qunit',
                      'clean',
                      'concat',
                      'uglify']);

};

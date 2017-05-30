const sh = require('shelljs');
const rollup = require('rollup');
const babel = require('rollup-plugin-babel');
const resolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');
const json = require('rollup-plugin-json');
const filesize = require('rollup-plugin-filesize');
const progress = require('rollup-plugin-progress');
const ignore = require('rollup-plugin-ignore');

const args = { progress: false };

sh.rm('-rf', 'tmp/');
sh.cp('-R', 'src/', 'tmp/');
sh.rm('-rf', 'tmp/worker.js');

const br = sh.exec([
  'browserify src/worker.js',
  '-t babelify',
  '-p [ browserify-derequire ]',
  '-p [ bundle-collapser/plugin.js ]',
  '> tmp/worker.js'
].join(' '));

const primedResolve = resolve({
  jsnext: true,
  main: true,
  browser: true
});
const primedCjs = commonjs({
  sourceMap: false,
});
const primedBabel = babel({
  babelrc: false,
  exclude: 'node_modules/**',
  presets: [
    'es3',
    ['es2015', {
      loose: true,
      modules: false
    }]
  ],
  plugins: ['external-helpers']
});

const es = {
  options: {
    entry: 'tmp/videojs-contrib-hls.js',
    plugins: [
      primedResolve,
      json(),
      primedBabel,
      args.progress ? progress() : {},
      filesize()
    ],
    onwarn(warning) {
      if (warning.code === 'UNUSED_EXTERNAL_IMPORT' ||
          warning.code === 'UNRESOLVED_IMPORT') {
        return;
      }

      // eslint-disable-next-line no-console
      console.warn(warning.message);
    },
    legacy: true
  },
  format: 'es',
  dest: 'dist/videojs-contrib-hls.es.js'
};

const cjs = Object.assign({}, es, {
  format: 'cjs',
  dest: 'dist/videojs-contrib-hls.cjs.js'
});

const umd = {
  options: {
    entry: 'tmp/videojs-contrib-hls.js',
    plugins: [
      ignore([
        'videojs-contrib-media-sources/es5/codec-utils',
        'videojs-contrib-media-sources/es5/remove-cues-from-track.js',
      ]),
      primedResolve,
      json(),
      primedCjs,
      primedBabel,
      args.progress ? progress() : {},
      filesize()
    ],
    legacy: true,
    external: ['video.js']
  },
  globals: {
    'video.js': 'videojs'
  },
  format: 'umd',
  dest: 'dist/videojs-contrib-hls.umd.js'
};

function runRollup({options, format, globals, dest, banner}) {
  rollup.rollup(options)
  .then(function(bundle) {
    bundle.write({
      format,
      dest,
      banner,
      globals,
      moduleName: 'videojs-contrib-hls',
      sourceMap: false
    });
  }, function(err) {
    // eslint-disable-next-line no-console
    console.error(err);
  });
}

// runRollup(es);
// runRollup(cjs);
runRollup(umd);

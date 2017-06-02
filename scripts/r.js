import babel from 'rollup-plugin-babel';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import worker from 'rollup-plugin-bundle-worker';
import rollup from 'rollup';
import es3 from 'babel-preset-es3';
import es2015 from 'babel-preset-es2015';
import extHelp from 'babel-plugin-external-helpers';


const primedResolve = resolve({
  jsnext: true,
  main: true,
  browser: true
});
const primedCjs = commonjs({
  sourceMap: false,
  ignore: ['video.js']
});
const primedBabel = babel({
  babelrc: false,
  exclude: 'node_modules/**',
  presets: [
    es3,
    [es2015.buildPreset, {
      loose: true,
      modules: false
    }]
  ],
  plugins: [extHelp]
});

export default {
  entry: 'tmp/videojs-contrib-hls.js',
  // entry: 'src/decrypter-worker.js',
  moduleName: 'worker',
  format: 'es',
  plugins: [
    worker(),
    primedResolve,
    primedCjs,
    json(),
    primedBabel
  ],
  external: ['video.js'],
  globals: {'video.js': 'videojs'},
  dest: 'dist/hls.with.worker.js'
  // dest: 'tmp/decrypter-worker.js'
};

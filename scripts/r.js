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
  entry: 'src/worker.js',
  moduleName: 'worker',
  format: 'iife',
  plugins: [
    worker({
      rollup: rollup.rollup,
      options: {
        plugins: [
          json(),
          primedBabel
        ]
      }
    }),
    primedResolve,
    primedCjs,
    json(),
    primedBabel
  ],
  dest: 'dist/hls.worker.js'
};

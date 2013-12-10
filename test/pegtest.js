var fs = require('fs');
var path = require('path');
var manifest = fs.readFileSync(__dirname + '/fixtures/prog_index.m3u8').toString();
var parser = require('../src/m3u8/m3u8-generated.js');
var parsed = parser.parse(manifest);
console.log(parsed);

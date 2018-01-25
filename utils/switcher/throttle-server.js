#!/usr/bin/env node
'use strict';

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
let networkTrace = 'network-trace.txt';
const port = 9000;
let firstRequestTime;

if (Number.isFinite(process.argv[2])) {
  port = Number(process.argv[2]);
  if (process.argv[3]) {
    networkTrace = process.argv[3];
  }
} else if (process.argv[2]) {
  networkTrace = process.argv[2];
}

const throttleConfig = fs.readFileSync(networkTrace).toString()
                         .split('\n')
                         .map((line) =>
                            line.split(' ')
                              .slice(-2)
                              .map(Number));

// Just trust that this code works...
const getBytesForTimespan = (start, end) => {
  let acc = 0;
  let i = 0;
  let relativeStart = start - firstRequestTime;
  let duration = end - start;
  let bytesSent = 0;
  let tcLength =  throttleConfig.length;

  // Find start
  do {
    acc += throttleConfig[i % tcLength][1];
  } while (acc < relativeStart && ++i);

  let timeRemaining = acc - relativeStart;
  bytesSent = throttleConfig[i % tcLength][0] * (timeRemaining / throttleConfig[i % tcLength][1]);

  // Find end
  acc = timeRemaining - throttleConfig[i % tcLength][1];
  let j = i;
  do {
    acc += throttleConfig[j % tcLength][1];

    if (j > i) {
      bytesSent += throttleConfig[j % tcLength][0];
    }
  } while (acc < duration && ++j);

  let timeOverage = acc - duration;
  bytesSent -= throttleConfig[j % tcLength][0] * (timeOverage / throttleConfig[j % tcLength][1]);

  return Math.floor(bytesSent);
};

const writeSlowly = (req, res, data) => {
  let ended = false;
  let start = Date.now();

  req.on('close', () => {
    // request closed unexpectedly
    ended = true;
  });

  setTimeout(function writer(offset) {
    if (offset === null) {
      res.end();
      return;
    }
    if (ended) {
      console.log('request aborted by client');
      return;
    }

    let bytesToSend = getBytesForTimespan(start, Date.now());
    let chunkEnd = offset + bytesToSend;
    start = Date.now();

    if (chunkEnd >= data.length) {
      res.write(data.slice(offset));
      setTimeout(writer, 10, null);
    } else {
      res.write(data.slice(offset, chunkEnd));
      setTimeout(writer, 10, chunkEnd);
    }
  }, 1, 0);
};

// maps file extention to MIME type
// we only care about these two types
const map = {
  '.ts': 'video/MP2T',
  '.m3u8': 'application/x-mpegurl'
};

const setHeaders = (res, ext) => {
  // Website you wish to allow to connect
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Request methods you wish to allow
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  // Request headers you wish to allow
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)
  res.setHeader('Access-Control-Allow-Credentials', true);
  // Set the default to application/octet-stream in the event of a key request
  // With the exception of manifests, we should never be sending text
  res.setHeader('Content-type', map[ext] || 'application/octet-stream' );
};

http.createServer(function (req, res) {
  console.log(`${req.method} ${req.url}`);

  // parse URL
  const parsedUrl = url.parse(req.url);
  // extract URL path
  let pathname = `.${parsedUrl.pathname}`;
  // based on the URL path, extract the file extention. e.g. .js, .doc, ...
  const ext = path.parse(pathname).ext;

  fs.exists(pathname, function (exist) {
    if(!exist || fs.statSync(pathname).isDirectory()) {
      // if the file is not found, return 404
      res.statusCode = 404;
      res.end(`File ${pathname} not found!`);
      return;
    }

    // read file from file system
    fs.readFile(pathname, function(err, data){
      if(err){
        res.statusCode = 500;
        res.end(`Error getting the file: ${err}.`);
      } else {
        setHeaders(res, ext);
        if (ext === '.m3u8') {
          // if the file is found, set Content-type and send data
          res.end(data);
        } else {
          if (!firstRequestTime) {
            firstRequestTime = Date.now();
          }
          writeSlowly(req, res, data);
        }
      }
    });
  });
}).listen(parseInt(port));

console.log(`Server listening on port ${port}`);

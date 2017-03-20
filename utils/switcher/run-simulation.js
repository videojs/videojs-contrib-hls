import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse,
} from '../../test/test-helpers.js';

let simulationParams = {
  // the number of seconds of video in each segment
  segmentDuration: 10 // seconds
};

// the number of seconds it takes for a single bit to be
// transmitted from the client to the server, or vice-versa
const propagationDelay = 0.5;

// send a mock playlist response
const playlistResponse = (request) => {
  let match = request.url.match(/\d+/);
  let bitrate = match[0];

  let i = simulationParams.segmentCount;
  let response =
    '#EXTM3U\n' +
    '#EXT-X-PLAYLIST-TYPE:VOD\n' +
    '#EXT-X-TARGETDURATION:' + simulationParams.segmentDuration + '\n';

  while (i--) {
    response += '#EXTINF:' + simulationParams.segmentDuration + ',\n';
    response += bitrate + '-' + (simulationParams.segmentCount - i) + '.ts\n';
  }
  response += '#EXT-X-ENDLIST\n';

  return response;
};

const processBandwidthTrace = (traceText) => {
  return traceText.split('\n').map((line) => line.split(' ').slice(-2).map(Number));
}

// run the simulation
const runSimulation = function(options, done) {
  let networkTrace = processBandwidthTrace(options.networkTrace);
  let traceDurationInMs = networkTrace.reduce((acc, t) => acc + t[1], 0);
  simulationParams.segmentCount = Math.floor(traceDurationInMs / 1000 / simulationParams.segmentDuration);
  simulationParams.duration = simulationParams.segmentCount * simulationParams.segmentDuration;
  simulationParams.durationInMs = simulationParams.duration * 1000;

  // SETUP
  let results = {
    bandwidth: [],
    effectiveBandwidth: [],
    playlists: [],
    buffered: [],
    options: options
  };
  let env = useFakeEnvironment();

  // Sinon 1.10.2 handles abort incorrectly (triggering the error event)
  // Later versions fixed this but broke the ability to set the response
  // to an arbitrary object (in our case, a typed array).
  XMLHttpRequest.prototype = Object.create(XMLHttpRequest.prototype);
  XMLHttpRequest.prototype.abort = function abort() {
    this.aborted = true;
    this.response = this.responseText = '';
    this.errorFlag = true;
    this.requestHeaders = {};
    this.responseHeaders = {};

    if (this.readyState > 0 /*FakeXMLHttpRequest.UNSENT*/ && this.sendFlag) {
        this.readyStateChange(4); /*FakeXMLHttpRequest.DONE*/
        this.sendFlag = false;
    }

    this.readyState = 0; /*FakeXMLHttpRequest.UNSENT;*/
  };

  let clock = env.clock;
  let requests = env.requests;
  let mse = useFakeMediaSource();
  let buffered = 0;
  let currentTime = 0;
  let player = window.player = createPlayer();
  let poptions = player.options();
  poptions.hls.debug = true;
  player.options(poptions);
  document.querySelector('#qunit-fixture').style = 'display: none;';
  player.src({
    src: 'http://example.com/master.m3u8',
    type: 'application/x-mpegurl'
  });
  openMediaSource(player, clock);

  // run next tick so that Flash doesn't swallow exceptions
  let master = '#EXTM3U\n';
  options.playlists.forEach((bandwidth) => {
    master+= '#EXT-X-STREAM-INF:BANDWIDTH=' + bandwidth + '\n';
    master += 'playlist-' + bandwidth + '.m3u8\n';
  });

  // simulate buffered and currentTime during playback
  let getBuffer = (buff) => {
    return videojs.createTimeRange(0, currentTime + buffered);
  };
  player.tech_.buffered = getBuffer;

  Object.defineProperty(player.tech_, 'time_', {
    get: () => currentTime
  });

  // respond to the playlist requests
  let masterRequest = requests.shift();
  masterRequest.respond(200, null, master);

  let playlistRequest = requests.shift();
  playlistRequest.respond(200, null, playlistResponse(playlistRequest));

  let sourceBuffer = player.tech_.hls.mediaSource.sourceBuffers[0];
  Object.defineProperty(sourceBuffer, 'buffered', {
    get: getBuffer
  });

  // record the measured bandwidth for the playlist requests
  results.effectiveBandwidth.push({
    time: 0,
    bandwidth: player.tech_.hls.bandwidth
  });
  player.tech_.hls.masterPlaylistController_.mainSegmentLoader_.segmentMetadataTrack_ = null;
  player.play();

  let t = 0;
  let i = 0;
  let tInSeconds = 0;
  let segmentRequest = null;
  let segmentSize = null;
  let segmentDownloaded = 0;
  let segmentStartTime;

  console.log('Simulation Started for', simulationParams.duration, 'seconds');
  console.time('Simulation Ended');

  // advance time and collect simulation results
  while (t < simulationParams.durationInMs && i < networkTrace.length) {
    let intervalParams = {
      bytesTotal: networkTrace[i][0],
      bytesRemaining: networkTrace[i][0],
      // in milliseconds
      timeTotal: networkTrace[i][1],
      timeRemaining: networkTrace[i][1],
      // in bits per second
      bandwidth: Math.round((networkTrace[i][0] * 8) / (networkTrace[i][1] / 1000)),
      bytesPerMs: networkTrace[i][0] / networkTrace[i][1]
    };

    results.bandwidth.push({
      time: tInSeconds,
      bandwidth: intervalParams.bandwidth
    });

    for (let j = 1; j <= intervalParams.timeTotal; j++) {
      clock.tick(1);
      t += 1;
      tInSeconds = t / 1000;

      // simulate playback
      if (!player.paused() && buffered > 0 && buffered < j / 1000) {
        // Then buffered becomes zero and current time can only advance by
        // the buffer duration
        currentTime += buffered;
        buffered = 0;
        results.buffered.push({
          time: tInSeconds,
          buffered: buffered
        });
        intervalParams.timeRemaining -= j;
      }

      if (!segmentRequest && requests.length) {
        let request = requests.shift();

        // playlist responses
        if (/\.m3u8$/.test(request.url)) {
          // for simplicity, playlist responses have zero trasmission time
          request.respond(200, null, playlistResponse(request));
          continue;
        }

        segmentRequest = request;
        segmentSize = Math.ceil((segmentRequest.url.match(/(\d+)-\d+/)[1] * simulationParams.segmentDuration) / 8);
        segmentDownloaded = 0;
        segmentStartTime = tInSeconds;
      }

      if (segmentRequest) {
        segmentDownloaded += intervalParams.bytesPerMs;

        if (segmentRequest.timedout) {
          results.playlists.push({
            start: segmentStartTime,
            end: tInSeconds,
            duration: simulationParams.segmentDuration,
            bitrate: +segmentRequest.url.match(/(\d+)-\d+/)[1],
            timedout: true
          });
          results.effectiveBandwidth.push({
            time: (segmentStartTime + tInSeconds) / 2,
            bandwidth: player.tech_.hls.bandwidth
          });
          segmentRequest = null;
          segmentSize = null;
          console.error("Request for segment timedout");
          continue;
        }

        if (segmentRequest.aborted) {
          results.playlists.push({
            start: segmentStartTime,
            end: tInSeconds,
            duration: simulationParams.segmentDuration,
            bitrate: +segmentRequest.url.match(/(\d+)-\d+/)[1],
            aborted: true
          });
          results.effectiveBandwidth.push({
            time: (segmentStartTime + tInSeconds) / 2,
            bandwidth: player.tech_.hls.bandwidth
          });
          segmentRequest = null;
          segmentSize = null;
          console.error("Request for segment aborted");
          continue;
        }

        if (segmentDownloaded >= segmentSize) {
          if (!currentTime ||
               player.tech_.hls.masterPlaylistController_.mainSegmentLoader_.mediaIndex !== null) {
            buffered += simulationParams.segmentDuration;
          }
          segmentRequest.response = new Uint8Array(segmentSize);
          segmentRequest.respond(200, null, '');
          sourceBuffer.trigger('updateend');

          results.playlists.push({
            start: segmentStartTime,
            end: tInSeconds,
            duration: simulationParams.segmentDuration,
            bitrate: +segmentRequest.url.match(/(\d+)-\d+/)[1]
          });
          results.effectiveBandwidth.push({
            time: (segmentStartTime + tInSeconds) / 2,
            bandwidth: player.tech_.hls.bandwidth
          });

          segmentRequest = null;
          segmentSize = null;
        } else if (t % 250 === 0) {
          segmentRequest.dispatchEvent({
            type: 'progress',
            lengthComputable: true,
            target: segmentRequest,
            loaded: segmentDownloaded,
            total: segmentSize
          });
        }
      }
    }

    results.buffered.push({
      time: tInSeconds,
      buffered: buffered
    });

    let periodInSeconds = intervalParams.timeRemaining / 1000;

    // simulate playback
    if (!player.paused() && buffered > 0) {
      if (buffered < periodInSeconds) {
        // Then buffered becomes zero and current time can only advance by
        // the buffer duration
        currentTime += buffered;
        buffered = 0;
      } else {
        buffered -= periodInSeconds;
        currentTime +=  periodInSeconds;
      }
    }
    i += 1;
    player.trigger('timeupdate');
  }
  console.timeEnd('Simulation Ended');

  player.dispose();
  mse.restore();
  env.restore();

  console.log(results);
  done(null, results);
};

export default runSimulation;

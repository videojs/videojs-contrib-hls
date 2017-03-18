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
  let t = 0;
  let i = 0;
  let env = useFakeEnvironment();
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

  player.play();
  let tInSeconds = 0;
  let segmentRequest = null;

  // advance time and collect simulation results
  while (t < simulationParams.durationInMs && i < networkTrace.length) {
    let bytesTransferred = networkTrace[i][0];
    let period = networkTrace[i][1];
    let bandwidth = (bytesTransferred / period) * 8 * 1000;
    tInSeconds = t / 1000;
    let periodInSeconds = period / 1000;

    results.bandwidth.push({
      time: tInSeconds,
      bandwidth: bandwidth
    });
    let requestsCopy = requests.slice();
    requests.length = 0;
    // schedule response deliveries
    while (requestsCopy.length) {
      let request = requestsCopy.shift();

      // playlist responses
      if (/\.m3u8$/.test(request.url)) {
        // for simplicity, playlist responses have zero trasmission time
        request.respond(200, null, playlistResponse(request));
        continue;
      }

      // segment responses
      if ()
      segmentRequest = request;
      break;
      let segmentSize = Math.ceil((request.url.match(/(\d+)-\d+/)[1] * simulationParams.segmentDuration) / 8);

      //console.log(segmentSize);
      //console.log(bandwidth);
      console.log(request.url);

      let segmentProcessor = (localIndex, segmentDownloaded, segmentSize, start) => {
        if (request.aborted) {
          console.error("Request for segment aborted, download timedout")
          return;
        }

        segmentDownloaded += networkTrace[localIndex][0];

        if (segmentDownloaded < segmentSize) {
          request.dispatchEvent({
            type: 'progress',
            lengthComputable: true,
            target: request,
            loaded: segmentDownloaded,
            total: segmentSize
          });
          setTimeout(segmentProcessor, networkTrace[localIndex + 1][1], localIndex + 1, segmentDownloaded, segmentSize, start);
          return;
        }

        if (!player.tech_.hls.masterPlaylistController_.mainSegmentLoader_.hasPlayed_() ||
             player.tech_.hls.masterPlaylistController_.mainSegmentLoader_.mediaIndex !== null) {
          buffered += simulationParams.segmentDuration;
        }

        request.response = new Uint8Array(segmentSize);
        request.respond(200, null, '');
        sourceBuffer.trigger('updateend');

        results.playlists.push({
          start: start,
          end: tInSeconds,
          bitrate: +request.url.match(/(\d+)-\d+/)[1]
        });
        results.effectiveBandwidth.push({
          time: tInSeconds,
          bandwidth: player.tech_.hls.bandwidth
        });
      };
      setTimeout(segmentProcessor, 0, i, 0, segmentSize, tInSeconds);
      // console.log(`taking ${timeToTake}s for response`);
    }
    clock.tick(1);
    period -= 1;

    results.buffered.push({
      time: tInSeconds,
      buffered: buffered
    });

    // simulate playback
    if (buffered > 0) {
      if (buffered < periodInSeconds) {
        currentTime += buffered;
        buffered = 0;
      } else {
        buffered -= periodInSeconds;
        currentTime +=  periodInSeconds;
      }
    }
    i += 1;
    t += period;
    clock.tick(period);

    player.trigger('timeupdate');
  }

  player.dispose();
  mse.restore();
  env.restore();

  console.log(results);
  done(null, results);
};

export default runSimulation;

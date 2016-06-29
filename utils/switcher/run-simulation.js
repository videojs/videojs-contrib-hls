import {
  useFakeEnvironment,
  useFakeMediaSource,
  createPlayer,
  openMediaSource,
  standardXHRResponse,
} from '../../test/test-helpers.js';

// the number of seconds of video in each segment
const segmentDuration = 9; // seconds

// the number of segments in the video
const segmentCount = 100;

// the length of the simulation
const duration = segmentDuration * segmentCount;

// the number of seconds it takes for a single bit to be
// transmitted from the client to the server, or vice-versa
const propagationDelay = 0.5;

// send a mock playlist response
const playlistResponse = function(request) {
  let match = request.url.match(/\d+/);
  let bitrate = match[0];

  let i = segmentCount;
  let response =
    '#EXTM3U\n' +
    '#EXT-X-PLAYLIST-TYPE:VOD\n' +
    '#EXT-X-TARGETDURATION:' + segmentDuration + '\n';

  while (i--) {
    response += '#EXTINF:' + segmentDuration + ',\n';
    response += bitrate + '-' + (segmentCount - i) + '.ts\n';
  }
  response += '#EXT-X-ENDLIST\n';

  return response;
};

// run the simulation
const runSimulation = function(options, done) {
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

  options.bandwidths.sort(function(left, right) {
    return left.time - right.time;
  });

  // respond to the playlist requests
  let masterRequest = requests.shift();
  masterRequest.bandwidth = options.bandwidths[0].bandwidth;
  masterRequest.respond(200, null, master);

  let playlistRequest = requests.shift();
  playlistRequest.bandwidth = options.bandwidths[0].bandwidth;
  playlistRequest.respond(200, null, playlistResponse(playlistRequest));

  let sourceBuffer = player.tech_.hls.mediaSource.sourceBuffers[0];
  Object.defineProperty(sourceBuffer, 'buffered', {
    get: () => buffered
  });

  // record the measured bandwidth for the playlist requests
  results.effectiveBandwidth.push({
    time: 0,
    bandwidth: player.tech_.hls.bandwidth
  });

  // advance time and collect simulation results
  for (t = i = 0; t < duration; clock.tick(1000), t++) {
    while (options.bandwidths[i + 1] && options.bandwidths[i + 1].time <= t) {
      i++;
    }
    let bandwidth = options.bandwidths[i].bandwidth;
    results.bandwidth.push({
      time: t,
      bandwidth: bandwidth
    });

    // schedule response deliveries
    while (requests.length) {
      let request = requests.shift();
      request.bandwidth = bandwidth;

      // playlist responses
      if (/\.m3u8$/.test(request.url)) {
        // for simplicity, playlist responses have zero trasmission time
        request.respond(200, null, playlistResponse(request));
        continue;
      }

      // segment responses
      let segmentSize = request.url.match(/(\d+)-\d+/)[1] * segmentDuration;

      //console.log(segmentSize);
      //console.log(bandwidth);
      console.log(request.url);
      let timeToTake = segmentSize/bandwidth + (propagationDelay * 1);

      setTimeout(() => {
        if (request.aborted) {
          console.error("Request for segment aborted, download timedout")
          return;
        }

        request.response = new Uint8Array(segmentSize * 0.125);
        request.respond(200, null, '');
        sourceBuffer.trigger('updateend');

        results.playlists.push({
          time: t,
          bitrate: +request.url.match(/(\d+)-\d+/)[1]
        });

        buffered += segmentDuration;
        results.effectiveBandwidth.push({
          time: t,
          bandwidth: player.tech_.hls.bandwidth
        });
      }, timeToTake * 1000);
      // console.log(`taking ${timeToTake}s for response`);
    }

    results.buffered.push({
      time: t,
      buffered: buffered
    });

    // simulate playback
    if (buffered > 0) {
      buffered--;
      currentTime++;
    }
    player.trigger('timeupdate');
  }

  // update the fragment identifier so this scenario can be re-run easily
  window.location.hash = '#' + options.bandwidths.map(function(interval) {
    return 't' + interval.time + '=' + interval.bandwidth;
  }).join('&');

  player.dispose();
  mse.restore();
  env.restore();

  console.log(results);
  done(null, results);
};

export default runSimulation;

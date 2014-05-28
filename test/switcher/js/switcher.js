(function(window, document) {
  'use strict';
  var segmentDuration = 9, // seconds
      segmentCount = 100,
      duration = segmentDuration * segmentCount,
      propagationDelay = 1,

      runSimulation,
      playlistResponse,
      player,
      runButton,
      parameters,
      addTimePeriod,
      networkTimeline,
      timePeriod,
      timeline,

      displayTimeline;

  // mock out the environment and dependencies
  videojs.options.flash.swf = '../../node_modules/video.js/dist/video-js/video-js.swf';
  videojs.Hls.SegmentParser = function() {
    this.getFlvHeader = function() {
      return new Uint8Array([]);
    };
    this.parseSegmentBinaryData = function() {};
    this.flushTags = function() {};
    this.tagsAvailable = function() {
      return false;
    };
  };

  // a dynamic number of time-bandwidth pairs may be defined to drive the simulation
  addTimePeriod = document.querySelector('.add-time-period');
  networkTimeline = document.querySelector('.network-timeline');
  timePeriod = networkTimeline.cloneNode(true);
  addTimePeriod.addEventListener('click', function() {
    var clone = timePeriod.cloneNode(true),
        fragment = document.createDocumentFragment(),
        count = networkTimeline.querySelectorAll('input.bandwidth').length,
        time = clone.querySelector('.time'),
        bandwidth = clone.querySelector('input.bandwidth');

    time.name = 'time' + count;
    bandwidth.name = 'bandwidth' + count;
    while (clone.childNodes.length) {
      fragment.appendChild(clone.childNodes[0]);
    }
    networkTimeline.appendChild(fragment);
  });

  // collect the simulation parameters
  parameters = function() {
    var times = Array.prototype.slice.call(document.querySelectorAll('.time')),
        bandwidths = document.querySelectorAll('input.bandwidth'),
        playlists = Array.prototype.slice.call(document.querySelectorAll('input.bitrate'));

    return {
      playlists: playlists.map(function(input) {
        return +input.value;
      }),
      bandwidths: times.reduce(function(conditions, time, i) {
        return conditions.concat({
          time: +time.value,
          bandwidth: +bandwidths[i].value
        });
      }, [])
    };
  };

  // send a mock playlist response
  playlistResponse = function(bitrate) {
    var i = segmentCount,
        response = '#EXTM3U\n';

    while (i--) {
      response += '#EXTINF:' + segmentDuration + ',\n';
      response += bitrate + '-' + (segmentCount - i) + '\n';
    }
    response += '#EXT-X-ENDLIST\n';

    return response;
  };

  // run the simulation
  runSimulation = function(options, done) {
    var results = [],
        bandwidths = options.bandwidths,
        fixture = document.getElementById('fixture'),

        realSetTimeout = window.setTimeout,
        clock,
        fakeXhr,
        requests,
        video,
        t = 0,
        i = 0;

    // clean up the last run if necessary
    if (player) {
      player.dispose();
    };


    // mock out the environment
    clock = sinon.useFakeTimers();
    fakeXhr = sinon.useFakeXMLHttpRequest();
    requests = [];
    fakeXhr.onCreate = function(xhr) {
      xhr.startTime = t;
      requests.push(xhr);
    };

    // initialize the HLS tech
    fixture.innerHTML = '';
    video = document.createElement('video');
    fixture.appendChild(video);
    player = videojs(video, {
      techOrder: ['hls'],
      sources: [{
        src: 'http://example.com/master.m3u8',
        type: 'application/x-mpegurl'
      }]
    });

    player.ready(function() {
      // run next tick so that Flash doesn't swallow exceptions
      realSetTimeout(function() {
        var master = '#EXTM3U\n' +
              options.playlists.reduce(function(playlists, value) {
                return playlists +
                  '#EXT-X-STREAM-INF:' + value + '\n' +
                  'playlist-' + value + '\n';
              }, ''),
            buffered = 0,
            currentTime = 0;

        // mock out buffered and currentTime
        player.buffered = function() {
          return videojs.createTimeRange(0, currentTime + buffered);
        };
        player.currentTime = function() {
          return currentTime;
        };

        // respond to the playlist requests
        requests.shift().respond(200, null, master);
        requests[0].respond(200, null, playlistResponse(+requests[0].url.match(/\d+$/)));
        requests.shift();

        bandwidths.sort(function(left, right) {
          return left.time - right.time;
        });

        // advance time and collect simulation results
        for (t = i = 0; t < duration; clock.tick(1 * 1000), t++) {

          // determine the bandwidth value at this moment
          while (bandwidths[i + 1] && bandwidths[i + 1].time <= t) {
            i++;
          }
          results.push({
            time: t,
            bandwidth: bandwidths[i].bandwidth
          });

          // deliver responses if they're ready
          requests = requests.reduce(function(remaining, request) {
            var arrival = request.startTime + propagationDelay,
                delivered = Math.max(0, bandwidths[i].bandwidth * (t - arrival)),
                playlist = /playlist-\d+$/.test(request.url),
                segmentSize = +request.url.match(/(\d+)-\d+$/)[1] * segmentDuration;

            // playlist responses
            if (playlist) {
              // playlist responses have no trasmission time
              if (t === arrival) {
                request.respond(200, null, playlistResponse(+requests[0].url.match(/\d+$/)));
                return remaining;
              }
              // the response has not arrived. re-enqueue it for later.
              return remaining.concat(request);
            }

            // segment responses
            if (delivered > segmentSize) {
              // segment responses are delivered after the propagation
              // delay and the transmission time have elapsed
              buffered += segmentDuration;
              request.status = 200;
              request.response = new Uint8Array(segmentSize);
              request.setResponseBody('');
              return remaining;
            } else {
              if (t === arrival) {
                // segment response headers arrive after the propogation delay
                request.setResponseHeaders({
                  'Content-Type': 'video/mp2t'
                });
              }
              // the response has not arrived fully. re-enqueue it for
              // later
              return remaining.concat(request);
            }
          }, []);

          // simulate playback
          if (buffered > 0) {
            buffered--;
            currentTime++;
          }
          player.trigger('timeupdate');
        }

        // restore the environment
        clock.restore();
        fakeXhr.restore();

        done(null, results);
      }, 0);
    });
  };
  runButton = document.getElementById('run-simulation');
  runButton.addEventListener('click', function() {
    runSimulation(parameters(), displayTimeline);
  });

  // render the timeline with d3
  timeline = document.querySelector('.timeline');
  timeline.innerHTML = '';
  (function() {
    var margin = {
          top: 20,
          right: 80,
          bottom: 30,
          left: 50
        },
        width = 960 - margin.left - margin.right,
        height = 500 - margin.top - margin.bottom,
        svg;
    svg = d3.select('.timeline').append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
    .append('g')
      .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    displayTimeline = function(error, bandwidth) {
      var x = d3.scale.linear().range([0, width]),
          y = d3.scale.linear().range([height, 0]),

          xAxis = d3.svg.axis().scale(x).orient('bottom'),
          yAxis = d3.svg.axis().scale(y).orient('left'),

          line = d3.svg.line()
            .interpolate('basis')
            .x(function(data) {
              return x(data.time);
            })
            .y(function(data) {
              return y(data.bandwidth);
            });

      x.domain(d3.extent(bandwidth, function(data) {
        return data.time;
      }));
      y.domain([0, d3.max(bandwidth, function(data) {
        return data.bandwidth;
      })]);

      // draw the new timeline
      svg.selectAll('.axis').remove();
      svg.append('g')
        .attr('class', 'x axis')
        .attr('transform', 'translate(0,' + height + ')')
        .call(xAxis);

      svg.append('g')
        .attr('class', 'y axis')
        .call(yAxis)
      .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', 6)
        .attr('dy', '.71em')
        .style('text-anchor', 'end')
        .text('Bandwidth (b/s)');

      svg.selectAll('.bandwidth').remove();
      svg.append('path')
        .datum(bandwidth)
        .attr('class', 'line bandwidth')
        .attr('d', line);
    };
  })();

  runSimulation(parameters(), displayTimeline);

})(window, document);

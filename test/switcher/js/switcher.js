(function(window, document) {
  'use strict';
  var segmentDuration = 9, // seconds
      segmentCount = 100,
      duration = segmentDuration * segmentCount,
      propagationDelay = 0.5,

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
    var results = {
          bandwidth: [],
          effectiveBandwidth: [],
          playlists: [],
          buffered: [],
          options: options
        },
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
      xhr.startTime = +new Date();
      xhr.delivered = 0;
      requests.push(xhr);
    };

    // initialize the HLS tech
    fixture.innerHTML = '';
    video = document.createElement('video');
    video.className = 'video-js vjs-default-skin';
    video.controls = true;
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
                  '#EXT-X-STREAM-INF:BANDWIDTH=' + value + '\n' +
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

        // pre-calculate the bandwidth at each second
        for (t = i = 0; t < duration; t++) {
          while (bandwidths[i + 1] && bandwidths[i + 1].time <= t) {
            i++;
          }
          results.bandwidth.push({
            time: t,
            bandwidth: bandwidths[i].bandwidth
          });
        }

        // advance time and collect simulation results
        for (t = 0; t < duration; clock.tick(1000), t++) {
          // schedule response deliveries
          while (requests.length) {
            (function(request) {
              var segmentSize;

              // playlist responses
              if (/playlist-\d+$/.test(request.url)) {
                // for simplicity, playlist responses have zero trasmission time
                return setTimeout(function() {
                  request.respond(200, null, playlistResponse(+request.url.match(/\d+$/)));
                }, propagationDelay * 1000);
              }

              // segment responses
              segmentSize = +request.url.match(/(\d+)-\d+$/)[1] * segmentDuration;
              // segment response headers arrive after the propogation delay
              setTimeout(function() {
                var arrival = Math.ceil(+new Date() * 0.001);
                results.playlists.push({
                  time: arrival,
                  bitrate: +request.url.match(/(\d+)-\d+$/)[1]
                });
                request.setResponseHeaders({
                  'Content-Type': 'video/mp2t'
                });

                results.bandwidth.slice(arrival).every(function(value, i) {
                  var remaining = segmentSize - request.delivered;
                  if (remaining - value.bandwidth <= 0) {
                    // send the response body once all bytes have been delivered
                    setTimeout(function() {
                      buffered += segmentDuration;
                      request.status = 200;
                      request.response = new Uint8Array(segmentSize * 0.125);
                      request.setResponseBody('');
                      results.effectiveBandwidth.push({
                        time: Math.ceil(+new Date() * 0.001),
                        bandwidth: player.hls.bandwidth
                      });
                    }, ((remaining / value.bandwidth) + i) * 1000);
                    return false;
                  }
                  // record the bits for this tick
                  request.delivered += value.bandwidth;
                  return true;
                });
              }, propagationDelay * 1000);
            })(requests.shift());
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

    displayTimeline = function(error, data) {
      var x = d3.scale.linear().range([0, width]),
          y = d3.scale.linear().range([height, 0]),

          timeAxis = d3.svg.axis().scale(x).orient('bottom'),
          tickFormatter = d3.format(',.0f'),
          bitrateAxis = d3.svg.axis()
            .scale(y)
            .tickFormat(function(value) {
              return tickFormatter(value / 1024);
            })
            .orient('left'),

          bandwidthLine = d3.svg.line()
            .interpolate('basis')
            .x(function(data) {
              return x(data.time);
            })
            .y(function(data) {
              return y(data.bandwidth);
            }),
          effectiveBandwidthLine = d3.svg.line()
            .interpolate('basis')
            .x(function(data) {
              return x(data.time);
            })
            .y(function(data) {
              return y(data.bandwidth);
            });

      x.domain(d3.extent(data.bandwidth, function(data) {
        return data.time;
      }));
      y.domain([0, Math.max(d3.max(data.bandwidth, function(data) {
        return data.bandwidth;
      }), d3.max(data.options.playlists))]);

      // time axis
      svg.selectAll('.axis').remove();
      svg.append('g')
        .attr('class', 'x axis')
        .attr('transform', 'translate(0,' + height + ')')
        .call(timeAxis);

      // bitrate axis
      svg.append('g')
        .attr('class', 'y axis')
        .call(bitrateAxis)
      .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', 6)
        .attr('dy', '.71em')
        .style('text-anchor', 'end')
        .text('Bitrate (kb/s)');

      // playlist bitrate lines
      svg.selectAll('.line.bitrate')
        .data(data.options.playlists)
      .enter().append('path')
        .attr('class', 'line bitrate')
        .attr('d', function(playlist) {
          return 'M0,' + y(playlist) + 'L' + width + ',' + y(playlist);
        });

      // bandwidth line
      svg.selectAll('.bandwidth').remove();
      svg.append('path')
        .datum(data.bandwidth)
        .attr('class', 'line bandwidth')
        .attr('d', bandwidthLine);
      svg.selectAll('.effective-bandwidth').remove();
      svg.append('path')
        .datum(data.effectiveBandwidth)
        .attr('class', 'line effective-bandwidth')
        .attr('d', effectiveBandwidthLine);

      svg.append('text')
        .attr('class', 'bandwidth label')
        .attr('transform', 'translate(' + x(x.range()[1]) + ', ' + y(data.bandwidth.slice(-1)[0].bandwidth) + ')')
        .attr('dy', '1.35em')
        .text('bandwidth');
      svg.append('text')
        .attr('class', 'bandwidth label')
        .attr('transform', 'translate(' + x(x.range()[1]) + ', ' + y(data.effectiveBandwidth.slice(-1)[0].bandwidth) + ')')
        .attr('dy', '1.35em')
        .text('measured');

      // segment bitrate dots
      svg.selectAll('.segment-bitrate').remove();
      svg.selectAll('.segment-bitrate')
        .data(data.playlists)
      .enter().append('circle')
        .attr('class', 'dot segment-bitrate')
        .attr('r', 3.5)
        .attr('cx', function(playlist) {
          return x(playlist.time);
        })
        .attr('cy', function(playlist) {
          return y(playlist.bitrate);
        });
    };
  })();

  runSimulation(parameters(), displayTimeline);

})(window, document);

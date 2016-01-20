(function(window, document) {
  'use strict';

      // the number of seconds of video in each segment
  var segmentDuration = 9, // seconds

      // the number of segments in the video
      segmentCount = 100,

      // the length of the simulation
      duration = segmentDuration * segmentCount,

      // the number of seconds it takes for a single bit to be
      // transmitted from the client to the server, or vice-versa
      propagationDelay = 0.5,

      runSimulation,
      playlistResponse,
      player,
      runButton,
      parameters,
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
    this.metadataStream = {
      on: function() {}
    };
  };

  // a dynamic number of time-bandwidth pairs may be defined to drive the simulation
  (function() {
    var params,
        networkTimeline = document.querySelector('.network-timeline'),
        timePeriod = networkTimeline.querySelector('li:last-child').cloneNode(true),
        appendTimePeriod = function() {
          var clone = timePeriod.cloneNode(true),
              count = networkTimeline.querySelectorAll('input.bandwidth').length,
              time = clone.querySelector('.time'),
              bandwidth = clone.querySelector('input.bandwidth');

          time.name = 'time' + count;
          bandwidth.name = 'bandwidth' + count;
          networkTimeline.appendChild(clone);
        };
    document.querySelector('.add-time-period')
      .addEventListener('click', appendTimePeriod);

    // apply any simulation parameters that were set in the fragment identifier
    if (!window.location.hash) {
      return;
    }

    // time periods are specified as t<seconds>=<bitrate>
    // e.g. #t15=450560&t150=65530
    params = window.location.hash.substring(1)
      .split('&')
      .map(function(param) {
        return ((/t(\d+)=(\d+)/i).exec(param) || [])
          .map(window.parseFloat).slice(1);
      }).filter(function(pair) {
        return pair.length === 2;
      });

    networkTimeline.innerHTML = '';
    params.forEach(function(param) {
      appendTimePeriod();
      networkTimeline.querySelector('li:last-child .time').value = param[0];
      networkTimeline.querySelector('li:last-child input.bandwidth').value = param[1];
    });
  })();

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
    videojs.xhr.XMLHttpRequest = fakeXhr;
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

        // simulate buffered and currentTime during playback
        player.buffered = function() {
          return videojs.createTimeRange(0, currentTime + buffered);
        };
        player.currentTime = function() {
          return currentTime;
        };

        bandwidths.sort(function(left, right) {
          return left.time - right.time;
        });

        // respond to the playlist requests
        requests[0].bandwidth = bandwidths[0].bandwidth;
        requests.shift().respond(200, null, master);
        requests[0].bandwidth = bandwidths[0].bandwidth;
        requests[0].respond(200, null, playlistResponse(+requests[0].url.match(/\d+$/)));
        requests.shift();

        // record the measured bandwidth for the playlist requests
        results.effectiveBandwidth.push({
          time: 0,
          bandwidth: player.hls.bandwidth
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
                request.setResponseHeaders({
                  'Content-Type': 'video/mp2t'
                });

                results.bandwidth.slice(arrival).every(function(value, i) {
                  var remaining = segmentSize - request.delivered;
                  if (remaining - value.bandwidth <= 0) {
                    // send the response body once all bytes have been delivered
                    setTimeout(function() {
                      var time = Math.ceil(+new Date() * 0.001);
                      if (request.aborted) {
                        return;
                      }
                      request.status = 200;
                      request.response = new Uint8Array(segmentSize * 0.125);
                      request.setResponseBody('');

                      results.playlists.push({
                        time: time,
                        bitrate: +request.url.match(/(\d+)-\d+$/)[1]
                      });
                      // update the buffered value
                      buffered += segmentDuration;
                      results.buffered[results.buffered.length - 1].buffered = buffered;
                      results.effectiveBandwidth.push({
                        time: time,
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

        // update the fragment identifier so this scenario can be re-run easily
        window.location.hash = '#' + options.bandwidths.map(function(interval) {
          return 't' + interval.time + '=' + interval.bandwidth;
        }).join('&');

        done(null, results);
      }, 0);
    });
    /// trigger the ready function through set timeout
    clock.tick(1);
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
      }), d3.max(data.options.playlists), d3.max(data.playlists, function(data) {
        return data.bitrate;
      }))]);

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
      svg.selectAll('.line.bitrate').remove();
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

      // highlight intervals when the buffer is empty
      svg.selectAll('.buffer-empty').remove();
      svg.selectAll('.buffer-empty')
        .data(data.buffered.reduce(function(result, sample) {
          var last = result[result.length - 1];
          if (sample.buffered === 0) {
            if (last && sample.time === last.end + 1) {
              // add this sample to the interval we're accumulating
              return result.slice(0, result.length - 1).concat({
                start: last.start,
                end: sample.time
              });
            } else {
              // this sample starts a new interval
              return result.concat({
                start: sample.time,
                end: sample.time
              });
            }
          }
          // filter out time periods where the buffer isn't empty
          return result;
        }, []))
        .enter().append('rect')
        .attr('class', 'buffer-empty')
        .attr('x', function(data) {
          return x(data.start);
        })
        .attr('width', function(data) {
          return x(1 + data.end - data.start);
        })
        .attr('y', 0)
        .attr('height', y(height));
    };
  })();

  runSimulation(parameters(), displayTimeline);

})(window, document);

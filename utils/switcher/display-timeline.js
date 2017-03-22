// render the timeline with d3
let timeline = document.querySelector('.timeline');
timeline.innerHTML = '';

let margin = {
  top: 20,
  right: 80,
  bottom: 30,
  left: 50
};
let width = 1960 - margin.left - margin.right;
let height = 500 - margin.top - margin.bottom;
let svg = d3.select('.timeline').append('svg')
  .attr('width', width + margin.left + margin.right)
  .attr('height', height + margin.top + margin.bottom)
.append('g')
  .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');


const displayTimeline = function(error, data) {
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
        .interpolate('linear')
        .x(function(data) {
          return x(data.time);
        })
        .y(function(data) {
          return y(data.bandwidth);
        }),
      effectiveBandwidthLine = d3.svg.line()
        .interpolate('monotone')
        .x(function(data) {
          return x(data.time);
        })
        .y(function(data) {
          return y(data.bandwidth);
        }),
      bufferedLine = d3.svg.line()
        .interpolate('linear')
        .x(function(data) {
          return x(data.time);
        })
        .y(function(data) {
          return y(data.buffered * 10000);
        });

  x.domain(d3.extent(data.bandwidth, function(data) {
    return data.time;
  }));
  y.domain([0, Math.min(5000000, Math.max(d3.max(data.bandwidth, function(data) {
    return data.bandwidth;
  }), d3.max(data.options.playlists.map((p)=>p[0])), d3.max(data.playlists, function(data) {
    return data.bitrate;
  })))]);

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
      return 'M0,' + y(playlist[0]) + 'L' + width + ',' + y(playlist[0]);
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
    .enter().append('rect')
    .attr('class', 'dot segment-bitrate')
    .attr('x', function(data) {
      return x(data.start);
    })
    .attr('width', function(data) {
      return x(1 + data.end - data.start);
    })
    .attr('y', function(data) {
      return y(data.bitrate) - 3;
    })
    .attr('height', 6)
    .classed('timedout', function(data) {
      return data.timedout;
    })
    .classed('aborted', function(data) {
      return data.aborted;
    })
    .classed('long', function(data) {
      return data.end - data.start > data.duration;
    });
/*
  .enter().append('circle')
    .attr('class', 'dot segment-bitrate')
    .attr('r', 3.5)
    .attr('cx', function(playlist) {
      return x(playlist.time);
    })
    .attr('cy', function(playlist) {
      return y(playlist.bitrate);
    });
*/

  // highlight intervals when the buffer is empty
  svg.selectAll('.buffered').remove();
  svg.append('path')
    .datum(data.buffered)
    .attr('class', 'line buffered')
    .attr('d', bufferedLine);

  svg.selectAll('.buffer-empty').remove();
  svg.selectAll('.buffer-empty')
    .data(data.buffered.reduce(function(result, sample, index) {
      var last = result[result.length - 1];

      if (sample.buffered === 0) {
        if (last && last.index === index - 1) {
          // add this sample to the interval we're accumulating
          last.end = sample.time;
          last.index = index;
        } else {
          // this sample starts a new interval
          result.push({
            start: sample.time,
            end: sample.time,
            index: index
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

export default displayTimeline;

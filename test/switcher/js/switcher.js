(function(window, document) {
  'use strict';
  var duration = 9 * 100,

      runSimulation,
      runButton,
      parameters,
      addTimePeriod,
      networkTimeline,
      timePeriod,
      timeline,

      displayTimeline;

  // a dynamic number of time-bandwidth pairs may be defined to drive the simulation
  addTimePeriod = document.querySelector('.add-time-period');
  networkTimeline = document.querySelector('.network-timeline');
  timePeriod = networkTimeline.cloneNode(true);
  addTimePeriod.addEventListener('click', function() {
    var clone = timePeriod.cloneNode(true),
        fragment = document.createDocumentFragment(),
        count = networkTimeline.querySelectorAll('.bandwidth').length,
        time = clone.querySelector('.time'),
        bandwidth = clone.querySelector('.bandwidth');

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
        bandwidths = document.querySelectorAll('.bandwidth');

    return times.reduce(function(conditions, time, i) {
      return conditions.concat({
        time: +time.value,
        bandwidth: +bandwidths[i].value
      });
    }, []);
  };

  // run the simulation
  runSimulation = function(options) {
    var results = [],
        t,
        i;

    options.sort(function(left, right) {
      return left.time - right.time;
    });

    for (t = i = 0; t < duration; t++) {
      while (options[i + 1] && options[i + 1].time <= t) {
        i++;
      }
      results.push({
        time: t,
        bandwidth: options[i].bandwidth
      });
    }
    return results;
  };
  runButton = document.getElementById('run-simulation');
  runButton.addEventListener('click', function() {
    displayTimeline(runSimulation(parameters()));
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

    displayTimeline = function(bandwidth) {
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

      svg.append('path')
        .datum(bandwidth)
        .attr('class', 'line bandwidth')
        .attr('d', line);
    };
  })();

  
  displayTimeline(runSimulation(parameters()));
  
})(window, document);

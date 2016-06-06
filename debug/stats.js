(function(window, videojs, undefined) {
  'use strict';

  // -------------
  // Initial Setup
  // -------------

  var d3 = window.d3;

  var bitrateTickFormatter = d3.format(',.0f');

  var updateBitrateAxes = function(svg, xScale, yScale) {
    var xAxis = d3.svg.axis().scale(xScale).orient('bottom');
    svg.select('.axis.x')
      .transition().duration(500)
      .call(xAxis);

    var yAxis = d3.svg.axis().scale(yScale)
        .tickFormat(function(value) {
          return bitrateTickFormatter(value / 1024);
        }).orient('left');
    svg.select('.axis.y')
      .transition().duration(500)
      .call(yAxis);
  };

  var updateBitrates = function(svg, x, y, measuredBitrateKbps) {
    var bitrates, line;

    bitrates = svg.selectAll('.bitrates').datum(measuredBitrateKbps);
    line = d3.svg.line()
      .x(function(bitrate) { return x(bitrate.time); })
      .y(function(bitrate) { return y(bitrate.value); });

    bitrates.transition().duration(500).attr('d', line);
  };

  var setupGraph = function(element, player) {
    // setup the display
    var margin = {
      top: 20,
      right: 80,
      bottom: 30,
      left: 50
    };
    var width = 600 - margin.left - margin.right;
    var height = 300 - margin.top - margin.bottom;
    var svg = d3.select(element)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // setup the timeline
    var x = d3.time.scale().range([0, width]); // d3.scale.linear().range([0, width]);
    var y = d3.scale.linear().range([height, 0]);

    x.domain([new Date(), new Date(Date.now() + (1 * 60 * 1000))]);
    y.domain([0, 5 * 1024 * 1024 * 8]);

    var timeAxis = d3.svg.axis().scale(x).orient('bottom');
    var bitrateAxis = d3.svg.axis()
        .scale(y)
        .tickFormat(function(value) {
          return bitrateTickFormatter(value / 1024);
        })
        .orient('left');

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

    svg.append('path')
      .attr('class', 'bitrates');

    var measuredBitrateKbps = [{
      time: new Date(),
      value: player.tech_.hls.bandwidth || 0
    }];

    player.on('progress', function() {
      measuredBitrateKbps.push({
        time: new Date(),
        value: player.tech_.hls.bandwidth || 0
      });
      x.domain([x.domain()[0], new Date()]);
      y.domain([0, d3.max(measuredBitrateKbps, function(bitrate) {
        return bitrate.value;
      })]);
      updateBitrateAxes(svg, x, y);
      updateBitrates(svg, x, y, measuredBitrateKbps);
    });
  };

  // ---------------
  // Dynamic Updates
  // ---------------

  var displayStats = function(element, player) {
    setupGraph(element, player);
  };

  // -----------------
  // Cue Visualization
  // -----------------

  var Playlist = videojs.Hls.Playlist;
  var margin = {
    top: 8,
    right: 8,
    bottom: 20,
    left: 80
  };
  var width = 600 - margin.left - margin.right;
  var height = 600 - margin.top - margin.bottom;

  var mediaDomain = function(media, player) {
    var segments = media.segments;
    var end = player.tech_.hls.playlists.expiredPreDiscontinuity_;
    end += player.tech_.hls.playlists.expiredPostDiscontinuity_;
    end += Playlist.duration(media,
                             media.mediaSequence,
                             media.mediaSequence + segments.length);
    return [0, end];
  };
  var ptsDomain = function(segments, mediaScale, mediaOffset) {
    mediaOffset = mediaOffset * 1000 || 0;
    var start = mediaScale.domain()[0] * 1000;
    var segment = segments[0];

    if (segment &&
        segment.minAudioPts !== undefined ||
        segment.minVideoPts !== undefined) {
      start = Math.min(segment.minAudioPts || Infinity,
                       segment.minVideoPts || Infinity);
    }
    start -= mediaOffset;
    return [
      start,
      (mediaScale.domain()[1] - mediaScale.domain()[0]) * 1000 + start
    ];
  };
  var svgUpdateCues = function(svg, mediaScale, ptsScale, y, cues) {
    cues = Array.prototype.slice.call(cues).filter(function(cue) {
      return cue.startTime > mediaScale.domain()[0] &&
        cue.startTime < mediaScale.domain()[1];
    });
    var points = svg.selectAll('.cue').data(cues, function(cue) {
      return cue.pts_ + ' -> ' + cue.startTime;
    });
    points.attr('transform', function(cue) {
      return 'translate(' + mediaScale(cue.startTime) + ',' + ptsScale(cue.pts_) + ')';
    });
    var enter = points.enter().append('g')
      .attr('class', 'cue');
    enter.append('circle')
      .attr('r', 5)
      .attr('data-time', function(cue) {
        return cue.startTime;
      })
      .attr('data-pts', function(cue) {
        return cue.pts_;
      });
    enter.append('text')
      .attr('transform', 'translate(8,0)')
      .text(function(cue) {
        return 'time: ' + videojs.formatTime(cue.startTime);
      });
    enter.append('text')
      .attr('transform', 'translate(8,16)')
      .text(function(cue) {
        return 'pts: ' + cue.pts_;
      });
    points.exit().remove();
  };
  var svgUpdateAxes = function(svg, mediaScale, ptsScale) {
    // media timeline axis
    var mediaAxis = d3.svg.axis().scale(mediaScale).orient('bottom');
    svg.select('.axis.media')
      .transition().duration(500)
      .call(mediaAxis);

    // presentation timeline axis
    if (!isFinite(ptsScale.domain()[0]) || !isFinite(ptsScale.domain()[1])) {
      return;
    }
    var ptsAxis = d3.svg.axis().scale(ptsScale).orient('left');
    svg.select('.axis.presentation')
      .transition().duration(500)
      .call(ptsAxis);
  };
  var svgRenderSegmentTimeline = function(container, player) {
    var media = player.tech_.hls.playlists.media();
    var segments = media.segments; // media.segments.slice(0, count);

    // setup the display
    var svg = d3.select(container)
        .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
        .append('g')
          .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // setup the scales
    var mediaScale = d3.scale.linear().range([0, width]);
    mediaScale.domain(mediaDomain(media, player));
    var ptsScale = d3.scale.linear().range([height, 0]);
    ptsScale.domain(ptsDomain(segments, mediaScale));

    // render
    var mediaAxis = d3.svg.axis().scale(mediaScale).orient('bottom');
    svg.append('g')
      .attr('class', 'x axis media')
      .attr('transform', 'translate(0,' + height + ')')
      .call(mediaAxis);
    var ptsAxis = d3.svg.axis().scale(ptsScale).orient('left');
    svg.append('g')
      .attr('class', 'y axis presentation')
      .call(ptsAxis);

    svg.append('path')
      .attr('class', 'intersect')
      .attr('d', 'M0,' + height + 'L' + width +',0');

    var mediaOffset = 0;

    // update everything on progress
    player.on('progress', function() {
      var updatedMedia = player.tech_.hls.playlists.media();
      var segments = updatedMedia.segments; // updatedMedia.segments.slice(currentIndex, currentIndex + count);

      if (updatedMedia.mediaSequence !== media.mediaSequence) {
        mediaOffset += Playlist.duration(media,
                                         media.mediaSequence,
                                         updatedMedia.mediaSequence);
        media = updatedMedia;
      }

      mediaScale.domain(mediaDomain(updatedMedia, player));
      ptsScale.domain(ptsDomain(segments, mediaScale, mediaOffset));
      svgUpdateAxes(svg, mediaScale, ptsScale, updatedMedia, segments);
      if (!isFinite(ptsScale.domain()[0]) || !isFinite(ptsScale.domain()[1])) {
        return;
      }
      for (var i = 0; i < player.textTracks().length; i++) {
        var track = player.textTracks()[i];
        svgUpdateCues(svg, mediaScale, ptsScale, ptsScale, track.cues);
      }
    });
  };

  var displayCues = function(container, player) {
    var media = player.tech_.hls.playlists.media();
    if (media && media.segments) {
      svgRenderSegmentTimeline(container, player);
    } else {
      player.one('loadedmetadata', function() {
        svgRenderSegmentTimeline(container, player);
      });
    }
  };


  // export
  videojs.Hls.displayStats = displayStats;
  videojs.Hls.displayCues = displayCues;

})(window, window.videojs);

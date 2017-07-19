(function(window, videojs) {

  var videojsHlsDemo = window.videojsContribHlsDemo;
  var player = window.videojsContribHlsDemo.player;

  player.on('loadedmetadata', function() {

    initSelectMenus();
  });

  player.on('timeupdate', function() {

    refreshCurrentQualityAttr();

  });

  setInterval(refreshPlot, 1000);

  function refreshCurrentQualityAttr() {
    var hlsHandler = videojsHlsDemo.hlsHandler;
    if (hlsHandler) {
      var attr = hlsHandler.findRepresentationAttributesAtBufferPosition(player.currentTime());
      if (attr) {
        $('#current-quality-attr').html(JSON.stringify(attr, null, 2));
      }
    }
  }

  function initSelectMenus() {

    var hlsHandler = videojsHlsDemo.hlsHandler;

    $('#quality-menu')
      .append('<option value="-1">Auto</option>');

    // populate menus

    var qualityLevels = player.qualityLevels()
    for (var i = 0; i < qualityLevels.length; i++) {
      var level = qualityLevels[i];
      var description = level.width + ' x ' + level.height + ' - (' + level.bitrate + ' [bits/sec])';
      $('#quality-menu')
        .append('<option value="' + i + '">' + description + '</option>');
    }

    var audioTracks = player.audioTracks(); 
    for (var i = 0; i < audioTracks.length; i++) {
      $('#audio-track-menu')
        .append('<option value="' + i + '">' + audioTracks[i].label + '</option>');
    }

    var videoTracks = player.videoTracks(); 
    for (var i = 0; i < videoTracks.length; i++) {
      $('#video-track-menu')
        .append('<option value="' + i + '">' + videoTracks[i].label + '</option>');
    }

    var textTracks = player.textTracks(); 
    for (var i = 0; i < textTracks.length; i++) {
      $('#text-track-menu')
        .append('<option value="' + i + '">' + textTracks[i].label + '</option>');
    }

    // hook up change listeners

    $('#quality-menu').change(function(e) {
      // Disable ALL quality levels
      // Enable ONLY selected quality level
      var qualityLevels = player.qualityLevels()
      for (var i = 0; i < qualityLevels.length; i++) {
        var level = qualityLevels[i];
        if (i === Number(e.target.value) || i === -1) {
          level.enabled = true;
        } else {
          level.enabled = false;
        }
      }
    });

    $('#audio-track-menu').change(function(e) {
        hlsHandler.enableAudioTrack(e.target.value);
    });

    $('#video-track-menu').change(function(e) {
        hlsHandler.enableVideoTrack(e.target.value);
    });

    $('#text-track-menu').change(function(e) {
        console.error('text track not implemented');
    });
  }

  function refreshPlot() {
    var hlsHandler = videojsHlsDemo.hlsHandler;
    if (hlsHandler) {
      var bufferMap = hlsHandler.getMainBufferPayloadAttributesMap();
      var startTimes = bufferMap.map(function(entry) {
        return entry.startTime;
      });
      var bandwidths = bufferMap.map(function(entry) {
        return entry.representationAttributes['BANDWIDTH'];
      });
      var effectiveBitrates = bufferMap.map(function(entry) {
        return entry.effectiveBitrate;
      });
      var graphDiv = $('#quality-graph')[0];
      if (!videojsHlsDemo.isPlotInitialized) {
        Plotly.purge(graphDiv);
        Plotly.newPlot(
          graphDiv,
          [],
          {
            title: 'Buffer state',
            xaxis: {
              title: 'Time [s]'
            },
            yaxis: {
              title: 'Bitrate [b/s]',
            }
          }
        );
        videojsHlsDemo.isPlotInitialized = true;
      }
      videojsHlsDemo.isPlotFilled && Plotly.deleteTraces(graphDiv, 0);
      videojsHlsDemo.isPlotFilled && Plotly.deleteTraces(graphDiv, 0);
      Plotly.addTraces(
        graphDiv,
        [{
          x: startTimes,
          y: bandwidths
        },{
          x: startTimes,
          y: effectiveBitrates
        }]
      );
      videojsHlsDemo.isPlotFilled = true;
    }
  }

}(window, window.videojs));

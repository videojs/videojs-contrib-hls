/**
 * An optional debugging interface for HLS playback.
 */
(function(videojs) {
  'use strict';
  var playlistLabel, bitrateLabel, mediaWindowLabel, mediaSequenceLabel;

  playlistLabel = function(playlist) {
    var result = '';
    if (!playlist) {
      return 'not specified';
    }

    result += bitrateLabel(playlist.attributes.BANDWIDTH);

    if (playlist.attributes.RESOLUTION) {
      result += ', ' +
        playlist.attributes.RESOLUTION.width + '&times;' +
        playlist.attributes.RESOLUTION.height;
    }

    return result;
  };

  bitrateLabel = function(bitrate) {
    if (bitrate === undefined) {
      return 'unknown bitrate';
    }
    return Math.ceil(parseInt(bitrate, 10) / 1024).toLocaleString({
      useGrouping: true
    }) + ' kbps';
  };

  mediaWindowLabel = function(player) {
    var playlist = player.hls.playlists.media(), mediaSequence;

    if (!playlist || !playlist.segments) {
      return 'unavailable';
    }

    mediaSequence = playlist.mediaSequence || 0;

    return '[' +
      mediaSequence + ', ' +
      (mediaSequence + playlist.segments.length - 1) +
      ']';
  };

  mediaSequenceLabel = function(player) {
    var playlist = player.hls.playlists.media();
    if (!playlist) {
      return 'unavailable';
    }

    var result = (playlist.mediaSequence || 0) + player.hls.mediaIndex;
    return result;
  };

  videojs.Hls.Debugger = function(player) {
    var panel = document.createElement('dl'), debugPanel = this, item;
    panel.className = 'vjs-hls-debug';

    // on-deck playlist
    item = document.createElement('dt');
    item.innerHTML = 'Active Playlist';
    panel.appendChild(item);

    item = document.createElement('dd');
    item.className ='vjs-hls-playlist';
    item.innerHTML = playlistLabel(player.hls.playlists.media());
    this.playlist = item;

    panel.appendChild(item);
    player.on(['loadedmetadata', 'mediachange'], function() {
      debugPanel.playlist.innerHTML = playlistLabel(player.hls.playlists.media());
    });

    // bitrate
    item = document.createElement('dt');
    item.innerHTML = 'Download Bitrate';
    panel.appendChild(item);

    item = document.createElement('dd');
    item.className ='vjs-hls-bitrate';
    item.innerHTML = bitrateLabel(player.hls.bandwidth);
    this.bitrate = item;

    panel.appendChild(item);
    player.on('bandwidthupdate', function() {
      debugPanel.bitrate.innerHTML = bitrateLabel(player.hls.bandwidth);
    });

    // media window size
    item = document.createElement('dt');
    item.innerHTML = 'Media Window';
    panel.appendChild(item);

    item = document.createElement('dd');
    item.className ='vjs-hls-window';
    item.innerHTML = mediaWindowLabel(player);
    this.window = item;

    panel.appendChild(item);
    player.hls.playlists.on('loadedplaylist', function() {
      debugPanel.window.innerHTML = mediaWindowLabel(player);
    });

    // media sequence number
    item = document.createElement('dt');
    item.innerHTML = 'Next Segment';
    panel.appendChild(item);

    item = document.createElement('dd');
    item.className ='vjs-hls-media-sequence';
    item.innerHTML = mediaSequenceLabel(player);
    this.mediaSequence = item;

    panel.appendChild(item);
    player.hls.playlists.on('loadedplaylist', function() {
      debugPanel.mediaSequence.innerHTML = mediaSequenceLabel(player);
    });
    player.on('progress', function() {
      debugPanel.mediaSequence.innerHTML = mediaSequenceLabel(player);
    });

    // segment buffer
    item = document.createElement('dt');
    item.innerHTML = 'Buffered Segments';
    panel.appendChild(item);

    item = document.createElement('dd');
    item.className ='vjs-hls-segment-buffer';
    item.innerHTML = player.hls.segmentBuffer_.length;
    this.segmentBuffer = item;

    panel.appendChild(item);
    player.on('progress', function() {
      // asynchronously update the display to allow the current
      // segment to be shifted off the buffer
      setTimeout(function() {
        debugPanel.segmentBuffer.innerHTML = player.hls.segmentBuffer_.length;
      }, 0);
    });

    // buffered
    item = document.createElement('dt');
    item.innerHTML = 'Buffered Content';
    panel.appendChild(item);

    item = document.createElement('dd');
    item.className ='vjs-hls-buffered';
    item.innerHTML = Math.ceil(player.buffered().end(0) - player.buffered().start(0)) + ' seconds';
    this.buffered = item;

    panel.appendChild(item);
    player.on('progress', function() {
      debugPanel.buffered.innerHTML = Math.ceil(player.buffered().end(0) - player.buffered().start(0)) + ' seconds';
    });

    player.el().insertBefore(panel, player.controlBar.el());
  };
})(window.videojs);

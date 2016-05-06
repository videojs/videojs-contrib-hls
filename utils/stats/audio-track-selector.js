(function(videojs) {
  var Component = videojs.getComponent('Component');

  // -----------------
  // AudioTrackMenuItem
  // -----------------
  //
  var MenuItem = videojs.getComponent('MenuItem');

  var AudioTrackMenuItem = videojs.extend(MenuItem, {
    constructor: function(player, options) {
      var track = options.track;
      var tracks = player.audioTracks();

      options.label = track.label || track.language || 'Unknown';
      options.selected = track.enabled;

      MenuItem.call(this, player, options);

      this.track = track;

      if (tracks) {
        var changeHandler = videojs.bind(this, this.handleTracksChange);

        tracks.addEventListener('change', changeHandler);
        this.on('dispose', function() {
          tracks.removeEventListener('change', changeHandler);
        });
      }
    },

    handleClick: function(event) {
      var kind = this.track.kind;
      var tracks = this.player_.audioTracks();

      MenuItem.prototype.handleClick.call(this, event);

      if (!tracks) return;

      for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i];

        if (track === this.track) {
          track.enabled = true;
        }
      }
    },

    handleTracksChange: function(event) {
      this.selected(this.track.enabled);
    }
  });

  Component.registerComponent('AudioTrackMenuItem', AudioTrackMenuItem);

  // -----------------
  // AudioTrackButton
  // -----------------
  //
  var MenuButton = videojs.getComponent('MenuButton');

  var AudioTrackButton = videojs.extend(MenuButton, {
    constructor: function(player, options) {
      MenuButton.call(this, player, options);
      this.el_.setAttribute('aria-label','Audio Menu');

      var tracks = this.player_.audioTracks();

      if (this.items.length <= 1) {
        this.hide();
      }

      if (!tracks) {
        return;
      }

      var updateHandler = videojs.bind(this, this.update);
      tracks.addEventListener('removetrack', updateHandler);
      tracks.addEventListener('addtrack', updateHandler);

      this.player_.on('dispose', function() {
        tracks.removeEventListener('removetrack', updateHandler);
        tracks.removeEventListener('addtrack', updateHandler);
      });
    },

    buildCSSClass() {
      return 'vjs-subtitles-button ' + MenuButton.prototype.buildCSSClass.call(this);
    },

    createItems: function(items) {
      items = items || [];

      var tracks = this.player_.audioTracks();

      if (!tracks) {
        return items;
      }

      for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i];

        items.push(new AudioTrackMenuItem(this.player_, {
          'selectable': true,
          'track': track
        }));
      }

      return items;
    }
  });

  Component.registerComponent('AudioTrackButton', AudioTrackButton);
})(window.videojs);

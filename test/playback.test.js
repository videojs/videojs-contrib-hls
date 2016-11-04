import QUnit from 'qunit';
import videojs from 'video.js';
/* eslint-disable no-unused-vars */
import { Hls } from '../src/videojs-contrib-hls';

let when = function(element, type, cb, condition) {
  element.on(type, function func() {
    if (condition()) {
      element.off(type, func);
      cb();
    }
  });
};

let playFor = function(player, time, cb) {
  let targetTime = player.currentTime() + time;

  when(player, 'timeupdate', cb, () => player.currentTime() >= targetTime);
};

QUnit.module('Playback', {
  beforeEach() {
    QUnit.stop();
    let video = document.createElement('video');

    video.width = 600;
    video.height = 300;
    document.querySelector('#qunit-fixture').appendChild(video);
    this.player = videojs(video);
    this.player.ready(QUnit.start);
  }
});

QUnit.test('Advanced Bip Bop', function() {
  QUnit.expect(2);
  QUnit.stop();
  let player = this.player;

  player.autoplay(true);

  playFor(player, 2, function() {
    QUnit.ok(true, 'played for at least two seconds');
    QUnit.equal(player.error(), null, 'has no player errors');

    QUnit.start();
  });

  player.src({
    src: 'http://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('Advanced Bip Bop preload=none', function() {
  QUnit.expect(2);
  QUnit.stop();
  let player = this.player;

  player.autoplay(true);
  player.preload('none');

  playFor(player, 2, function() {
    QUnit.ok(true, 'played for at least two seconds');
    QUnit.equal(player.error(), null, 'has no player errors');

    QUnit.start();
  });

  player.src({
    src: 'http://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});


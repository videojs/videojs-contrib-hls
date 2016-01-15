/* global browser, $, describe, beforeEach, it, expect, player  */

describe('Player', function() {
  beforeEach(function() {
    browser.get(browser.baseUrl);
  });

  it('should play', function() {
    $('.vjs-big-play-button').click();
    browser.executeAsyncScript(function(done) {
      player.one('timeupdate', function() {
        var result = !player.paused() &&
          !player.ended() &&
          player.error() === null;
        done(result);
      });
    }).then(function(result) {
      expect(result).toBe(true);
    });
  });
});

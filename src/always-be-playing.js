/**
 * @file always-be-playing.js
 */
import Ranges from './ranges';
import videojs from 'video.js';
import TimedCheck from './timed-check';

/**
 * @class AlwaysBePlaying
 */
export default class AlwaysBePlaying extends TimedCheck {
  /**
   * Represents an AlwaysBePlaying object.
   * @constructor
   * @param {object} options an object that includes the tech and settings
   */
  constructor(options) {
    super(options);

    this.tech_ = options.tech;
    this.seekable = options.seekable;
    this.playlist = options.playlist;

    if (options.debug) {
      this.logger_ = videojs.log.bind(videojs, 'always-be-playing ->');
    }
    this.logger_('initialize');
  }

  waiting_() {
    let seekable = this.seekable();
    let currentTime = this.tech_.currentTime();
    let playlist = this.playlist();

    if (this.tech_.seeking() ||
        this.timer_ !== null ||
        this.seekedAtTime === currentTime) {
      return;
    }

    // check to see if we fell out of the live window
    if (playlist &&
        !playlist.endList &&
        seekable.length &&
        currentTime < seekable.start(0) &&
        this.seekedAtTime !== currentTime) {
      this.seekedAtTime = currentTime;

      let livePoint = seekable.end(seekable.length - 1);

      this.logger_(`Fell out of live window at time ${currentTime}. Seeking to ` +
                   `live point (seekable end) ${livePoint}`);
      this.cancelTimer_();
      this.tech_.setCurrentTime(livePoint);
      return;
    }

    this.seekedAtTime = null;

    let buffered = this.tech_.buffered();
    let nextRange = Ranges.findNextRange(buffered, currentTime);

    // check for video underflow
    if (nextRange.length === 0) {
      // Even if there is no available next range, there is still a possibility we are
      // stuck in a gap due to video underflow.
      let gap = this.gapFromVideoUnderflow_(buffered, currentTime);

      if (gap) {
        this.logger_(`Encountered a gap in video from ${gap.start} to ${gap.end}. ` +
                     `Seeking to current time ${currentTime}`);
        // Even though the video underflowed and was stuck in a gap, the audio overplayed
        // the gap, leading currentTime into a buffered range. Seeking to currentTime
        // allows the video to catch up to the audio position without losing any audio
        // (only suffering ~3 seconds of frozen video and a pause in audio playback).
        this.cancelTimer_();
        this.tech_.setCurrentTime(currentTime);
      }
      return;
    }

    let difference = nextRange.start(0) - currentTime;

    // check for gap
    this.logger_(`Stopped at ${currentTime}, setting timer for ${difference}, seeking ` +
                 `to ${nextRange.start(0)}`);

    this.timer_ = setTimeout(this.skipTheGap_.bind(this),
                             difference * 1000,
                             currentTime);
  }

  /**
   * Timer callback. If playback still has not proceeded, then we seek
   * to the start of the next buffered region.
   *
   * @private
   */
  skipTheGap_(scheduledCurrentTime) {
    let buffered = this.tech_.buffered();
    let currentTime = this.tech_.currentTime();
    let nextRange = Ranges.findNextRange(buffered, currentTime);

    this.cancelTimer_();

    if (nextRange.length === 0 ||
        currentTime !== scheduledCurrentTime) {
      return;
    }

    this.logger_('skipTheGap_:',
                 'currentTime:', currentTime,
                 'scheduled currentTime:', scheduledCurrentTime,
                 'nextRange start:', nextRange.start(0));

    // only seek if we still have not played
    this.tech_.setCurrentTime(nextRange.start(0) + Ranges.TIME_FUDGE_FACTOR);
  }

  gapFromVideoUnderflow_(buffered, currentTime) {
    // At least in Chrome, if there is a gap in the video buffer, the audio will continue
    // playing for ~3 seconds after the video gap starts. This is done to account for
    // video buffer underflow/underrun (note that this is not done when there is audio
    // buffer underflow/underrun -- in that case the video will stop as soon as it
    // encounters the gap, as audio stalls are more noticeable/jarring to a user than
    // video stalls). The player's time will reflect the playthrough of audio, so the
    // time will appear as if we are in a buffered region, even if we are stuck in a
    // "gap."
    //
    // Example:
    // video buffer:   0 => 10.1, 10.2 => 20
    // audio buffer:   0 => 20
    // overall buffer: 0 => 10.1, 10.2 => 20
    // current time: 13
    //
    // Chrome's video froze at 10 seconds, where the video buffer encountered the gap,
    // however, the audio continued playing until it reached ~3 seconds past the gap
    // (13 seconds), at which point it stops as well. Since current time is past the
    // gap, findNextRange will return no ranges.
    //
    // To check for this issue, we see if there is a gap that starts somewhere within
    // a 3 second range (3 seconds +/- 1 second) back from our current time.
    let gaps = Ranges.findGaps(buffered);

    for (let i = 0; i < gaps.length; i++) {
      let start = gaps.start(i);
      let end = gaps.end(i);

      // gap is starts no more than 4 seconds back
      if (currentTime - start < 4 && currentTime - start > 2) {
        return {
          start,
          end
        };
      }
    }

    return null;
  }
}

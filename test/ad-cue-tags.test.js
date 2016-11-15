import QUnit from 'qunit';
import AdCueTags from '../src/ad-cue-tags';
import window from 'global/window';

QUnit.module('AdCueTags', {
  beforeEach() {
    this.track = {
      cues: [],
      addCue(cue) {
        this.cues.push(cue);
      },
      clearTrack() {
        this.cues = [];
      }
    };
  }
});

QUnit.test('update tag cues', function(assert) {

  let testCue = new window.VTTCue(0, 10, 'test');

  this.track.addCue(testCue);

  AdCueTags.updateAdCues({}, this.track);

  assert.equal(this.track.cues.length,
              1,
              'does not change cues if media does not have segment property');
  assert.equal(this.track.cues[0],
              testCue,
              'does not change cues if media does not have segment property');

  AdCueTags.updateAdCues({
    segments: []
  }, this.track);

  assert.equal(this.track.cues.length,
              1,
              'does not remove cues even if no segments in playlist');

  this.track.clearTrack();

  AdCueTags.updateAdCues({
    segments: [{
      duration: 5.1,
      cueOut: '11.5'
    }, {
      duration: 6.4,
      cueOutCont: '5.1/11.5'
    }, {
      duration: 6,
      cueIn: ''
    }]
  }, this.track, 10);

  assert.equal(this.track.cues.length, 1, 'adds a single cue for entire ad');

  testCue = this.track.cues[0];
  assert.equal(testCue.startTime, 10, 'cue starts at 10');
  assert.equal(testCue.endTime, 21.5, 'cue ends at start time plus duration');

  this.track.clearTrack();

  AdCueTags.updateAdCues({
    segments: [{
      duration: 10,
      cueOutCont: '10/30'
    }, {
      duration: 10,
      cueOutCont: '20/30'
    }, {
      duration: 10,
      cueIn: ''
    }]
  }, this.track);

  assert.equal(this.track.cues.length, 1,
    'adds a single cue for entire ad when entering mid cue-out-cont');

  testCue = this.track.cues[0];
  assert.equal(testCue.startTime, 0, 'cue starts at 0');
  assert.equal(testCue.endTime, 20, 'cue ends at start time plus duration');
  assert.equal(testCue.adStartTime, -10, 'cue ad starts at -10');
  assert.equal(testCue.adEndTime, 20, 'cue ad ends at 20');
});

QUnit.test('update incomplete cue in live playlist situation', function(assert) {
  AdCueTags.updateAdCues({
    segments: [
      {
        duration: 10,
        cueOut: '30'
      },
      {
        duration: 10,
        cueOutCont: '10/30'
      }
    ]
  }, this.track, 10);

  assert.equal(this.track.cues.length, 1, 'adds a single cue for new ad');

  let testCue = this.track.cues[0];

  assert.equal(testCue.startTime, 10, 'cue starts at 10');
  assert.equal(testCue.endTime, 30, 'cue ends at start time plus segment durations');
  assert.equal(testCue.adStartTime, 10, 'cue ad starts at 10');
  assert.equal(testCue.adEndTime, 40, 'cue ad ends at 40');

  AdCueTags.updateAdCues({
    segments: [
      {
        duration: 10,
        cueOutCont: '10/30'
      },
      {
        duration: 10,
        cueOutCont: '20/30'
      }
    ]
  }, this.track, 20);

  assert.equal(this.track.cues.length, 1, 'did not remove cue or add a new one');

  assert.equal(testCue.startTime, 10, 'cue still starts at 10');
  assert.equal(testCue.endTime, 40, 'cue end updated to include next segment duration');
  assert.equal(testCue.adStartTime, 10, 'cue ad still starts at 10');
  assert.equal(testCue.adEndTime, 40, 'cue ad still ends at 40');

  AdCueTags.updateAdCues({
    segments: [
      {
        duration: 10,
        cueOutCont: '20/30'
      },
      {
        duration: 10,
        cueIn: ''
      }
    ]
  }, this.track, 30);

  assert.equal(this.track.cues.length, 1, 'did not remove cue or add a new one');

  assert.equal(testCue.startTime, 10, 'cue still starts at 10');
  assert.equal(testCue.endTime, 40, 'cue end still 40');
  assert.equal(testCue.adStartTime, 10, 'cue ad still starts at 10');
  assert.equal(testCue.adEndTime, 40, 'cue ad still ends at 40');
});

QUnit.test('adjust cue end time in event of early CUE-IN', function(assert) {
  AdCueTags.updateAdCues({
    segments: [
      {
        duration: 10,
        cueOut: '30'
      },
      {
        duration: 10,
        cueOutCont: '10/30'
      },
      {
        duration: 10,
        cueOutCont: '20/30'
      }
    ]
  }, this.track, 10);

  assert.equal(this.track.cues.length, 1, 'adds a single cue for new ad');

  let testCue = this.track.cues[0];

  assert.equal(testCue.startTime, 10, 'cue starts at 10');
  assert.equal(testCue.endTime, 40, 'cue ends at start time plus segment durations');
  assert.equal(testCue.adStartTime, 10, 'cue ad starts at 10');
  assert.equal(testCue.adEndTime, 40, 'cue ad ends at 40');

  AdCueTags.updateAdCues({
    segments: [
      {
        duration: 10,
        cueOutCont: '10/30'
      },
      {
        duration: 10,
        cueIn: ''
      },
      {
        duration: 10
      }
    ]
  }, this.track, 20);

  assert.equal(this.track.cues.length, 1, 'did not remove cue or add a new one');

  assert.equal(testCue.startTime, 10, 'cue still starts at 10');
  assert.equal(testCue.endTime, 30, 'cue end updated to 30');
  assert.equal(testCue.adStartTime, 10, 'cue ad still starts at 10');
  assert.equal(testCue.adEndTime, 30,
    'cue ad end updated to 30 to account for early cueIn');
});

QUnit.test('correctly handle multiple ad cues', function(assert) {
  AdCueTags.updateAdCues({
    segments: [
      {
        duration: 10
      },
      {
        duration: 10
      },
      {
        duration: 10
      },
      {
        duration: 10,
        cueOut: '30'
      },
      {
        duration: 10,
        cueOutCont: '10/30'
      },
      {
        duration: 10,
        cueOutCont: '20/30'
      },
      {
        duration: 10,
        cueIn: ''
      },
      {
        duration: 10
      },
      {
        duration: 10
      },
      {
        duration: 10
      },
      {
        duration: 10,
        cueOut: '20'
      },
      {
        duration: 10,
        cueOutCont: '10/20'
      },
      {
        duration: 10,
        cueIn: ''
      },
      {
        duration: 10
      }
    ]
  }, this.track);

  assert.equal(this.track.cues.length, 2, 'correctly created 2 cues for the ads');
  assert.equal(this.track.cues[0].startTime, 30, 'cue created at correct start time');
  assert.equal(this.track.cues[0].endTime, 60, 'cue has correct end time');
  assert.equal(this.track.cues[0].adStartTime, 30, 'cue has correct ad start time');
  assert.equal(this.track.cues[0].adEndTime, 60, 'cue has correct ad end time');
  assert.equal(this.track.cues[1].startTime, 100, 'cue created at correct start time');
  assert.equal(this.track.cues[1].endTime, 120, 'cue has correct end time');
  assert.equal(this.track.cues[1].adStartTime, 100, 'cue has correct ad start time');
  assert.equal(this.track.cues[1].adEndTime, 120, 'cue has correct ad end time');
});

QUnit.test('findAdCue returns correct cue', function(assert) {
  this.track.cues = [
    {
      adStartTime: 0,
      adEndTime: 30
    },
    {
      adStartTime: 45,
      adEndTime: 55
    },
    {
      adStartTime: 100,
      adEndTime: 120
    }
  ];

  let cue;

  cue = AdCueTags.findAdCue(this.track, 15);
  assert.equal(cue.adStartTime, 0, 'returned correct cue');

  cue = AdCueTags.findAdCue(this.track, 40);
  assert.equal(cue, null, 'cue not found, returned null');

  cue = AdCueTags.findAdCue(this.track, 120);
  assert.equal(cue.adStartTime, 100, 'returned correct cue');

  cue = AdCueTags.findAdCue(this.track, 45);
  assert.equal(cue.adStartTime, 45, 'returned correct cue');
});

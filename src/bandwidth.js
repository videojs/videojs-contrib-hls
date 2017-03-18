class BandwidthTracker {
  constructor(windowSize) {
    this.windowSize = windowSize;
    this.samples = [];
  }

  push(sample) {
    this.samples.unshift(sample);
    //this.samples.length = Math.min(this.samples.length, this.windowSize);
    this.removeByTime_();
  }

  removeByTime_() {
    const count = this.samples.length;
    const maxTime = this.windowSize * 1000;
    let time = 0;

    for (let i  = 0; i < count; i++) {
      const sample = this.samples[i];

      time += sample.roundTrip;

      if (time > maxTime) {
        this.samples = this.samples.slice(0, i);
        break;
      }
    }
  }

  sumDownloaded_() {
    return this.samples.reduce((sum, sample) => sum + sample.bytes, 0);
  }

  sumTime_() {
    return this.samples.reduce((sum, sample) => sum + sample.roundTrip, 0);
  }

  hMean() {
    const totalDownloaded = this.sumDownloaded_();
    const totalTime = this.sumTime_();

    if (this.samples.length >= 2) {
      return Math.floor(1 / this.samples.reduce((acc, sample) => acc + (sample.roundTrip / totalTime / sample.bandwidth), 0));
    }

    return this.current();
  }

  min() {
    if (this.samples.length) {
      return this.samples.reduce((acc, sample) => Math.min(acc, sample.bandwidth));
    }
    return 1;
  }

  current() {
    if (this.samples.length) {
      return this.samples[0].bandwidth;
    }
    return 4194304;
  }
}

export default BandwidthTracker;

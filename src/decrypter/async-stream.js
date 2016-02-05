import Stream from '../stream';

/**
 * A wrapper around the Stream class to use setTiemout
 * and run stream "jobs" Asynchronously
 */
export default class AsyncStream extends Stream {
  constructor() {
    super(Stream);
    this.jobs = [];
    this.delay = 1;
    this.timeout_ = null;
  }
  processJob_() {
    this.jobs.shift()();
    if (this.jobs.length) {
      this.timeout_ = setTimeout(this.processJob_.bind(this),
                                 this.delay);
    } else {
      this.timeout_ = null;
    }
  }
  push(job) {
    this.jobs.push(job);
    if (!this.timeout_) {
      this.timeout_ = setTimeout(this.processJob_.bind(this),
                                 this.delay);
    }
  }
}


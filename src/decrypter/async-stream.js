import Stream from '../stream';

const AsyncStream = function() {
  this.jobs = [];
  this.delay = 1;
  this.timeout_ = null;
};

AsyncStream.prototype = new Stream();
AsyncStream.prototype.processJob_ = function() {
  this.jobs.shift()();
  if (this.jobs.length) {
    this.timeout_ = setTimeout(
      this.processJob_.bind(this),
      this.delay
    );
  } else {
    this.timeout_ = null;
  }
};
AsyncStream.prototype.push = function(job) {
  this.jobs.push(job);
  if (!this.timeout_) {
    this.timeout_ = setTimeout(
      this.processJob_.bind(this),
      this.delay
    );
  }
};

export default AsyncStream;

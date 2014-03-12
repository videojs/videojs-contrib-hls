(function(window, videojs, undefined) {
  'use strict';
  /**
   * A queue object that manages tasks that should be processed
   * serially but asynchronously. Loosely adapted from
   * https://github.com/caolan/async#queue.
   * @param worker {function} the callback to invoke with each value
   * pushed onto the queue
   * @return {object} an object with an array of `tasks` that remain to
   * be processed and function `push` to add new tasks
   */
  videojs.hls.queue = function(worker) {
    var
      q = {
        tasks: [],
        running: false,
        push: function(task) {
          q.tasks.push(task);
          if (!q.running) {
            window.setTimeout(process, 0);
            q.running = true;
          }
        }
      },
      process = function() {
        var task;
        if (q.tasks.length) {
          task = q.tasks.shift();
          worker.call(this, task);
          window.setTimeout(process, 0);
        } else {
          q.running = false;
        }
      };
    return q;
  };
})(window, window.videojs);

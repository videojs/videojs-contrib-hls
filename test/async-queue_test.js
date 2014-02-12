(function(window, queue, undefined) {
  var
    oldSetTimeout,
    callbacks;
  module('async queue', {
    setup: function() {
      oldSetTimeout = window.setTimeout;
      callbacks = [];
      window.setTimeout = function(callback) {
        callbacks.push(callback);
      };
    },
    teardown: function() {
      window.setTimeout = oldSetTimeout;
    }
  });

  test('runs tasks asynchronously', function() {
    var
      run = false,
      q = queue(function() {
        run = true;
      });
    q.push(1);
    
    ok(!run, 'tasks are not run immediately');

    callbacks[0]();
    ok(run, 'tasks are run asynchronously');
  });

  test('runs one task at a time', function() {
    var q = queue(function() {});
    q.push(1);
    q.push(2);
    q.push(3);
    q.push(4);
    q.push(5);

    strictEqual(q.tasks.length, 5, 'all tasks are queued');
    strictEqual(1, callbacks.length, 'one callback is registered');
  });

  test('tasks are scheduled until the queue is empty', function() {
    var q = queue(function() {});
    q.push(1);
    q.push(2);

    callbacks.shift()();
    strictEqual(1, callbacks.length, 'the next task is scheduled');
  });

  test('can be emptied at any time', function() {
    var
      runs = 0,
      q = queue(function() {
        runs++;
      });
    q.push(1);
    q.push(2);

    callbacks.shift()();
    strictEqual(1, runs, 'task one is run');

    q.tasks = [];
    callbacks.shift()();
    strictEqual(1, runs, 'the remaining tasks are cancelled');
  });
})(window, window.videojs.hls.queue);

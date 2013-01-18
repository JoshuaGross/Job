/**
 * Run the Kue jobs spawned by job.js
 */

var kue = require('../node_modules/kue')
  , jobs = kue.createQueue()
  , ranJobsRunner = false;

require('coffee-script');

process.env.IN_JOBS_RUNNER = true;

process.on('message', function (msg) {
  if (msg.die || !process.connected) {
    process.exit();
  } else if (msg.initScript && !ranJobsRunner) {
    ranJobsRunner = true;
    require(msg.initScript)(function () {
      // sometimes the process disconnects/crashes immediately, especially
      // in the case of repeated server restarts
      if (process.connected) process.send({ ready: true });
    });
  } else if (msg.listenFor) {
    msg.concurrentProcesses = parseInt(msg.concurrentProcesses || 1);
    console.log(process.pid, 'Now processing', msg.concurrentProcesses, 'instances of', msg.listenFor);

    var helper = require(msg.helperPath);

    jobs.process(msg.listenFor, msg.concurrentProcesses, function (job, done) {
      console.log('Jobs/Kue: child worker', process.pid, 'Handling:', msg.listenFor);

      var finished = false;
      var _done = function () {
        if (finished) return;
        finished = true;
        done();
      };

      job.data.args.push(_done);
      process.nextTick(function () {
        helper[msg.methodName].apply(helper, job.data.args);

        // Mark job as done if we think it's crashed
        if (msg.maxJobTime) {
          setTimeout(_done, msg.maxJobTime);
        }
      });
    });

    receivedMessage = true;
  }
});

// Every second, see if our connection to the parent is still alive. If not, kill this process.
// The parent will reopen children that become disconnected accidentally (though I'm not sure how/if
// that happens)
setInterval(function () {
  if (!process.connected) process.exit();
}, 1000);

process.on('exit', function () {
  jobs.client.quit(); // close Kue's Redis connection

  console.log('Kue processor is going away');
});

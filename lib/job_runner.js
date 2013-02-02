/**
 * Run the Kue jobs spawned by job.js
 */

var jobs
  , ranJobsRunner = false
  , redis = require('redis')
  , domain = require('domain')
  , stopProcessing = false;

require('coffee-script');

process.env.IN_JOBS_RUNNER = true;

process.on('message', function (msg) {
  if (msg.die || !process.connected) {
    process.exit();
  } else if (msg.stop) {
    stopProcessing = true;
    setTimeout(process.exit, 500);
  } else if (msg.redis) {
    var kue = require('kue');

    kue.redis.createClient = function() {
      var client = redis.createClient(msg.redis.port, msg.redis.host);
      if (msg.redis.auth) client.auth(msg.redis.auth);
      return client;
    };
    jobs = kue.createQueue();
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
      var _done = function (err) {
        if (finished) return;
        finished = true;

        if (err) done(err);
        else     done();
      };

      if (stopProcessing) return _done(new Error('Stop processing jobs in this thread.'));

      var jobDomain = domain.create();
      jobDomain.on('error', function (err) {
        console.log('Failed job',msg.listenFor,'with error:', err, job.data, err.stack)
        _done(err);
        jobDomain.dispose();
      });
      jobDomain.run(function () {
        job.data.args.push(_done);
        process.nextTick(function () {
          helper[msg.methodName].apply(helper, job.data.args);

          // Mark job as done if we think it's crashed
          if (msg.maxJobTime) {
            setTimeout(_done, msg.maxJobTime);
          }
        });
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

process.on('uncaughtException', function (e) {
  console.log('Danger! Uncaught exception in job runner. Why wasn\'t this caught by a domain?',
             e, e.stack);
});

process.on('exit', function () {
  jobs && jobs.client && jobs.client.quit(); // close Kue's Redis connection

  console.log('Kue processor is going away');
});

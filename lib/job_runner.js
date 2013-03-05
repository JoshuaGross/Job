/**
 * Run the Kue jobs spawned by job.js
 */

var jobs
  , jobProcessor = require('./process.js')
  , ranJobsRunner = false
  , redis = require('redis')
  , domain = require('domain');

require('coffee-script');

process.env.IN_JOBS_RUNNER = true;

process.on('message', function (msg) {
  if (msg.die || !process.connected) {
    process.exit();
  } else if (msg.stop) {
    jobProcessor.stopProcessing = true;
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

    var helperName = msg.helperPath;
    var helper = require(msg.helperPath);

    jobProcessor.process(jobs, helperName, msg.methodName, helper, helper[msg.methodName]);

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

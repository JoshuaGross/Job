/**
 * Run the Kue jobs spawned by job.js
 */

var jobs
  , resque
  , jobProcessor = require('./process.js')
  , ranJobsRunner = false
  , redis = require('redis')
  , kue = require('kue')
  , Resque = require('coffee-resque')
  , domain = require('domain')
  , modulesIn;

require('coffee-script');

process.env.IN_JOBS_RUNNER = true;

process.on('message', function (msg) {
  if (msg.die || !process.connected) {
    process.exit();
  } else if (msg.stop) {
    jobProcessor.stopProcessing = true;
    setTimeout(process.exit, 500);
  } else if (msg.redis) {
    kue.redis.createClient = function() {
      var client = redis.createClient(msg.redis.port, msg.redis.host);
      if (msg.redis.auth) client.auth(msg.redis.auth);
      return client;
    };
    jobs = kue.createQueue();

    // As of 1.7.0 we're experimenting with using Coffee-Resqueue instead of Kue for any jobs that 
    // don't need to be delayed.
    resque = require('coffee-resque').connect({
      timeout: 100,
      host: msg.redis.host,
      port: msg.redis.port,
      password: msg.redis.auth
    });
  } else if (msg.initScript && !ranJobsRunner) {

    ranJobsRunner = true;
    require(msg.initScript)(function (err, _modulesIn) {
      if (err) throw err;
      modulesIn = _modulesIn;
      // sometimes the process disconnects/crashes immediately, especially
      // in the case of repeated server restarts
      if (process.connected) process.send({ ready: true });
    });
  } else if (msg.helperPath && msg.moduleName && msg.methodName) {
    var helperName = msg.helperPath;
    var helper;
    if (msg.moduleName && modulesIn && modulesIn.services && modulesIn.services[msg.moduleName]) {
      console.log('Loaded', msg.moduleName,':',msg.methodName, 'via Architect')
      helper = modulesIn.services[msg.moduleName]; 
    } else {
      console.log('Loaded', msg.moduleName,':',msg.methodName, 'via direct require()')
      helper = require(msg.helperPath);
    }

    jobProcessor.process({ kue: jobs, resque: resque }, msg.methodName, helper, helper[msg.methodName]);

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

/**
 * Run the Kue jobs spawned by job.js
 */

var kue = require('../node_modules/kue')
  , jobs = kue.createQueue();

require('coffee-script');

process.env.IN_JOBS_RUNNER = true;

process.on('message', function (msg) {
  if (msg.die) {
    process.exit();
  } else if (msg.initScript) {
    require(msg.initScript)(function () {
      process.send({ ready: true });
    });
  } else if (msg.listenFor) {
    msg.concurrentProcesses = parseInt(msg.concurrentProcesses || 1);
    console.log(process.pid, 'Now processing', msg.concurrentProcesses, 'instances of', msg.listenFor);

    var helper = require(msg.helperPath);

    jobs.process(msg.listenFor, msg.concurrentProcesses, function (job, done) {
      console.log('Jobs/Kue: child worker', process.pid, 'Handling:', msg.listenFor);

      job.data.args.push(done);
      helper[msg.methodName].apply(helper, job.data.args);
    });

    receivedMessage = true;
  }
});
process.on('exit', function () {
  console.log('Kue processor is going away');
});

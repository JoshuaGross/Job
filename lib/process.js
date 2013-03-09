var domain = require('domain');

// Process individual jobs.
// TODO: expose better pubsub methods for communicating with process spawners,
module.exports.process = function (jobsKue, methodName, moduleIn, method) {
  var listenFor = moduleIn.name+'.'+methodName;
  var concurrentProcesses = parseInt(method.concurrentProcesses) || 1;
  var maxJobTime = parseInt(method.maxProcessingTime) || 0;

  console.log(String(process.pid), 'Now processing', concurrentProcesses, 'instances of', listenFor);

  jobsKue.process(listenFor, concurrentProcesses, function (job, done) {
    console.log('Jobs/Kue: worker', process.pid, 'Handling:', listenFor);

    var finished = false;
    var _done = function (err) {
      if (finished) return;
      finished = true;

      // remove job after 3 seconds
      setTimeout(function () {
        job.remove();
      }, 3000);

      if (err) return done(err);
      else     return done();
    };
    _done.job = job;

    if (module.exports.stopProcessing) return _done(new Error('Stop processing jobs in this thread.'));

    var jobDomain = domain.create();
    jobDomain.on('error', function (err) {
      console.log('Failed job',listenFor,'with error:', err, job.data, err.stack)
      _done(err);
      jobDomain.dispose();
    });
    jobDomain.run(function () {
      job.data.args.push(_done);
      process.nextTick(function () {
        if (!moduleIn[methodName]) {
          throw new Error('Helper method is not defined: '+methodName);
        }
        moduleIn[methodName].apply(moduleIn, job.data.args);

        // Mark job as done if we think it's crashed
        if (maxJobTime) {
          setTimeout(function () {
            _done(new Error('Timeout in Job: delayed job took over '+maxJobTime+' ms'));
          }, maxJobTime);
        }
      });
    });

  });

  // If this is a repeated job, we need to also periodically schedule it to run
  if (method.repeatedIntervalDelay > 0) {
    var scheduleRegularJob = function () {
      moduleIn.delay[methodName](1, 'high');
    };
    setInterval(scheduleRegularJob, method.repeatedIntervalDelay);
    scheduleRegularJob();
  }
};

module.exports.stopProcessing = false;

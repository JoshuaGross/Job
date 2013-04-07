var domain = require('domain');

// Process individual jobs.
// TODO: expose better pubsub methods for communicating with process spawners,
module.exports.process = function (jobLibs, methodName, moduleIn, method) {
  if (!moduleIn || !method) {
    return console.error('Cannot process job, no module or method:', methodName);
  }

  var jobsKue = jobLibs.kue
    , resque = jobLibs.resque
    , listenFor = moduleIn.name+'.'+methodName
    , concurrentProcesses = parseInt(method.concurrentProcesses) || 1
    , maxJobTime = parseInt(method.maxProcessingTime) || 0;

  console.log(String(process.pid), 'Now processing', concurrentProcesses, 'instances of', listenFor);

  // Process with Kue
  jobsKue.process(listenFor, concurrentProcesses, function (job, done) {
    runJob(job, job.data.args, done);
  });

  // Process job with Resque
  console.log('*', listenFor)
  var worker = resque.worker(listenFor, {
    job: function (data, callback) {
      return runJob(null, data, callback);
    }
  });
  worker.start();

  var runJob = function (job, args, done) {
    console.log('Jobs/Kue: worker', process.pid, 'Handling:', listenFor);

    var finished = false;
    var jobTimeoutCheck;
    var _done = function (err) {
      clearTimeout(jobTimeoutCheck);

      if (finished) return;
      finished = true;

      // remove job after 3 seconds
      setTimeout(function () {
        job && job.remove && job.remove();
      }, 3000);

      if (err) return done(err);
      else     return done();
    };
    _done.job = job;

    if (module.exports.stopProcessing) return _done(new Error('Stop processing jobs in this thread.'));

    var jobDomain = domain.create();
    jobDomain.on('error', function (err) {
      console.log('Failed job',listenFor,'with error:', err, args, err.stack)
      _done(err);
      jobDomain.dispose();
    });
    jobDomain.run(function () {
      args.push(_done);
      process.nextTick(function () {
        if (!moduleIn[methodName]) {
          throw new Error('Helper method is not defined: '+methodName);
        }
        moduleIn[methodName].apply(moduleIn, args);

        // Mark job as done if we think it's crashed
        if (maxJobTime) {
          jobTimeoutCheck = setTimeout(function () {
            _done(new Error('Timeout in Job: delayed job took over '+maxJobTime+' ms'));
          }, maxJobTime);
        }
      });
    });
  };

  // If this is a repeated job, we need to also periodically schedule it to run
  if (method.repeatedIntervalDelay > 0) {
    console.log(String(process.pid), 'Re-triggering', listenFor, 'every', method.repeatedIntervalDelay, 'ms');
    var scheduleRegularJob = function () {
      moduleIn.delay[methodName](1, 'high');
    };
    setInterval(scheduleRegularJob, method.repeatedIntervalDelay);
    scheduleRegularJob();
  }
};

module.exports.stopProcessing = false;

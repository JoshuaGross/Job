/**
 * SpanDeX jobs scheduler
 *
 * Each helper process can expose a function by setting delayable = true. Then you can call
 * helper.delay.methodName(minutesToDelay, priority, arg1, arg2, ...)
 *
 * Delayed jobs must be able to run given /only/ the args passed in. To ensure this is possible,
 * each method can also specify a validator like so:
 *
 * // Delayable:
 * exports.helperMethod = function (arg1, arg2, ...) {}
 * exports.helperMethod.delayable = true;
 *
 * Keep in mind that your helper method /must/ operate asynchronously and call the "done" callback
 * function provided as the last argument.
 */

var kue = require('kue')
  , jobsKue = kue.createQueue()
  , fork = require('child_process').fork
  , path = require('path')
  , runner;

// Register with Architect
// If you are not using Job through Architect, you must call startJobsRunner manually
module.exports = function setup (options, imports, register) {
  module.exports.startJobsRunner(options);
  register(null, { job: module.exports });
};

module.exports.startJobsRunner = function (options) {
  if (process.env.IN_JOBS_RUNNER) {
    return;
  }

  var express = require(path.join(__dirname, '../node_modules/kue/node_modules/express'));
  var app = express.createServer();
  app.use(express.basicAuth(options.kue.username, options.kue.password));
  app.use(kue.app);
  app.listen(options.kue.port);
  console.log('Kue server available on port ' + options.kue.port);

  // Spawn the job runner
  runner = fork(path.join(__dirname, 'job_runner.js'), [], { cwd: process.cwd() });
  runner.ready = false;

  if (options.initScript) {
    runner.on('message', function (msg) {
      if (msg.ready) runner.ready = msg.ready;
    });
    runner.send({ initScript: path.resolve(options.initScript) });
  } else {
    runner.ready = true;
  }

  var signals = ['exit', 'SIGINT', 'SIGTERM', 'SIGQUIT'];
  for (var i in signals) {
    process.on(signals[i], function () {
      runner.send({ die: true });
      process.exit();
    });
  }

  // Every 50 ms, search for delayed jobs that need to be promoted
  jobsKue.promote(50);
};

// Public API
// If "delayable" is true or a validation function,
// generate a delayer and scheduler method
// helperPath must be a full, resolved path to the helper module - so you
// can call addHelper like this:
// jobs.addHelper(fs.realpathSync('./lib/url.js'))
module.exports.addHelper = function (helper) {
  var helperPath = helper.filename;

  if (!helperPath) {
    throw new Error("The helper "+helper.name+" does not have a filename attribute; try passing its `module`.");
  }
  if (!helper.exports) {
    throw new Error('Cannot find module exports; try passing the helper\'s `module`.');
    return;
  }
  if (!helper.exports.name) {
    throw new Error('All of your helpers must have a "name" attribute.');
    return;
  }

  for (var methodName in helper.exports) {
    var method = helper.exports[methodName];

    if (typeof method === 'function' && (!!method.delayable) === true) {
      helper.exports.delay = helper.exports.delay || {};

      (function (method, methodName) {
        var jobName = helper.exports.name+'.'+methodName;

        helper.exports.delay[methodName] = function () {
          // arguments is in the form { '0', arg, '1', arg, etc}
          // ...rather silly.
          var configArguments = [];
          if ('object' === typeof arguments) {
            for (var i = 0, j; 'undefined' !== typeof (j = arguments[i.toString()]); i++) {
              configArguments.push(j);
            }
          } else {
            configArguments = arguments;
          }

          var args = configArguments.splice(2);
          jobsKue.create(jobName, { title: jobName, args: args })
            .delay(configArguments[0])
            .priority(configArguments[1])
            .save();
        };

        // Do not send message to runner if we're in the runner
        if (process.env.IN_JOBS_RUNNER) {
          return;
        }

        var waitForRunner = function () {
          setTimeout(function () {
            if (!runner || !runner.ready) {
              //console.log('wait for runner');
              waitForRunner();
            } else {
              runner.send({
                listenFor: jobName,
                methodName: methodName,
                helperPath: helperPath,
                concurrentProcesses: parseInt(method.concurrentProcesses) || 1
              });
            }
          }, 100);
        };

        waitForRunner();

      })(method, methodName);
    }
  }
};

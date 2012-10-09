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
  , express = require('./node_modules/kue/node_modules/express')
  , config = require('../config.json')
  , path = require('path');

// Register with Architect
module.exports = function setup (options, imports, register) {
  exports.startJobsRunner(setup);

  register(null, module.exports);
};

var runner;

exports.startJobsRunner = function (options) {
  if (process.env.IN_JOBS_RUNNER) {
    return;
  }

  var app = express.createServer();
  app.use(express.basicAuth(config.kue.username, config.kue.password));
  app.use(kue.app);
  app.listen(config.kue.port);
  console.log('Kue server available on port ' + config.kue.port);

  // Spawn the job runner
  runner = fork(path.join(__dirname, 'jobs_runner.js'));

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
exports.addHelper = function (helper) {
  var helperPath = helper.filename;

  if (!helper.name) {
    throw new Error('All of your helpers must have a "name" attribute.');
    return;
  }
  if (!helperPath) {
    throw new Error("The helper "+helper.name+" does not have a filename attribute; try passing its `module`.");
  }

  for (var methodName in helper) {
    var method = helper[methodName];

    if (typeof method === 'function' && (!!method.delayable) === true) {
      helper.delay = helper.delay || {};

      (function (method) {
        var jobName = helper.name+'.'+methodName;

        helper.delay[methodName] = function () {
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
          jobs.create(jobName, { title: jobName, args: args })
            .delay(configArguments[0])
            .priority(configArguments[1])
            .save();
        };

        if (!runner) {
          throw new Error("The jobs runner must be running before you can schedule jobs.");
        }

        runner.send({
          listenFor: jobName,
          methodName: methodName,
          helperPath: helperPath,
          concurrentProcesses: parseInt(method.concurrentProcesses) || 1
        });
      })(method);
    }
  }
};

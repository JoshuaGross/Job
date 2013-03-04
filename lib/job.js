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

var kue
  , redis = require('redis')
  , fork = require('child_process').fork
  , path = require('path')
  , runners = {}
  , options = {}
  , logger = console
  , jobsKue;

var spawnRunner = function () {};
var dead = false;

module.exports.init = function (_options) {
  options = _options;

  options = options || {};

  logger = options.logger || logger;

  options.kue = options.kue || {};
  var redisOptions = options.redis || {host: '127.0.0.1', port: '6379'};

  kue = require('kue');
  kue.redis.createClient = function() {
    var client = redis.createClient(redisOptions.port, redisOptions.host);
    if (redisOptions.auth) client.auth(redisOptions.auth);
    return client;
  };
  jobsKue = kue.createQueue();

  if (process.env.IN_JOBS_RUNNER) {
    return;
  }

  // Spawn a job runner and start the Kue HTTP server
  // We run each module's jobs in its own thread
  if ('undefined' === typeof options.spawnRunner || options.spawnRunner === true) {

    var kuePath = path.dirname(require.resolve('kue'))
      , expressPath = path.join(kuePath, 'node_modules/express')
      , express = require(expressPath)
      , app = express.createServer();

    app.use(express.basicAuth(options.kue.username, options.kue.password));
    app.use(kue.app);

    var httpServer;
    var connectHttpServer = function () {
      httpServer = app.listen(options.kue.port);
    };
    app.on('error', function (e) {
      if (e.code == 'EADDRINUSE') {
        process.nextTick(connectHttpServer);
      }
    })
    connectHttpServer();

    logger.log('Kue server available on port', options.kue.port);

    // Every 50 ms, search for delayed jobs that need to be promoted
    jobsKue.promote(50);

    process.on('exit', function () {
      httpServer.close();
      httpServer.on('close', function () {
        // Tell the job processors to stop
        for (var i in runners) {
          (function (runner) {
            runner.send({stop:true});
          })(runners[i]);
        }
      });
    });

    spawnRunner = function (moduleName, jobName, methodName, callback) {
      var runnerIndex = moduleName;
      if (!runners[runnerIndex]) {
        runners[runnerIndex] = fork(path.join(__dirname, 'job_runner.js'), [], { cwd: process.cwd() });
        runners[runnerIndex].ready = false;
      }
      if (runners[runnerIndex].ready) {
        return callback(runners[runnerIndex]);
      }
      runners[runnerIndex].on('disconnect', function () {
        if (!dead) {
          runners[runnerIndex] = null;
          spawnRunner(moduleName, jobName, methodName, callback);
        }
      })

      runners[runnerIndex].send({ redis: redisOptions });

      if (options.initScript) {
        runners[runnerIndex].on('message', function (msg) {
          if (msg.ready) runners[runnerIndex].ready = msg.ready;
          return callback(runners[runnerIndex]);
        });
        runners[runnerIndex].send({ initScript: path.resolve(options.initScript) });
      } else {
        runners[runnerIndex].ready = true;
        process.nextTick(function () {
          return callback(runners[runnerIndex]);
        });
      }
    };

    process.on('exit', function () {
      dead = true;
      for (var runnerIndex in runners) {
        if (runners[runnerIndex].connected) { 
          runners[runnerIndex].send({ die: true });
        }
      }
    });
  }
};

// Public API
// If "delayable" is true or a validation function,
// generate a delayer and scheduler method
// helperPath must be a full, resolved path to the helper module - so you
// can call addHelper like this:
// jobs.addHelper(fs.realpathSync('./lib/url.js'))
module.exports.addHelper = function (helper) {
  return process.nextTick(function () {
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
          var moduleName = helper.exports.name;
          var jobName = moduleName+'.'+methodName;

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
            return jobsKue.create(jobName, { title: jobName, args: args })
              .delay(configArguments[0])
              .priority(configArguments[1])
              .save();
          };

          // Do not send message to runner if we're in the runner
          if (process.env.IN_JOBS_RUNNER) {
            return;
          }

          spawnRunner(moduleName, jobName, methodName, function (runner) {
            if (!runner || !runner.ready) {
              logger.log('Job: spawnRunner: wait for runner');
              waitForRunner();
            } else {
              runner.send({
                listenFor: jobName,
                moduleName: moduleName,
                methodName: methodName,
                helperPath: helperPath,
                concurrentProcesses: parseInt(method.concurrentProcesses) || 1,
                maxJobTime: parseInt(method.maxProcessingTime) || 0
              });
            }
          });
        })(method, methodName);
      }
    }
  });
};

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
 *
 * TODO: simplify API for running jobs manually.
 * TODO: API for querying existing jobs.
 */

var Job = require('kue/lib/queue/job.js')
  , redis = require('redis')
  , jobProcessor = require('./process.js')
  , fork = require('child_process').fork
  , path = require('path')
  , runners = {}
  , options = {}
  , logger = console
  , Resque = require('coffee-resque')
  , Kue = require('kue')
  , resque
  , jobsKue;

var spawnRunner = function () {};
var dead = false;

module.exports.init = function (_options) {
  options = _options;

  options = options || {};

  logger = options.logger || logger;

  options.kue = options.kue || {};
  options.kue.port = options.kue.port || 2424;
  var redisOptions = options.redis || {host: '127.0.0.1', port: '6379'};

  Kue.redis.createClient = function() {
    var client = redis.createClient(redisOptions.port, redisOptions.host);
    if (redisOptions.auth) client.auth(redisOptions.auth);
    return client;
  };
  jobsKue = Kue.createQueue();

  // As of 1.7.0 we're experimenting with using Coffee-Resqueue instead of Kue for any jobs that 
  // don't need to be delayed.
  resque = require('coffee-resque').connect({
    timeout: 100,
    host: redisOptions.host,
    port: redisOptions.port,
    password: redisOptions.auth
  });

  // Every 50 ms, search for delayed jobs that need to be promoted
  jobsKue.promote(50);

  if (process.env.IN_JOBS_RUNNER) {
    return jobsKue;
  }

  // Spawn a job runner and start the Kue HTTP server
  // We run each module's jobs in its own thread
  if ('undefined' === typeof options.spawnRunner || options.spawnRunner === true) {

    var kuePath = path.dirname(require.resolve('kue'))
      , expressPath = path.join(kuePath, 'node_modules/express')
      , express = require(expressPath)
      , app = express.createServer();

    if (options.kue.username && options.kue.password) {
      app.use(express.basicAuth(options.kue.username, options.kue.password));
    }
    app.use(Kue.app);

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

    process.on('exit', function () {
      httpServer.on('close', function () {
        // Tell the job processors to stop
        for (var i in runners) {
          (function (runner) {
            runner.send({stop:true});
          })(runners[i]);
        }
      });
      httpServer.on('error', function () {
        console.log('Already closed.')
      });

      try {
        httpServer.close();
      } catch (e) {
        console.log(e);
      }
    });

    spawnRunner = function (moduleName, jobName, methodName, callback) {
      var runnerIndex = moduleName;
      if (!runners[runnerIndex]) {
        runners[runnerIndex] = fork(path.join(__dirname, 'job_runner.js'), [], { cwd: process.cwd() });
        runners[runnerIndex].ready = false;

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
      }

      return callback(runners[runnerIndex]);
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

  return jobsKue;
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
          var jobName = moduleName+'.'+methodName; // `listenFor` in process.js

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

            if (!(resque && jobsKue)) {
              throw new Error('Cannot create delayed job: you must initialize Job first.');
            }

            // Verify that the first two arguments are delay, priority
            if (typeof configArguments[0] !== 'number') {
              throw new Error('Cannot create delayed job: argument 0 must be an integer [delay milliseconds]');
            }
            if (!(configArguments[1] in Job.priorities)) {
              throw new Error('Cannot create delayed job: argument 1 must be a priority ("'+Object.keys(Job.priorities).join('", "')+'")');
            }

            var args = configArguments.splice(2);

            // We use Kue for delayed jobs and Resque for jobs we need to process now
            // Generally speaking Resque is more reliable.
            if (configArguments[0] === 0) {
              return resque.enqueue(jobName, 'job', [args]);
            } else {
              return jobsKue.create(jobName, { title: jobName, args: args })
                .delay(configArguments[0])
                .priority(configArguments[1])
                .save();
            }
          };

          // For manually processing jobs
          helper.exports[methodName].process = function () {
            jobProcessor.process({ kue: jobsKue, resque: resque }, methodName, helper.exports, method);
          };

          // Do not send message to runner if we're in the runner
          if (process.env.IN_JOBS_RUNNER) {
            return;
          }

          // Some methods want to be run manually by calling jobsKue.process themselves.
          if (method.job_run_manually) {
            return;
          }

          var onSpawnRunner = function (runner) {
            if (!runner || !runner.ready) {
              setTimeout(function () {
                spawnRunner(moduleName, jobName, methodName, onSpawnRunner);
              }, 1000);
            } else {
              runner.send({
                moduleName: moduleName,
                methodName: methodName,
                helperPath: helperPath
              });
            }
          };
          spawnRunner(moduleName, jobName, methodName, onSpawnRunner);
        })(method, methodName);
      }
    }
  });
};

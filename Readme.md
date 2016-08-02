Job
===

What is Job?
------------

Job is a delayed jobs scheduler inspired by the Ruby project [delayed_job](https://github.com/collectiveidea/delayed_job) and written for SpanDeX.io.

Where before you might write `mailer.registrationEmail('userID')`, you can now write `mailer.delay.registrationEmail(5*1000, 'medium', 'userID')` to delay the email by 5 minutes.

Installation
------------

Add to `package.json` and install via npm:

    npm install job

And wherever you bootstrap your application, you need to require('job') and initialize it:

    require('job').startJobsRunner({ kue: { username: 'example', password: 'password', port: 2442 }})

Optionally, you may provide the path of an initialization script that will bootstrap the jobs runner, since all delayed jobs are run in a separate process. You may need to initialize a database connection, for example. In the future I would like to better support Architect plugins to eliminate the need for a dedicated startup script.

    require('job').startJobsRunner({ initScript: './init_job_worker.js', kue: { username: 'example', password: 'password', port: 2442 }})

And the initialization script should be in the form:

    module.exports = function initJobsWorker (done) {
      // Initialize database connections, etc
      done();
    };

Then, in any modules where you want to have a delayed job:

    exports.registationEmail = function (userID) {
      model.Users.findById(userID).exec(function (err, user) {
        // ... send out email
      });
    };

becomes:

    exports.registationEmail = function (userID) {
      model.Users.findById(userID).exec(function (err, user) {
        // ... send out email
      });
    };
    exports.registationEmail.delayable = true;

    require('job').addHelper(module);

That's it! Note that your helper method _must take database IDs, not objects_;
generally, anything passed into the helper method will first be serialized into Redis, and furthermore will be accessed in a different process.
Thus, things like Mongoose objects or anything that requires lookup in an in-memory cache are out.

Delay the method by calling:

    lib.delay.registrationEmail(ms, 'priority', args)

where `ms` is the number of milliseconds to delay by, and priority is 'low', 'medium', 'high', or 'critical'.

As a job queue server
---------------------
Job can also be used as a simple queue server. For example, if you want to perform an operation ASAP but only want to perform X operations simultaneously:

    exports.method = function () { ... }
    exports.method.delayable = true;
    exports.method.concurrentProcesses = 5;

Then, you can call `lib.delay.method(0, 'critical', ...)`.

By default, `concurrentProcesses` is 1.

Kue server
----------
Job uses a Kue server to process jobs. The Kue username, password, and port you provide can be used to monitor the status of delayed jobs.

For example, if SpanDeX.io had supplied a port of 1234, we could go to SpanDeX.io:1234, type in the username and password, and monitor the health of all delayed jobs.

Contributors
-----
Joshua Gross, joshua.gross@gmail.com (creator)

License
-------
MIT license.

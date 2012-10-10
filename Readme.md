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

Optionally, you may provide the path of an initialization script that will bootstrap the jobs runner, since all delayed jobs are run in a separate process. You may need to initialize a database connection, for example.

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

Contributors
-----
Joshua Gross, josh@spandex.io (creator)

License
-------
MIT license.

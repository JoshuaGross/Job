// Test using Job as a "cron" processor by ensuring that a job is periodically run
var job = require('../')
  , expect = require('expect.js');

var emailModule = {
  exports: { }
};
emailModule.filename = 'email.js';
emailModule.exports.name = 'mailLib';
emailModule.exports.emailsSent = 0;
emailModule.exports.sendMail = function sendMail (email, subject, message, callback) {
  if (typeof email === 'function') {
    callback = email; email = undefined;
  }

  if (email === subject && subject === message && typeof message === 'undefined') {
    console.log('processing email repeatedly');
    emailModule.exports.emailsSent++;
  } else {
    console.log('processing email normally');
  }

  callback && callback();
};
emailModule.exports.sendMail.delayable = true;
emailModule.exports.sendMail.job_run_manually = true;
emailModule.exports.sendMail.repeatedIntervalDelay = 1500; // every 1.5 seconds
emailModule.exports.sendMail.maxProcessingTime = 200; // hurry up!

describe('job module', function () {
  it('should allow us to register helpers, initialize, etc.', function (done) {
    job.addHelper(emailModule);
    job.init();
    process.nextTick(done);
  });
  it('should allow us to start the jobs processor', function (done) {
    emailModule.exports.sendMail.process();
    done();
  });
  it('should have processed no jobs at first', function (done) {
    this.timeout(0);

    process.nextTick(function () {
      expect(emailModule.exports.emailsSent).to.be(0);
      done();
    });
  });
  it('should have processed one job right immediately', function (done) {
    setTimeout(function () {
      expect(emailModule.exports.emailsSent).to.be(1);
      done();

    }, 50);
  });
  it('should process other jobs repeatedly and periodically', function () {
    setTimeout(function () {
      expect(emailModule.exports.emailsSent).to.be(2);

      setTimeout(function () {
        expect(emailModule.exports.emailsSent).to.be(3);
        done();
      }, 3000);

    }, 15000);
  });
});

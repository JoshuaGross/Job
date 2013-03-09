var job = require('../')
  , expect = require('expect.js');

var emailModule = {
  exports: { }
};
emailModule.filename = 'email.js';
emailModule.exports.name = 'mailLib';
emailModule.exports.emailsSent = 0;
emailModule.exports.sendMail = function sendMail (email, subject, message) {
  console.log('processing email')
  emailModule.exports.emailsSent++;
};
emailModule.exports.sendMail.delayable = true;

describe('job module', function () {
  it('should allow us to register helpers', function (done) {
    job.addHelper(emailModule);
    process.nextTick(done);
  });
  it('should allow us to initialize Job', function (done) {
    job.init();
    done();
  });
  it('should allow us to delay jobs', function (done) {
    emailModule.exports.delay.sendMail(1, 'critical', 'josh@spandex.io', 'Hello', 'world');
    done();
  });
  it('should allow us to start the jobs processor', function (done) {
    emailModule.exports.sendMail.process();
    done();
  });
  it('should have processed our mail job', function (done) {
    setTimeout(function () {
      expect(emailModule.exports.emailsSent).to.be(1);
      done();
    }, 50);
  });
});

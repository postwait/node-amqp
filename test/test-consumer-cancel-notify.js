var harness = require('./harness');

if (typeof(options.clientProperties) === 'undefined') {
  options.clientProperties = {};
}
if (typeof(options.clientProperties.capabilities) === 'undefined') {
  options.clientProperties.capabilities = {};
}
options.clientProperties.capabilities.consumer_cancel_notify = true;

var connection = harness.run();
var notifyCount = 0;

connection.once('ready', function() {
  // set a timer to close things if we're not done in one second
  var finisherId = setTimeout(function () {
    connection.end();
  }, 1000);

  connection.queue('node-ccn-queue', function(q) {
    q.bind("#")
    q.on('queueBindOk', function() {
      q.on('basicCancel', function(args) {
        notifyCount++;
      });

      q.on('close', function() {
          connection.end();
          clearTimeout(finisherId);
      });

      q.on('basicConsumeOk', function () {
        connection.queue('node-ccn-queue', function(q2) {
          q2.destroy();
        });
      });

      q.subscribe(function (m) {
        // no-op
      })
    });
  });
});


process.addListener('exit', function () {
  assert.equal(1, notifyCount);
});

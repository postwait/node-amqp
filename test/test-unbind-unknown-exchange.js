var conn = require('./harness').createConnection();

var caughtError = false;

var later = function(fun) {
    setTimeout(fun, 500);
};
conn.once('ready', function () {
  puts("connected to " + conn.serverProperties.product);

  var q = conn.queue('node-simple-queue');

  try {
    q.unbind('unknown-exchange', 'routing-key');
  } catch(e) {
    caughtError = true;
  }

  later(function() {
    conn.end();
    process.exit();
  });
});

process.addListener('exit', function () {
    assert.equal(caughtError, false);
});

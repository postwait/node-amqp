require('./harness');

connection.removeListener('error', errorCallback);
connection.addListener('error', function (err) {
  assert.equal(err.code, 530)
  assert.ok(err.message.indexOf('NOT_ALLOWED') == 0);
});

connection.on('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  var exchange = connection.exchange('node-queue-args', {type: 'fanout'});

  connection.queue('node-queue-args-queue', {
      'arguments': {'x-expires': 3600000}
  }, function(q) {
    puts("queue declared");
    connection.queue('node-queue-args-queue', {
        'arguments': {'x-expires': 3600001}
    }, function(q2) {
    });
  });
});

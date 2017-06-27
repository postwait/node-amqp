global.options = { heartbeat: 1 };

require('./harness').run();

var isClosed = false, q;

setTimeout(function() {
  assert.ok(!isClosed);
  setTimeout(function() {
    connection.disconnect()
    setTimeout(function() {
      connection.options['heartbeat'] = 0;
    }, 2000);
  }, 2000);
}, 1000);

connection.on('heartbeat', function() {
  puts(" <- heartbeat");
});
connection.on('heartbeat_fail', function() {
  assert.ok(isClosed);
  puts(" <- heartbeat_fail");
  connection.reconnect()
});
connection.on('close', function() {
  puts("closed");
  isClosed = true;
});
connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  q = connection.queue('node-test-heartbeat', {autoDelete: true});
  q.on('queueDeclareOk', function (args) {
    puts('queue opened.');
    assert.equal(0, args.messageCount);
    assert.equal(0, args.consumerCount);

    q.bind("#");
    q.subscribe(function(json) {
      // We should not be subscribed to the queue, the heartbeat will peter out before.
      assert.ok(false);
    });
  });
});
require('./harness');

connection.addListener('ready', function() {
  puts("connected to " + connection.serverProperties.product);
  
  connection.exchange('test-exchange', {type: 'topic'}, function(exchange) {
    var namedQueue = connection.queue('test_queue', function(queue) {
      assert.ok(connection.queues['test_queue'] != null, 'Queue reference not saved in queue array');
      
      var q = connection.queue('', function(queue) {
        assert.ok(connection.queues[''] == null, 'Queue saved with empty string');
        assert.ok(connection.queues[queue.name] != null, 'Queue not saved with real name');
        puts("All tests passed");
        connection.end();
      });
    });
  });
});

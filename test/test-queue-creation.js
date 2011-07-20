require('./harness');

// Test callback called, even if the queue already exists

var callbacks = 0;

connection.on('ready', function() {

  var queueName = 'node-test-queue-creation';
  var queueOpts = {'durable': false};

  var q = connection.queue(queueName, queueOpts, function() {
    callbacks++;
    // This should still call the callback, even though the queue has
    // been memoised already.
    connection.queue(queueName, queueOpts, function() {
      callbacks++;
    });
    connection.end();
  });

});

process.addListener('exit', function() {
  assert.equal(2, callbacks);
});

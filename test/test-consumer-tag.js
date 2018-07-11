require('./harness').run();

var queueName = 'node-consumer-tag-test';
var consumerTag = 'testingConsumerTag';

connection.on('ready', function() {
  var q = connection.queue(queueName, {autoDelete: false}, function() {
    q.subscribe({consumerTag});

    assert.ok(Object.keys(q.consumerTagOptions)[0].includes(consumerTag));
    connection.end();
  });
});


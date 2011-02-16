require('./harness');

var recvCount = 0;

connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  var exchange1 = connection.exchange('node-conn-share1', {type: 'direct'});
  var exchange2 = connection.exchange('node-conn-share2', {type: 'direct'});
  
  assert.equal(2, Object.keys(connection.exchanges).length);
  
  exchange2.destroy(); // checked at end

  var q1 = connection.queue('node-q1');
  var q2 = connection.queue('node-q2');
  
  q1.bind(exchange1, "node-consumer-1");
  q2.bind(exchange1, "node-consumer-2");

  assert.equal(2, Object.keys(connection.queues).length);
  
  q1.subscribe(function (m) {
    assert.equal('node-consumer-1', m._routingKey);
    recvCount++;
  })
  .addCallback(function () {
    exchange1.publish("node-consumer-1", 'foo');
    exchange1.publish("node-consumer-1", 'foo');
    exchange1.publish("node-consumer-2", 'foo');
  });
  
  q2.subscribe(function (m) {
    assert.equal('node-consumer-2', m._routingKey);
    recvCount++;
  })
  .addCallback(function () {
    exchange1.publish("node-consumer-1", 'foo');
    exchange1.publish("node-consumer-2", 'foo');
    q2.destroy();
    
    setTimeout(function () {
      // wait one second to receive the message, then quit
      connection.end();
    }, 1000);
  });
  
});

process.addListener('exit', function () {
  assert.equal(1, Object.keys(connection.exchanges).length);
  assert.equal(1, Object.keys(connection.queues).length);
  assert.equal(5, recvCount);
});

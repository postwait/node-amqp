require('./harness');

var recvCount = 0;
var body = "the devil is in the headers";

connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  var exchange = connection.exchange('node-simple-fanout', {type: 'fanout'});

  var q = connection.queue('node-simple-queue');

  q.bind(exchange, "*")

  q.subscribeRaw(function (m) {
    puts("--- Message (" + m.deliveryTag + ", '" + m.routingKey + "') ---");
    puts("--- headers: " + JSON.stringify(m.headers));

    recvCount++;

    assert.equal('bar', m.headers['foo']);
  })
  .addCallback(function () {
    puts("publishing message");
    exchange.publish("message.text", body, { headers: { foo: 'bar' } });

    setTimeout(function () {
      // wait one second to receive the message, then quit
      connection.end();
    }, 1000);
  });
});

process.addListener('exit', function () {
  assert.equal(1, recvCount);
});

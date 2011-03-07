require('./harness');
// test-type-and-headers.js
var recvCount = 0;
var body = "the devil is in the type, and also in the headers";

connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  var exchange = connection.exchange('node-simple-fanout', {type: 'fanout'});

  var q = connection.queue('node-simple-queue');

  q.bind(exchange, "*")

  q.subscribeRaw(function (m) {
    puts("--- Message (" + m.properties.deliveryTag + ", '" + m.properties.routingKey + "') ---");
    puts("--- type: " + m.properties.type);
    puts("--- headers: " + JSON.stringify(m.properties.headers));

    recvCount++;

    assert.equal('typeProperty', m.properties.type);
    assert.equal('fooHeader', m.properties.headers['foo']);
  })
  .addCallback(function () {
    puts("publishing message");
    exchange.publish("message.text", body, { 
		headers: { foo: 'fooHeader' },
		type: 'typeProperty', 
	});

    setTimeout(function () {
      // wait one second to receive the message, then quit
      connection.end();
    }, 1000);
  });
});


process.addListener('exit', function () {
  assert.equal(1, recvCount);
});

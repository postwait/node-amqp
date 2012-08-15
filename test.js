var amqp = require('./amqp');


var connection = amqp.createConnection({host: 'localhost'});


connection.addListener('close', function (e) {
  if (e) {
    throw e;
  } else {
    console.log('connection closed.');
  }
});


connection.addListener('ready', function () {
  console.log("connected to " + connection.serverProperties.product);

  var exchange = connection.exchange('clock', {type: 'fanout'});

  var q = connection.queue('my-events-receiver', function(q) {
    // Queue ready
    q.bind(exchange, "*", function () {
      console.log("publishing message");
      exchange.publish("message.json", {hello: 'world', foo: 'bar'});
      exchange.publish("message.text", 'hello world', {contentType: 'text/plain'});
    });

    q.subscribeRaw(function (m) {

      console.log("--- Message (" + m.deliveryTag + ", '" + m.routingKey + "') ---");
      console.log("--- contentType: " + m.contentType);

      m.addListener('data', function (d) {
        console.log(d.toString());
      });

      m.addListener('end', function () {
        m.acknowledge();
        console.log("--- END (" + m.deliveryTag + ", '" + m.routingKey + "') ---");
      });
    });
  });
});
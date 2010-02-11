var sys =  require('sys');
var amqp = require('./amqp');


var connection = amqp.createConnection({host: 'localhost'});


connection.addListener('close', function (e) {
  if (e) {
    throw e;
  } else {
    sys.puts('connection closed.');
  }
});


connection.addListener('ready', function () {
  sys.puts("connected to " + connection.serverProperties.product);

  var exchange = connection.exchange('clock', {type: 'fanout'});

  var q = connection.queue('my-events-receiver');

  q.bind(exchange, "*").addCallback(function () {
    sys.puts("publishing message");
    exchange.publish("hello", "hello world");
  });

  q.subscribe(function (m) {
    sys.puts("--- Message (" + m.deliveryTag + ", '" + m.routingKey + "') ---");

    m.addListener('data', function (d) {
      sys.puts(d);
    });

    m.addListener('end', function () {
      m.acknowledge();
      sys.puts("--- END (" + m.deliveryTag + ", '" + m.routingKey + "') ---");
    });
  });
});

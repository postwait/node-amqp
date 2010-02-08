var sys =  require('sys');
var amqp = require('./amqp');


var connection = amqp.createConnection({ port: 5672, host: 'localhost' });


connection.addListener('close', function (e) {
  if (e) {
    throw e;
  } else {
    sys.puts('connection closed.');
  }
});


connection.addListener('ready', function () {
  sys.puts("connected to " + connection.serverProperties.product);  

  var exchange = connection.exchange('ex');

  var q = connection.queue('my-events-receiver');

  q.bind(exchange, "*");

  q.subscribe(function (m) {
    sys.puts("--- Message (" + m.deliveryTag + ", '" + m.routingKey + "') ---");

    m.addListener('data', function (d) {
      sys.puts(d);
    });

    m.addListener('end', function () {
      m.acknowledge();
    });
  });
});

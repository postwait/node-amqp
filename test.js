var sys =  require('sys');
var amqp = require('./amqp');

var conn = amqp.createConnection({
// host: 'dev.rabbitmq.com',
  host: '8.19.35.89',
  port: 5672
});

conn.addListener("close", function() {
  sys.puts("connection closed.... ");
});

conn.addListener("connect", function() {
  sys.puts('connect');

  var q = conn.queue('my-events-receiver');

  q.bind("amq.rabbitmq.log", "*");

  q.addListener("message", function (m) {
    sys.puts("--- Message (" + m.deliveryTag + ", '" + m.routingKey + "') ---");

    m.addListener('data', function (d) {
      sys.puts(d);
    });

    m.addListener('end', function () {
      m.acknowledge();
    });
  });
});


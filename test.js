var sys =  require('sys');
var amqp = require('./amqp');

var conn = amqp.createConnection({ port: 5672, host: 'localhost' });

conn.addListener('close', function (e) {
  throw e;
});

conn.addListener('ready', function () {
  sys.puts("connected to " + conn.serverProperties.product);  
  var q = conn.queue('my-events-receiver');

  q.bind("", "*");

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

var sys =  require('sys');
var amqp = require('./amqp');

var conn = amqp.createConnection({
  host: 'dev.rabbitmq.com',
  port: 5672
});

conn.addListener("connect", function() {
  sys.puts('connect');

  var q = conn.queue('my-events-receiver');

  q.bind("amq.rabbitmq.log", "*");

  q.addListener("message", function (m) {
    sys.puts("RECV: " + m);
  });
});


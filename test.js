
var sys =  require('sys');
var amqp = require('./amqp');

var conn = amqp.createConnection({
  host: 'dev.rabbitmq.com',
  port: 5672
});

conn.addListener("connect", function() {
  sys.puts('connect');

  var queue = conn.queue('my-events-receiver');


  queue.addListener("connect", function() {
    queue.bind('events');
  });

  queue.addListener("message", function (m) {
    sys.puts("RECV: " + m);
  });
});

require.paths.unshift('lib');

var sys =  require('sys');
var AMQP = require('amqp');

var conn = AMQP.createConnection({
  host: 'localhost',
  port: 5672
});

conn.addListener("connect", function() {
  var queue = conn.queue('my-events-receiver');


  queue.addListener("connect", function() {
    queue.bind('events');
  });
  queue.addListener("receive", function(content) {
    sys.puts("RECV: " + content);
  });
});

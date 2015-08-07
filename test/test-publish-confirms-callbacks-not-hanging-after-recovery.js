var assert = require('assert');
var amqp = require('../amqp');
var exec = require('child_process').exec;

var cycleServer = function (stoppedCallback, startedCallback) {
  // If you're running a cluster you can do this:
  // 'killall -9 beam.smp'
  // to test out hard server fails.  Note however that you probably do want a
  // cluster because killing a single server this way causes even durable
  // queues to be deleted, causing the bindings we create to be removed.
  exec('rabbitmqctl stop_app', function () {
    if (stoppedCallback) {
      stoppedCallback();
    }
    setTimeout(function () {
      // Likewise you can bring up a hard server crash this way:
      // 'rabbitmq-server -detached'
      exec('rabbitmqctl start_app', function () {
        console.log('start triggered');
        if (startedCallback) {
          setTimeout(startedCallback, 500);
        }
      });
    // Leave the server down for 1500ms before restarting.
    }, 1500);
  });
};

var connection, exchange;
var timeout = null, didntHang = false, confirmed = 0, erroredAfterShutdown = 0;


exec('which rabbitmqctl', function(err) {
  if (err != null) {
    console.log('skipping test, rabbitmqctl not availabe');
    process.exit(0);
  }

  connection = amqp.createConnection(global.options || {}, { reconnect: true, reconnectBackoffTime: 500 }, function(connection) {
    exchange = connection.exchange('node-publish-confirms', { type: 'fanout', confirm: true }, function(exchange) {
      // publishing right before thhe server is stopped; must not "hang".
      exchange.publish("", "hello", {}, function() {
        console.log('callback fired for a message published right before the shutdown');
        didntHang = true;
      });
      cycleServer(function() {
        console.log('server stopped');
        var incErrored = function(err) { console.log('received ack error'); if (err) { erroredAfterShutdown++; } };
        exchange.publish("", "hello", {}, incErrored);
        exchange.publish("", "hello", {}, incErrored);
        exchange.publish("", "hello", {}, incErrored);
      }, function() {
        console.log('server started');
        exchange.publish("", "hello2", {}, function() {   // this one must not "hang"
          console.log('acked');
          confirmed++;
          clearTimeout(timeout);
          connection.end();
        });
      });
    });
  });

  timeout = setTimeout(function() {
    process.exit();
  }, 15000);

  process.on('exit', function(){
    try {
      assert(didntHang);
      assert.equal(erroredAfterShutdown, 3);
      assert.equal(confirmed, 1);
    } finally {
      if (exchange) {
        exchange.destroy();
      }
      if (connection) {
        connection.setImplOptions({ 'reconnect': false });
        connection.destroy();
      }
    }
  });
});

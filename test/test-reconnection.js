var assert = require('assert');
var amqp = require('../amqp');
var exec = require('child_process').exec;

var options = global.options || {};
if (process.argv[2]) {
  var server = process.argv[2].split(':');
  if (server[0]) options.host = server[0];
  if (server[1]) options.port = parseInt(server[1]);
}

var implOpts = {
  defaultExchangeName: 'amq.topic'
};

var cycleServer = function (stoppedCallback, startedCallback) {
  exec('rabbitmqctl stop_app', function () {
    setTimeout(function () {
      if (stoppedCallback) {
        stoppedCallback();
      }
      exec('rabbitmqctl start_app', function () {
        if (startedCallback) {
          setTimeout(startedCallback, 500);
        }
      });
    }, 500);
  });
}

var readyCount = 0;
var errorCount = 0;
var closeCount = 0;
var messageCount = 0;

var runTest = function () {
  console.log("Starting...");
  
  var connection = amqp.createConnection(options, implOpts);
  var exchange = null;
  var queue = null;
  var exit = false;
  var done = function (error) {
    if (exchange) {
      exchange.destroy();
    }
    if (queue) {
      queue.destroy();
    }
    if (error) {
      // Exit loudly.
      console.log('Error: "' + error + '", abandoning test cycle');
      throw error;
    } else {
      console.log('All done!');
      // Exit gracefully.
      connection.destroy();
    }
    exit = true;
  }
  connection.on('ready', function() {
    readyCount += 1;
    console.log('Connection ready (' + readyCount + ')');
    
    if (readyCount === 1) {
      // Create an exchange.  Make it durable, because our test case shuts down the exchange
      // in lieu of interrupting network communications.
      exchange = connection.exchange('node-reconnect-exchange', {type: 'topic', durable: true});
      // Now, create a queue.  Bind it to an exchange, and pump a few messages
      // in to it.  This is just to prove that the queue is working *before*
      // we disconnect it.  Remember to make it durable for the same reason
      // as the exchange.
      connection.queue('node-reconnect-queue', {autoDelete: false, durable: true}, function (q) {
        queue = q;
        queue.on('queueBindOk', function () {
          queue.once('basicConsumeOk', function () {
            exchange.publish('node-reconnect', 'one');
            console.log('Message one published');
            exchange.publish('node-reconnect', 'two');
            console.log('Message two published');
          });
        });
        queue.bind(exchange, '#');
        queue.subscribe(function (message) {
          messageCount += 1;
          console.log('Message received (' + messageCount + '): ' + message.data);
          if (messageCount === 2) {
            // On the second message, restart the server.
            cycleServer(function () {
              // Don't wait for it to come back up, publish a message while it is down.
              exchange.publish('node-reconnect', 'three');
              console.log('Message three published');
            });
          } else if (messageCount === 4) {
            return done();
          }
        });
      });
    } else if (readyCount === 2) {
      // Ensure we get the rest of the messages from the queue.  This means
      // that the connection and queue were automatically reconnected with
      // no user interaction, and no messages were lost.
      // Publish another message after the connection has been restored.
      exchange.publish('node-reconnect', 'four');
      console.log('Message four published');
    }
  });
  connection.on('error', function (error) {
    errorCount += 1;
    console.log('Connection error (' + errorCount + '): ' + error);
  });
  connection.on('close', function () {
    closeCount += 1;
    console.log('Connection close (' + closeCount + ')');
  });
  var waitForExitConditions = function () {
    if (!exit) {
      setTimeout(waitForExitConditions, 500);
    }
  }
  waitForExitConditions();
};

runTest();

process.addListener('exit', function () {
  // 1 ready on initial connection, 1 on reconnection
  assert.equal(2, readyCount);
  // 4 messages sent and received
  assert.equal(4, messageCount);
});
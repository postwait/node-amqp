require('./harness').run();

var channelMax = 65536; // 2^16

connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);
  
  // preset channel counter value near max limit
  connection.channelCounter = channelMax - 1;

  // opening a channel with channel counter up to channelMax is ok
  connection.exchange('amq.topic', {type: 'topic'}, function(exchange) {
    assert(connection.channelCounter, channelMax);

    // if the client tries to open a channel with counter value above channelMax, the request fails
    connection.exchange('amq.topic', {type: 'topic'}, function(exchange) {

      // if channel counter is above channelMax, this line should never be reached
      assert(connection.channelCounter != channelMax + 1);
      connection.end();
    });
  });
});

connection.addListener('error', function () {
  assert(0);
  connection.end();
});
// This effectively tests that a frame that takes more than one packet
// ('data' event) is parsed correctly.
// https://github.com/postwait/node-amqp/issues/65

require('./harness').run();

var recvCount = 0;
var bodySize = 256000;
var body = new Buffer(bodySize);

// Fill with random bytes
for (var i = 0; i < bodySize; i++ ){
  body[i] = Math.floor(Math.random()*256);
}

connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  connection.exchange('node-simple-fanout', {type: 'fanout'}, function(exchange) {
      connection.queue('node-simple-queue', function(q) {
        q.bind(exchange, "*")
        q.on('queueBindOk', function() {
          q.on('basicConsumeOk', function () {
            puts("publishing message");
            exchange.publish("message.text", body, {contentType: 'application/octet-stream'});

            setTimeout(function () {
              // wait one second to receive the message, then quit
              connection.end();
            }, 1000);
          });

          q.subscribeRaw(function (m) {
            puts("--- Message (" + m.deliveryTag + ", '" + m.routingKey + "') ---");
            puts("--- contentType: " + m.contentType);

            assert.equal('application/octet-stream', m.contentType);

            var chunks = [];
            m.addListener('data', function (d) { chunks.push(d); });

            m.addListener('end', function () {
              recvCount++;
              assert.equal(body.toString(), Buffer.concat(chunks).toString());
              m.acknowledge();
            });
          });
        });
      });
  });
});


process.addListener('exit', function () {
  assert.equal(1, recvCount);
});

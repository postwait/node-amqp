require('./harness');

var recvCount = 0;
var body = "hello world";

connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  var exchange = connection.exchange('node-json-fanout', {type: 'fanout'});

  var q = connection.queue('node-json-queue');

  q.bind(exchange, "*");

  q.subscribe(function (json) {
    recvCount++;

    switch (json._routingKey) {
      case 'message.json1':
        assert.equal(1, json.one);
        assert.equal(2, json.two);
        break;

      case 'message.json2':
        assert.equal('world', json.hello);
        assert.equal('bar', json.foo);
        break;

      default:
        throw new Error('unexpected routing key: ' + json._routingKey);
    }
  })
  .addCallback(function () {
    puts("publishing 2 json messages");
    exchange.publish('message.json1', {two:2, one:1});
    exchange.publish('message.json2', {foo:'bar', hello: 'world'}, {contentType: 'application/json'});

    setTimeout(function () {
      // wait one second to receive the message, then quit
      connection.end();
    }, 1000);
  });
});


process.addListener('exit', function () {
  assert.equal(2, recvCount);
});

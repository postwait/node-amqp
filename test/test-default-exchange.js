require('./harness');

var recvCount = 0;
var body = "hello world";

connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  var q = connection.queue('node-default-exchange');

  q.bind("#");

  q.subscribe(function (msg) {
    recvCount++;

    switch (msg._routingKey) {
      case 'message.msg1':
        assert.equal(1, msg.one);
        assert.equal(2, msg.two);
        break;

      case 'message.msg2':
        assert.equal('world', msg.hello);
        assert.equal('bar', msg.foo);
        break;

      default:
        throw new Error('unexpected routing key: ' + msg._routingKey);
    }
  })
  .addCallback(function () {
    puts("publishing 2 msg messages");
    connection.publish('message.msg1', {two:2, one:1});
    connection.publish('message.msg2', {foo:'bar', hello: 'world'});

    setTimeout(function () {
      // wait one second to receive the message, then quit
      connection.end();
    }, 1000);
  });
});


process.addListener('exit', function () {
  assert.equal(2, recvCount);
});

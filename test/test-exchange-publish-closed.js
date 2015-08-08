require('./harness').run();

connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  var error;
  var exchange = connection.exchange('node-simple-fanout', {type: 'fanout'});
  exchange.publish('foo', 'data', {}, function(errored, err) {
    assert.ok(errored);
    error = err;

    setTimeout(function() {
      assert.equal(error.message, 'Can not publish: exchange is not open');
      connection.end();
      connection.destroy();
      process.exit();
    }, 1000);
  });
});


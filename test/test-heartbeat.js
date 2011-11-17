global.options = { heartbeat: 1 };

require('./harness');

connects = 0;
var closed = 0;

var hb = setInterval(function() {
  console.log(' -> heartbeat');
  connection.heartbeat();
}, 1000);

setTimeout(function() {
  assert.ok(!closed);
  clearInterval(hb);
  setTimeout(function() { assert.ok(closed); }, 3000);
}, 5000);

connection.on('heartbeat', function() {
  console.log(" <- heartbeat");
});
connection.on('close', function() {
  console.log('closed');
  closed = 1;
});
connection.addListener('ready', function () {
  connects++;
  console.log('connected to ' + connection.serverProperties.product);

  var e = connection.exchange();

  var q = connection.queue('node-test-hearbeat', {autoDelete: true});
  q.on('queueDeclareOk', function (args) {
    console.log('queue opened.');
    assert.equal(0, args.messageCount);
    assert.equal(0, args.consumerCount);

    q.bind(e, "#");
    q.subscribe(function(json) {
      assert.ok(false);
    });
  });
});

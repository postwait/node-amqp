global.options = { heartbeat: 10 };

require('./harness').run();

connection.addListener('ready', function () {
  puts("connected to " + connection.serverProperties.product);

  assert.ok(connection._inboundHeartbeatTimer);
  assert.ok(connection._outboundHeartbeatTimer);

  connection.end();
  assert.ok(!connection._inboundHeartbeatTimer);
  assert.ok(!connection._outboundHeartbeatTimer);
});

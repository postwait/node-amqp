require('./harness').run();
var cbcnt = 0;

// Only way to test if we disconnect cleanly is to look for
// connectionCloseOk response from server.
var oldOnMethod = connection._onMethod;
connection._onMethod = function (channel, method, args) {
  if (method.name === 'connectionCloseOk') {
    cbcnt++;
  }
  oldOnMethod.apply(connection, arguments);
};

// And verify that we do really call end on the socket.
connection.on('end', function() {
  cbcnt++;
});

connection.on('ready', function(){
  connection.disconnect();
});

process.addListener('exit', function () {
  assert.equal(cbcnt, 2);
});

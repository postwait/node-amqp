require('./harness').run();

connection.addListener('ready', function () {
  var callbackFired = false;

  // first call to ensure exchange exists
  connection.exchange('node-no-declare-and-confirm', {type: 'fanout'}, function () {

    connection.exchange('node-no-declare-and-confirm', { noDeclare: true, confirm: false }, function (exchange) {
      callbackFired = true;
    });
  });

  setTimeout( function() {
    assert.ok(callbackFired, "exchange not connected");
    connection.end();
    connection.destroy();
  }, 1000);
});

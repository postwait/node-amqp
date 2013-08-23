var harness = require('./harness');

options.host = [options.host,"nohost"];

var callbackCalled = false;

// 50% of the time, this will throw as it attempts to connect to 'nohost'. We want that, it should reconnect
// to options.host the next time.
try {
  harness.run();    
} catch(e) {
  // nothing
}

connection.on('ready', function() {
  callbackCalled = true;
  connection.destroy();
});

connection.on('close', function() {
  assert(callbackCalled);
});


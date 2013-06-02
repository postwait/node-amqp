testLog = function(name, message) { console.log("Test case: "+name+":", message); };
assert =  require('assert');
amqp = require('../amqp');

var options = global.options || {};
if (process.argv[2]) {
  var server = process.argv[2].split(':');
  if (server[0]) options.host = server[0];
  if (server[1]) options.port = parseInt(server[1]);
}


options.host = [options.host,"nohost"];

var implOpts = {
  defaultExchangeName: 'amq.topic'
};

//If we specify a number bigger than the array, amqp.js will just use the last element in the array
for (var i = 0; i < 3; i++){
  (function(i){
    var connection;
    var connectionOptions = options;
    connectionOptions.hostPreference = i;
  
    console.log("Connecting to host " + i + " " + options.host[i]);
    connection = amqp.createConnection(connectionOptions, implOpts);
  
    connection.on('ready', function() {
        connection.destroy();
    });

  })(i);

}






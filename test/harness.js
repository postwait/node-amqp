global.sys =  require('sys');
puts = sys.puts;
global.assert =  require('assert');
global.amqp = require('../amqp');

var options = global.options || {};
if (process.argv[2]) {
  var server = process.argv[2].split(':');
  if (server[0]) options.host = server[0];
  if (server[1]) options.port = parseInt(server[1]);
}
var implOpts = {
  defaultExchangeName: 'amq.topic'
};

global.connection = amqp.createConnection(options, implOpts);

global.connection.addListener('error', function (e) {
  throw e;
})

global.connection.addListener('close', function (e) {
  sys.puts('connection closed.');
});


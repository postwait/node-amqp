var assert = require('assert');
var amqp = require('../amqp');
var exec = require('child_process').exec;

var options = {
  host: '10.255.255.1',
  connectionTimeout: 1000
}
var implOpts = {
  reconnect: false,
};

console.log("Trying to connect to non-routable address");
var hasTimedOut = false;
var connection = amqp.createConnection(options, implOpts);
connection.on('error', function (e) {
  if (e.name === 'TimeoutError') hasTimedOut = true;
});

process.addListener('exit', function () {
  assert(hasTimedOut, 'connection didnt timeout');
});


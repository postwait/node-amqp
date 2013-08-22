'use strict';
var Connection = require('./lib/connection');
    
module.exports = {Connection: Connection};

module.exports.createConnection = function (options, implOptions, readyCallback) {
  var c = new Connection(options, implOptions, readyCallback);
  // c.setOptions(options);
  // c.setImplOptions(implOptions);
  c._connect();
  return c;
};
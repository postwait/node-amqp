'use strict';
var debugLevel = process.env['NODE_DEBUG_AMQP'] ? 1 : 0;

var DEBUG = debugLevel > 0 || true;

module.exports = function debug () {
  if (DEBUG) console.error.apply(null, arguments);
};


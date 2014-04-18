'use strict';

var DEBUG = process.env['NODE_DEBUG_AMQP'];

// only define debug function in debugging mode
if (DEBUG) {
  module.exports = function debug () {
    console.error.apply(null, arguments);
  };
} else {
  module.exports = null;
}


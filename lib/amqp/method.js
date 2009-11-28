S11n = require("./serialization");

exports.serialize = function() {
  var method = arguments[0];
  var channel = arguments[1];
  var bitBuffer = 0;
  var bitCount = 0;


  var flushBits = function() {
    if (bitCount > 0) {
      payload += S11n.format(bitBuffer, 'octet');
      bitBuffer = 0;
      bitCount = 0;
    }
  }

  payload = '';
  payload += S11n.format(method[0], 'short');
  payload += S11n.format(method[1], 'short');
  for(var i = 2; i < arguments.length; i++) {
    if (method[i] == 'bit') {
      bitBuffer += (1 << bitCount) * arguments[i];
      bitCount += 1
      if (bitCount == 8)
        flushBits();
    } else {
      flushBits();
      payload += S11n.format(arguments[i], method[i]);
    }
  }
  flushBits();

  // TODO: Move to Frame.serialize
  message =  S11n.format(1, 'octet');
  message += S11n.format(channel, 'short');
  message += S11n.format(payload.length, 'long');
  message += payload;
  message += String.fromCharCode(206);

  return message;
}

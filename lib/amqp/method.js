S11n = require("./serialization");

exports.serialize = function() {
  var method = arguments[0];
  var channel = arguments[1];

  payload = '';
  payload += S11n.format(method[0], 'short');
  payload += S11n.format(method[1], 'short');
  for(var i = 2; i < arguments.length; i++) {
    payload += S11n.format(arguments[i], method[i]);
  }

  // TODO: Move to Frame.serialize
  message =  S11n.format(1, 'octet');
  message += S11n.format(channel, 'short');
  message += S11n.format(payload.length, 'long');
  message += payload;
  message += String.fromCharCode(206);
  return message;
}

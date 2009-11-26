Buffer = require("buffer");
require("constants");

exports.deserialize = function(data) {
  var buffer = Buffer.fromBytes(data);
  var result = {header:{
    type:    buffer.read('int', 1),
    //cycle:   buffer.read('int', 1), // WTF where is this octet
    channel: buffer.read('int', 2),
    size:    buffer.read('int', 4)
  }};

  result.payload = buffer.read('byte', result.header.size);
  result.footer  = buffer.read('int', 1);

  if (result.header.type == 1) { // METHOD
    var method = Buffer.fromBytes(result.payload);
    var identifier = [method.read('int', 2), method.read('int', 2)];

    for (x in Connection) {
      if (Connection[x][0] == identifier[0] && Connection[x][1] == identifier[1]) {
        result.method = Connection[x];
        break;
      }
    }
  }
  return result;
}

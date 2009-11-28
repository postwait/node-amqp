Buffer = require("./buffer");
C = require("./constants");

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

    for (klass in C) {
      for (x in C[klass]) {
        if (C[klass][x][0] == identifier[0] && C[klass][x][1] == identifier[1]) {
          result.method = C[klass][x];
          break;
        }
      }
    }
  }
  return result;
}

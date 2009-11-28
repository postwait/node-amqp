Buffer = require("./buffer");
C = require("./constants");

// TODO: Support partial frames
exports.deserialize = function(data, callback) {
  var buffer = Buffer.fromBytes(data);
  while (!buffer.eof()) {
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
    } else if (result.header.type == 2) { // CONTENT HEADER
      var header = Buffer.fromBytes(result.payload);

      result.contentHeader = {
        class:         header.read('int', 2),
        weight:        header.read('int', 2),
        contentSize:   header.read('int', 8),
        propertyFlags: header.read('int', 2),
        properties:    header.read('byte', header.size - 14)
      }
    } else if (result.header.type == 3) { // CONTENT
      result.content = result.payload;
    }
    callback(result);
  }
  return '';
}

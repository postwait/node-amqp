exports.fromBytes = function(data) {
  var index = 0;
  var data = data;

  return({
    eof: function() { return index >= data.length; },
    read: function(type, size) {
      var bytes = data.substr(index, size);
      index += size;

      transforms = {
        'int': function(bytes, size) {
          var result = 0;
          for (var i = 0; i < size; i++) {
            var byte_pos = size - (i + 1);
            result += bytes.charCodeAt(byte_pos) << (i * 8);
          }
          return result;
        },
        'byte': function(bytes, size) {
          return bytes;
        }
      }

      return transforms[type](bytes, size);
    }
  });
}

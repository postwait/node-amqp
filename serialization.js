var sys = require('sys');
var int_to_bytestr = function(u, size) {
  var results = '';
  var u_shifted = u;
  var mask = 255;
  for (var i=0; i < size; i++) {
      // shift and mask bits in network order
      var u_mask = u_shifted & mask;
      results = String.fromCharCode(u_mask) + results;

      u_shifted = u_shifted >> 8;
  }

  return results;
}

S11n = {
  format: function(value, f) {
    formatters = {
      'octet': function(x) { return int_to_bytestr(x, 1); },
      'short': function(x) { return int_to_bytestr(x, 2); },
      'long':  function(x) { return int_to_bytestr(x, 4); }
    }
    formatters['shortstr'] = function(x) {
      var buffer = '';
      buffer += formatters.octet(x.length);
      buffer += x;
      return buffer;
    }
    formatters['longstr'] = function(x) {
      var buffer = '';
      buffer += formatters.long(x.length);
      buffer += x;
      return buffer;
    }
    formatters['table'] = function(x) {
      var payload = '';
      for (key in x) {
        payload += formatters.shortstr(key);
        payload += 'S';
        payload += formatters.longstr(x[key]);
      }
      return formatters.longstr(payload);
    }

    return formatters[f](value);
  }
}

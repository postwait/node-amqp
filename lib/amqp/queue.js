var Method = require("./method");
var Frame = require("./frame");
process.mixin(require('sys'));

exports.Queue = function(connection, options) {
  process.EventEmitter.call(this);

  this.init(connection, options);
}
inherits(exports.Queue, process.EventEmitter);

  function matchMethod(message, method) {
    return (message.method[0] == method[0] && message.method[1] == method[1]);
  }
var proto = exports.Queue.prototype;
proto.init = function(conn, options) {
  var self = this;
  conn.addListener("receive", function(data) {
    var message = Frame.deserialize(data);
    message.matchMethod = function(method) {
      return matchMethod(message, method);
    }
    if (message.matchMethod(C.Queue.DeclareOk)) {
      conn.sendDebug(Method.serialize(C.Queue.Bind, 1, 1, 'events', 'events', 0, {}));
    } else if (message.matchMethod(C.Queue.BindOk)) {
      conn.sendDebug(Method.serialize(C.Basic.Consume, 1, 1, 'events', 'events', 2));
    } else if (message.matchMethod(C.Basic.ConsumeOk)) {
      puts("CONSUMING");
    }
  });
  conn.send(Method.serialize(C.Queue.Declare, 1, 1, 'events', 0, {}));
}

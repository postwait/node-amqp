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
  conn.addListener("message", function(message) {
    puts(inspect(message));
    if (message.matchMethod(C.Queue.DeclareOk)) {
      conn.sendDebug(Method.serialize(C.Queue.Bind, 1, 1, 'events', 'events', 0, {}));
    } else if (message.matchMethod(C.Queue.BindOk)) {
      conn.sendDebug(Method.serialize(C.Basic.Consume, 1, 1, 'events', 'events', 2));
    } else if (message.matchMethod(C.Basic.ConsumeOk)) {
      puts("CONSUMING");
    } else if (message.matchContentHeader()) {
      puts("HEADER");
      self.contentBuffer = '';
      self.contentSize = message.contentHeader.contentSize;
    } else if (message.matchContent()) {
      puts("CONTENT");
      self.contentBuffer += message.content;
      puts(self.contentSize);
      puts(self.contentBuffer.length);

      if (self.contentBuffer.length >= self.contentSize) {
        self.emit("receive", self.contentBuffer);
        self.contentBuffer = '';
        self.contentSize = null;
      }
    }
  });
  conn.send(Method.serialize(C.Queue.Declare, 1, 1, 'events', 0, {}));
}

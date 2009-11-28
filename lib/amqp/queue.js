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
  self.conn = conn;
  self.options = options;

  var declareListener = function(message) {
    if (message.matchMethod(C.Queue.DeclareOk)) {
      self.emit("connect");
      self.conn.removeListener(declareListener);
    }
  }
  conn.addListener("message", declareListener);
  conn.addListener("message", function(message) {
    if (message.matchContentHeader()) {
      self.contentBuffer = '';
      self.contentSize = message.contentHeader.contentSize;
    } else if (message.matchContent()) {
      self.contentBuffer += message.content;

      if (self.contentBuffer.length >= self.contentSize) {
        self.emit("receive", self.contentBuffer);
        self.contentBuffer = '';
        self.contentSize = null;
      }
    }
  });
  conn.send(Method.serialize(C.Queue.Declare, 1, 1, self.options.name, 0, {}));
}

proto.bind = function(exchange) {
  var self = this;
  var bindListener = function(message) {
    if (message.matchMethod(C.Queue.BindOk)) {
      self.conn.send(Method.serialize(C.Basic.Consume, 1, 1, self.options.name, 'tag-1', 2));
    } else if (message.matchMethod(C.Basic.ConsumeOk)) {
      // Setup new listeners
      self.emit("bound")
      self.conn.removeListener(bindListener);
    }
  }
  self.conn.addListener("message", bindListener);
  self.conn.send(Method.serialize(C.Queue.Bind, 1, 1, self.options.name, exchange, 0, {}));
}

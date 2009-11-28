var sys = require('sys');
var tcp = require('tcp');
var Frame  = require("./frame");
var Method = require("./method");
var Queue  = require('./queue');
var C = require('./constants');

exports.createConnection = function(opts) {
  return new exports.Connection(opts);
}
exports.defaultOptions = {
  host: 'localhost',
  port: 5672,
  vhost: '/',
  login: 'guest',
  password: 'guest'
}

exports.Connection = function(options) {
  process.EventEmitter.call(this);

  this.init(options);
}
sys.inherits(exports.Connection, process.EventEmitter);

var proto = exports.Connection.prototype;
proto.init = function(options) {
  var self = this;
  var opts = {};
  process.mixin(opts, exports.defaultOptions, options);

  function matchMethod(message, method) {
    return (message.method[0] == method[0] && message.method[1] == method[1]);
  }

  var conn = tcp.createConnection(opts.port, opts.host);
  conn.sendDebug = function(data) {
    sys.puts("SEND: " + sys.inspect(data));
    conn.send(data);
  }
  conn.addListener("connect", function() {
    conn.send("AMQP" + String.fromCharCode(1,1,8,0));
  });

  conn.addListener("receive", function(data) {
    var message = Frame.deserialize(data);
    sys.puts(sys.inspect(message));

    message.matchMethod = function(method) {
      return matchMethod(message, method);
    }

    if (message.matchMethod(C.Connection.Start)) {
      conn.send(Method.serialize(C.Connection.StartOk, C.Channel.All, {
          version: '0.0.1',
          platform: 'node',
          information: 'no',
          product: 'node-amqp' },
        'AMQPLAIN',
        {LOGIN: opts.login, PASSWORD: opts.password},
        'en_US'
      ));
    } else if (message.matchMethod(C.Connection.Tune)) {
      conn.send(Method.serialize(C.Connection.TuneOk, C.Channel.All, 0, 131072, 0));
      conn.send(Method.serialize(C.Connection.Open, C.Channel.All, opts.vhost, '', 0));
    } else if (message.matchMethod(C.Connection.OpenOk)) {
      conn.send(Method.serialize(C.Channel.Open, 1, ''));
    } else if (message.matchMethod(C.Channel.OpenOk)) {
      self.conn = conn;
      self.emit('connect');
    }
  });
}

proto.queue = function(name) {
  return new Queue.Queue(this.conn, {});
}

var sys = require('sys');
var tcp = require('tcp');
var Frame  = require("./frame");
var Method = require("./method");

exports.createConnection = function(opts) {
  return new exports.AMQPConnection(opts);
}
exports.defaultOptions = {
  host: 'localhost',
  port: 5672,
  vhost: '/',
  login: 'guest',
  password: 'guest'
}

exports.AMQPConnection = function(options) {
  process.EventEmitter.call(this);

  this.init(options);
}
sys.inherits(exports.AMQPConnection, process.EventEmitter);

exports.AMQPConnection.prototype.init = function(options) {
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

    message.matchMethod = function(method) {
      return matchMethod(message, method);
    }

    if (message.matchMethod(Connection.Start)) {
      conn.send(Method.serialize(Connection.StartOk, Channel.All, {
          version: '0.0.1',
          platform: 'node',
          information: 'no',
          product: 'node-amqp' },
        'AMQPLAIN',
        {LOGIN: opts.login, PASSWORD: opts.password},
        'en_US'
      ));
    } else if (message.matchMethod(Connection.Tune)) {
      conn.send(Method.serialize(Connection.TuneOk, Channel.All, 0, 131072, 0));
      conn.send(Method.serialize(Connection.Open, Channel.All, opts.vhost, '', 0));
    } else if (message.matchMethod(Connection.OpenOk)) {
      self.emit('connect');
    }
  });
}

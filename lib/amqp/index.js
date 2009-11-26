var sys = require('sys');
var tcp = require('tcp');
var Frame  = require("./frame");
var Method = require("./method");

exports.createConnection = function(opts) {
  return new exports.AMQPConnection(opts);
}

exports.AMQPConnection = function(options) {
  process.EventEmitter.call(this);

  this.init(options);
}
sys.inherits(exports.AMQPConnection, process.EventEmitter);

exports.AMQPConnection.prototype.init = function(options) {
  var self = this;

  function matchMethod(message, method) {
    return (message.method[0] == method[0] && message.method[1] == method[1]);
  }

  var conn = tcp.createConnection(5672, 'localhost');
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
        {LOGIN: 'guest', PASSWORD: 'guest'},
        'en_US'
      ));
    } else if (message.matchMethod(Connection.Tune)) {
      conn.send(Method.serialize(Connection.TuneOk, Channel.All, 0, 131072, 0));
      conn.send(Method.serialize(Connection.Open, Channel.All, '/', '', 0));
    } else if (message.matchMethod(Connection.OpenOk)) {
      self.emit('connect');
    }
  });
}

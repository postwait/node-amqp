'use strict';
var events = require('events');
var util = require('util');
var net = require('net');
var tls = require('tls');
var fs = require('fs');
var _ = require('lodash');
var methods = require('./definitions').methods;
var Channel = require('./channel');
var debug = require('./debug');

var Exchange = module.exports = function Exchange (connection, channel, name, options, openCallback) {
  Channel.call(this, connection, channel);
  this.name = name;
  this.binds = 0; // keep track of queues bound
  this.exchangeBinds = 0; // keep track of exchanges bound
  this.sourceExchanges = {};
  this.options = _.defaults(options || {}, {autoDelete: true});
  this._openCallback = openCallback;

  this._sequence = null;
  this._unAcked  = {};
  this._addedExchangeErrorHandler = false;
};
util.inherits(Exchange, Channel);

// creates an error handler scoped to the given `exchange`
function createExchangeErrorHandlerFor (exchange) {
  return function (err) {
    if (!exchange.options.confirm) return;

    // should requeue instead?
    // https://www.rabbitmq.com/reliability.html#producer
    debug && debug('Exchange error handler triggered, erroring and wiping all unacked publishes');
    for (var id in exchange._unAcked) {
      var task = exchange._unAcked[id];
      task.emit('ack error', err);
      delete exchange._unAcked[id];
    }
  };
}

Exchange.prototype._onMethod = function (channel, method, args) {
  this.emit(method.name, args);

  if (this._handleTaskReply.apply(this, arguments))
    return true;

  var cb;

  switch (method) {
    case methods.channelOpenOk:
      this._sequence = null;

      if (!this._addedExchangeErrorHandler) {
        var errorHandler = createExchangeErrorHandlerFor(this);
        this.connection.on('error', errorHandler);
        this.on('error', errorHandler);
        this._addedExchangeErrorHandler = true;
      }

      // Pre-baked exchanges don't need to be declared
      if (/^$|(amq\.)/.test(this.name)) {
        //If confirm mode is specified we have to set it no matter the exchange.
        if (this.options.confirm) {
          this._confirmSelect(channel);
          return;
        }

        this.state = 'open';
        // - issue #33 fix
        if (this._openCallback) {
         this._openCallback(this);
         this._openCallback = null;
        }
        // --
        this.emit('open');

      // For if we want to delete a exchange,
      // we dont care if all of the options match.
      } else if (this.options.noDeclare) {
        if (this.options.confirm) {
          this._confirmSelect(channel);
          this.state = 'open';

          if (this._openCallback) {
           this._openCallback(this);
           this._openCallback = null;
          }

          this.emit('open');
        }
      } else {
        this.connection._sendMethod(channel, methods.exchangeDeclare,
            { reserved1:  0
            , reserved2:  false
            , reserved3:  false
            , exchange:   this.name
            , type:       this.options.type || 'topic'
            , passive:    !!this.options.passive
            , durable:    !!this.options.durable
            , autoDelete: !!this.options.autoDelete
            , internal:   !!this.options.internal
            , noWait:     false
            , "arguments":this.options.arguments || {}
            });
        this.state = 'declaring';
      }
      break;

    case methods.exchangeDeclareOk:
      if (this.options.confirm) {
        this._confirmSelect(channel);
      } else {

        this.state = 'open';
        this.emit('open');
        if (this._openCallback) {
          this._openCallback(this);
          this._openCallback = null;
        }
      }
      break;

    case methods.confirmSelectOk:
      this._sequence = 1;

      this.state = 'open';
      this.emit('open');
      if (this._openCallback) {
        this._openCallback(this);
        this._openCallback = null;
      }
      break;

    case methods.channelClose:
      this.state = "closed";
      this.closeOK();
      this.connection.exchangeClosed(this.name);
      var e = new Error(args.replyText);
      e.code = args.replyCode;
      this.emit('error', e);
      this.emit('close');
      break;

    case methods.channelCloseOk:
      this.connection.exchangeClosed(this.name);
      this.emit('close');
      break;


    case methods.basicAck:
      this.emit('basic-ack', args);
      var sequenceNumber = args.deliveryTag.readUInt32BE(4), tag;
      debug && debug("basic-ack, sequence: ", sequenceNumber);

      if (sequenceNumber === 0 && args.multiple === true) {
        // we must ack everything
        for (tag in this._unAcked) {
          this._unAcked[tag].emit('ack');
          delete this._unAcked[tag];
        }
      } else if (sequenceNumber !== 0 && args.multiple === true) {
        // we must ack everything before the delivery tag
        for (tag in this._unAcked) {
          if (tag <= sequenceNumber) {
            this._unAcked[tag].emit('ack');
            delete this._unAcked[tag];
          }
        }
      } else if (this._unAcked[sequenceNumber] && args.multiple === false) {
        // simple single ack
        this._unAcked[sequenceNumber].emit('ack');
        delete this._unAcked[sequenceNumber];
      }
      break;

    case methods.basicReturn:
      this.emit('basic-return', args);
      break;

    case methods.exchangeBindOk:
      if (this._bindCallback) {
        // setting this._bindCallback to null before calling the callback allows for a subsequent bind within the callback
        cb = this._bindCallback;
        this._bindCallback = null;
        cb(this);
      }
      break;

    case methods.exchangeUnbindOk:
      if (this._unbindCallback) {
        cb = this._unbindCallback;
        this._unbindCallback = null;
        cb(this);
      }
      break;

    default:
      throw new Error("Uncaught method '" + method.name + "' with args " +
        JSON.stringify(args));
  }

  this._tasksFlush();
};

// exchange.publish('routing.key', 'body');
//
// the third argument can specify additional options
// - mandatory (boolean, default false)
// - immediate (boolean, default false)
// - contentType (default 'application/octet-stream')
// - contentEncoding
// - headers
// - deliveryMode
// - priority (0-9)
// - correlationId
// - replyTo
// - expiration
// - messageId
// - timestamp
// - userId
// - appId
// - clusterId
//
// the callback is optional and is only used when confirm is turned on for the exchange

Exchange.prototype.publish = function (routingKey, data, options, callback) {
  var self = this;
  callback = callback || function() {};

  if (this.connection._blocked) {
    return callback(true, new Error('Connection is blocked, server reason: ' + this.connection._blockedReason));
  }

  if (this.state !== 'open') {
    this._sequence = null;
    return callback(true, new Error('Can not publish: exchange is not open'));
  }

  if (this.options.confirm && !this._readyToPublishWithConfirms()) {
    return callback(true, new Error('Not yet ready to publish with confirms'));
  }

  options = _.assignIn({}, options || {});
  options.routingKey = routingKey;
  options.exchange   = self.name;
  options.mandatory  = options.mandatory ? true : false;
  options.immediate  = options.immediate ? true : false;
  options.reserved1  = 0;

  var task = this._taskPush(null, function () {
    self.connection._sendMethod(self.channel, methods.basicPublish, options);
    // This interface is probably not appropriate for streaming large files.
    // (Of course it's arguable about whether AMQP is the appropriate
    // transport for large files.) The content header wants to know the size
    // of the data before sending it - so there's no point in trying to have a
    // general streaming interface - streaming messages of unknown size simply
    // isn't possible with AMQP. This is all to say, don't send big messages.
    // If you need to stream something large, chunk it yourself.
    self.connection._sendBody(self.channel, data, options);
  });

  if (self.options.confirm) self._awaitConfirm(task, callback);
  return task;
};

// registers tasks for confirms
Exchange.prototype._awaitConfirm = function _awaitConfirm (task, callback) {
  if (!this._addedExchangeErrorHandler) {
    // if connection fails, we want to ack error all unacked publishes.
    this.connection.on('error', createExchangeErrorHandlerFor(this));
    this.on('error', createExchangeErrorHandlerFor(this));
    this._addedExchangeErrorHandler = true;
  }

  debug && debug('awaiting confirmation for ' + this._sequence);
  task.sequence = this._sequence;
  this._unAcked[this._sequence] = task;
  this._sequence++;

  if ('function' != typeof callback) return;

  task.once('ack error', function (err) {
    task.removeAllListeners();
    callback(true, err);
  });

  task.once('ack', function () {
    task.removeAllListeners();
    callback(false);
  });
};

// do any necessary cleanups eg. after queue destruction
Exchange.prototype.cleanup = function() {
  if (this.binds === 0) { // don't keep reference open if unused
    this.connection.exchangeClosed(this.name);
  }
};

Exchange.prototype.destroy = function (ifUnused) {
  var self = this;
  return this._taskPush(methods.exchangeDeleteOk, function () {
    self.connection.exchangeClosed(self.name);
    self.connection._sendMethod(self.channel, methods.exchangeDelete,
        { reserved1: 0
        , exchange: self.name
        , ifUnused: ifUnused ? true : false
        , noWait: false
        });
  });
};

// E2E Unbind
// support RabbitMQ's exchange-to-exchange binding extension
// http://www.rabbitmq.com/e2e.html
Exchange.prototype.unbind = function (/* exchange, routingKey [, bindCallback] */) {
  var self = this;

  // Both arguments are required. The binding to the destination
  // exchange/routingKey will be unbound.

  var exchange    = arguments[0]
    , routingKey  = arguments[1]
    , callback    = arguments[2]
  ;

  if (callback) this._unbindCallback = callback;

  return this._taskPush(methods.exchangeUnbindOk, function () {
    var source = exchange instanceof Exchange ? exchange.name : exchange;
    var destination = self.name;

    if (source in self.connection.exchanges) {
      delete self.sourceExchanges[source];
      self.connection.exchanges[source].exchangeBinds--;
    }

    self.connection._sendMethod(self.channel, methods.exchangeUnbind,
        { reserved1: 0
        , destination: destination
        , source: source
        , routingKey: routingKey
        , noWait: false
        , "arguments": {}
        });
  });
};

// E2E Bind
// support RabbitMQ's exchange-to-exchange binding extension
// http://www.rabbitmq.com/e2e.html
Exchange.prototype.bind = function (/* exchange, routingKey [, bindCallback] */) {
  var self = this;

  // Two arguments are required. The binding to the destination
  // exchange/routingKey will be established.

  var exchange    = arguments[0]
    , routingKey  = arguments[1]
    , callback    = arguments[2]
  ;

  if (callback) this._bindCallback = callback;

  var source = exchange instanceof Exchange ? exchange.name : exchange;
  var destination = self.name;

  if(source in self.connection.exchanges) {
    self.sourceExchanges[source] = self.connection.exchanges[source];
    self.connection.exchanges[source].exchangeBinds++;
  }

  self.connection._sendMethod(self.channel, methods.exchangeBind,
      { reserved1: 0
      , destination: destination
      , source: source
      , routingKey: routingKey
      , noWait: false
      , "arguments": {}
      });

};

// E2E Bind
// support RabbitMQ's exchange-to-exchange binding extension
// http://www.rabbitmq.com/e2e.html
Exchange.prototype.bind_headers = function (/* exchange, routing [, bindCallback] */) {
  var self = this;

  // Two arguments are required. The binding to the destination
  // exchange/routingKey will be established.

  var exchange = arguments[0]
    , routing  = arguments[1]
    , callback = arguments[2]
  ;

  if (callback) this._bindCallback = callback;

  var source = exchange instanceof Exchange ? exchange.name : exchange;
  var destination = self.name;

  if (source in self.connection.exchanges) {
    self.sourceExchanges[source] = self.connection.exchanges[source];
    self.connection.exchanges[source].exchangeBinds++;
  }

  self.connection._sendMethod(self.channel, methods.exchangeBind,
    { reserved1: 0
        , destination: destination
        , source: source
        , routingKey: ''
        , noWait: false
        , "arguments": routing
    });
};

Exchange.prototype._confirmSelect = function(channel) {
  this.connection._sendMethod(channel, methods.confirmSelect, { noWait: false });
};

Exchange.prototype._readyToPublishWithConfirms = function() {
  return this._sequence != null;
};

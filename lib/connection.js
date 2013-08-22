'use strict';
var net = require('net');
var tls = require('tls');
var fs = require('fs');
var URL = require('url');
var _ = require('lodash');
var debug = require('./debug');
var serializer = require('./serializer');
var definitions = require('./definitions');
var methods = definitions.methods;
var methodTable = definitions.methodTable;
var classes = definitions.classes;
var Exchange = require('./exchange');
var Queue = require('./queue');
var AMQPParser = require('./parser');
    
var maxFrameBuffer = 131072; // 128k, same as rabbitmq (which was
                             // copying qpid)

var defaultPorts = { 'amqp': 5672, 'amqps': 5671 };

var defaultOptions = { host: 'localhost'
                     , port: defaultPorts['amqp']
                     , login: 'guest'
                     , password: 'guest'
                     , authMechanism: 'AMQPLAIN'
                     , vhost: '/'
                     , ssl: { enabled : false
                            }
                     };

var defaultSslOptions = { port: defaultPorts['amqps']
                        , ssl: { rejectUnauthorized : true
                               }
                        };

var defaultImplOptions = { defaultExchangeName: ''
                         , reconnect: true
                         , reconnectBackoffStrategy: 'linear'
                         , reconnectExponentialLimit: 120000
                         , reconnectBackoffTime: 1000
                         };

//Helper method to proxy getter's, setters, and functions from one object to another
function proxyMethod(obj, method) {
  var args = Array.prototype.slice.call(arguments, 2);
  return obj[method].apply(obj, args);
}
function proxyGetter(obj, property) {
  return obj[property];
}
function proxySetter(obj, property, value) {
  obj[property] = value;
}
function objectProxy(a, b) {
  // if ('object' !== typeof b) { return;}
  var bproto = Object.getPrototypeOf(b);
  for ( var i in bproto) {
    if ('undefined' !== typeof a[i]) {
      continue;
    }
    var btype = typeof b[i];
    var g = bproto.__lookupGetter__(i), s = bproto.__lookupSetter__(i);
    if (g || s) {
      if (g) {
        a.__defineGetter__(i, proxyGetter.bind(b, b, i));
      }
      if (s) {
        a.__defineSetter__(i, proxySetter.bind(b, b, i));
      }
    } else if ('function' === btype) {
      a[i] = proxyMethod.bind(b, b, i);
    }
  }
  for ( var i in b) {
    var btype = typeof b[i];
    if ('undefined' !== typeof a[i]) {
      continue;
    }
    var g = b.__lookupGetter__(i), s = b.__lookupSetter__(i);
    if (g || s) {
      if (g) {
        a.__defineGetter__(i, proxyGetter.bind(b, b, i));
      }
      if (s) {
        a.__defineSetter__(i, proxySetter.bind(b, b, i));
      }
    } else if ('function' === btype) {
      a[i] = proxyMethod.bind(b, b, i);
    }
  }
  return a;
}

var Connection = module.exports = function Connection (connectionArgs, options, readyCallback) {
  this.setOptions(connectionArgs);
  this.setImplOptions(options);
  
  if (typeof readyCallback === 'function') {
    this._readyCallback = readyCallback;
  }
  
  this.connectionAttemptScheduled = false;
  this._defaultExchange = null;
  this.channelCounter = 0;
  this._sendBuffer = new Buffer(maxFrameBuffer);
};

function urlOptions(connectionString) {
  var opts = {};
  opts.ssl = {};
  var url = URL.parse(connectionString);
  var scheme = url.protocol.substring(0, url.protocol.lastIndexOf(':'));
  if (scheme != 'amqp' && scheme != 'amqps') {
    throw new Error('Connection URI must use amqp or amqps scheme. ' +
                    'For example, "amqp://bus.megacorp.internal:5766".');
  }
  opts.ssl.enabled = ('amqps' === scheme);
  opts.host = url.hostname;
  opts.port = url.port || defaultPorts[scheme];
  if (url.auth) {
    var auth = url.auth.split(':');
    auth[0] && (opts.login = auth[0]);
    auth[1] && (opts.password = auth[1]);
  }
  if (url.pathname) {
    opts.vhost = unescape(url.pathname.substr(1));
  }
  return opts;
}

Connection.prototype.setOptions = function (options) {
  var urlo = (options && options.url) ? urlOptions(options.url) : {};
  var sslo = (options && options.ssl && options.ssl.enabled) ? defaultSslOptions : {};
  this.options = _.extend({}, defaultOptions, sslo, urlo, options || {});
};

Connection.prototype.setImplOptions = function (options) {
  this.implOptions = _.extend({}, defaultImplOptions, options || {});
};

Connection.prototype.reconnect = function () {
  // Suspend activity on channels
  for (var channel in this.channels) {
    this.channels[channel].state = 'closed';
  }
  debug("Connection lost, reconnecting...");
  // Terminate socket activity
  this.end();
  this._connect();
};

Connection.prototype._connect = function () {
  // If you pass a array of hosts, lets choose a random host or the preferred host number, or then next one.
  var connectToHost = this.options.host;

  if(Array.isArray(this.options.host) === true){
    if(this.hosti == null){
      if(this.options.hostPreference !== undefined && typeof this.options.hostPreference == 'number') {
        this.hosti = (this.options.hostPreference<this.options.host.length)?this.options.hostPreference:this.options.host.length-1; 
      } else {   
        this.hosti = Math.random()*this.options.host.length >> 0;
      }
    } else {
      this.hosti = (this.hosti+1) % this.options.host.length;
    }
    connectToHost = this.options.host[this.hosti];
  }

  // Connect socket
  
  // Keep previous connection for listeners
  var oldConn = this.conn;

  if (this.options.ssl.enabled) {
    debug('making ssl connection');
    var sslConnectionOptions = {};
    if (this.options.ssl.keyFile) {
      sslConnectionOptions.key = fs.readFileSync(this.options.ssl.keyFile);
    }
    if (this.options.ssl.certFile) {
      sslConnectionOptions.cert = fs.readFileSync(this.options.ssl.certFile);
    }
    if (this.options.ssl.caFile) {
      sslConnectionOptions.ca = fs.readFileSync(this.options.ssl.caFile);
    }
    sslConnectionOptions.rejectUnauthorized = this.options.ssl.rejectUnauthorized;
    this.conn = tls.connect(this.options.port, connectToHost, sslConnectionOptions);
  } else {
    debug('making non-ssl connection');
    this.conn = net.connect(this.options.port, connectToHost);
  }
  objectProxy(this, this.conn, true);
  if (oldConn === undefined) {
    this.addAllListeners();
  } else {
    // Preserve external listeners from previous connection
    this.removeAllListeners();
    this.addListenersFromConnection(oldConn);
  }
};

Connection.prototype.addAllListeners = function() {
  var self = this;
  var connectEvent = this.options.ssl.enabled ? 'secureConnect' : 'connect';

  var backoffTime = null;
  var backoff = function(e) {
    if (self._inboundHeartbeatTimer !== null) {
      clearTimeout(self._inboundHeartbeatTimer);
      self._inboundHeartbeatTimer = null;
    }
    if (self._outboundHeartbeatTimer !== null) {
      clearTimeout(self._outboundHeartbeatTimer);
      self._outboundHeartbeatTimer = null;
    }

    if (!self.connectionAttemptScheduled) {
      // Set to true, as we are presently in the process of scheduling one.
      self.connectionAttemptScheduled = true;

      // Kill the socket, if it hasn't been killed already.
      self.end();

      // Reset parser state
      self.parser = null;

      // In order for our reconnection to be seamless, we have to notify the
      // channels that they are no longer connected so that nobody attempts
      // to send messages which would be doomed to fail.
      for (var channel in self.channels) {
        if (channel !== 0) {
          self.channels[channel].state = 'closed';
        }
      }
      // Queues are channels (so we have already marked them as closed), but
      // queues have special needs, since the subscriptions will no longer
      // be known to the server when we reconnect.  Mark the subscriptions as
      // closed so that we can resubscribe them once we are reconnected.
      for (var queue in self.queues) {
        for (var index in self.queues[queue].consumerTagOptions) {
          self.queues[queue].consumerTagOptions[index]['state'] = 'closed';
        }
      }

      // Begin reconnection attempts
      if (self.implOptions.reconnect) {
        // Don't thrash, use a backoff strategy.
        if (backoffTime === null) {
          // This is the first time we've failed since a successful connection,
          // so use the configured backoff time without any modification.
          backoffTime = self.implOptions.reconnectBackoffTime;
        } else if (self.implOptions.reconnectBackoffStrategy === 'exponential') {
          // If you've configured exponential backoff, we'll double the
          // backoff time each subsequent attempt until success.
          backoffTime *= 2;
          // limit the maxium timeout, to avoid potentially unlimited stalls
          if(backoffTime > self.implOptions.reconnectExponentialLimit){
            backoffTime = self.implOptions.reconnectExponentialLimit;
          }

        } else if (self.implOptions.reconnectBackoffStrategy === 'linear') {
          // Linear strategy is the default.  In this case, we will retry at a
          // constant interval, so there's no need to change the backoff time
          // between attempts.
        } else {
          // TODO should we warn people if they picked a nonexistent strategy?
        }

        setTimeout(function () {
          // Set to false, so that if we fail in the reconnect attempt, we can
          // schedule another one.
          self.connectionAttemptScheduled = false;
          self.reconnect();
        }, backoffTime);
      } else {
        self.removeListener('error', backoff);
        self.emit('error', e);
      }
    }
  };
  self.addListener(connectEvent, function() {
    // In the case where this is a reconnection, do not trample on the existing
    // channels.
    // For your reference, channel 0 is the control channel.
    self.channels = (self.implOptions.reconnect ? self.channels : undefined) || {0:self};
    self.queues = (self.implOptions.reconnect ? self.queues : undefined) || {};
    self.exchanges = (self.implOptions.reconnect ? self.exchanges : undefined) || {};

    self.parser = new AMQPParser('0-9-1', 'client');

    self.parser.onMethod = function (channel, method, args) {
      self._onMethod(channel, method, args);
    };

    self.parser.onContent = function (channel, data) {
      debug(channel + " > content " + data.length);
      if (self.channels[channel] && self.channels[channel]._onContent) {
        self.channels[channel]._onContent(channel, data);
      } else {
        debug("unhandled content: " + data);
      }
    };

    self.parser.onContentHeader = function (channel, classInfo, weight, properties, size) {
      debug(channel + " > content header " + JSON.stringify([classInfo.name, weight, properties, size]));
      if (self.channels[channel] && self.channels[channel]._onContentHeader) {
        self.channels[channel]._onContentHeader(channel, classInfo, weight, properties, size);
      } else {
        debug("unhandled content header");
      }
    };

    self.parser.onHeartBeat = function () {
      self.emit("heartbeat");
      debug("heartbeat");
    };

    self.parser.onError = function (e) {
      self.emit("error", e);
      self.emit("close");
    };
    //debug("connected...");
    // Time to start the AMQP 7-way connection initialization handshake!
    // 1. The client sends the server a version string
    self.write("AMQP" + String.fromCharCode(0,0,9,1));
  });

  self.addListener('data', function (data) {
    if(self.parser != null){
      try {
        self.parser.execute(data);
      } catch (exception) {
        self.emit('error', exception);
        return;
      }
    }
    self._inboundHeartbeatTimerReset();
  });

  self.addListener('error', backoff);

  self.addListener('ready', function () {
    // Reset the backoff time since we have successfully connected.
    backoffTime = null;

    if (self.implOptions.reconnect) {
      // Reconnect any channels which were open.
      _.each(self.channels, function(channel, index) {
        // FIXME why is the index "0" instead of 0?
        if (index !== "0") channel.reconnect();
      });
    }

    // Restart the heartbeat to the server
    self._outboundHeartbeatTimerReset();
  });
  

  // Apparently, it is not possible to determine if an authentication error
  // has occurred, but when the connection closes then we can HINT that a
  // possible authentication error has occured.  Although this may be a bug
  // in the spec, handling it as a possible error is considerably better than
  // failing silently.
  function possibleAuthErrorHandler() {
    self.removeListener('end', possibleAuthErrorHandler);
    self.emit('error', {
      message: 'Connection ended: possibly due to an authentication failure.'
    });
  }
  // add this handler with #on not #once (so it can be removed by #removeListener)
  self.on('end', possibleAuthErrorHandler);
  self.once('ready', function () {
    self.removeListener('end', possibleAuthErrorHandler);
  });
};

Connection.prototype.addListenersFromConnection = function(oldConnection) {
  for ( var eventName in oldConnection._events) {
    // readable is a special event that is added when 'data' is added
    if(eventName === 'readable'){
      continue;
    }
    var oldListeners = oldConnection.listeners(eventName);
    var newListeners = this.listeners(eventName);
    for ( var i in oldListeners) {
      if (newListeners.indexOf(oldListeners[i]) <= -1) {
        this.addListener(eventName, oldListeners[i]);
      }
    }
  }
};

Connection.prototype._onMethod = function (channel, method, args) {
  debug(channel + " > " + method.name + " " + JSON.stringify(args));

  // Channel 0 is the control channel. If not zero then delegate to
  // one of the channel objects.

  if (channel > 0) {
    if (!this.channels[channel]) {
      debug("Received message on untracked channel.");
      return;
    }
    if (!this.channels[channel]._onChannelMethod) {
      throw new Error('Channel ' + channel + ' has no _onChannelMethod method.');
    }
    this.channels[channel]._onChannelMethod(channel, method, args);
    return;
  }

  // channel 0

  switch (method) {
    // 2. The server responds, after the version string, with the
    // 'connectionStart' method (contains various useless information)
    case methods.connectionStart:
      // We check that they're serving us AMQP 0-9
      if (args.versionMajor !== 0 && args.versionMinor != 9) {
        this.end();
        this.emit('error', new Error("Bad server version"));
        return;
      }
      this.serverProperties = args.serverProperties;
      // 3. Then we reply with StartOk, containing our useless information.
      this._sendMethod(0, methods.connectionStartOk,
          { clientProperties:
            { version: '0.0.1'
            , platform: 'node-' + process.version
            , product: 'node-amqp'
            }
          , mechanism: this.options.authMechanism
          , response:
            { LOGIN: this.options.login
            , PASSWORD: this.options.password
            }
          , locale: 'en_US'
          });
      break;

    // 4. The server responds with a connectionTune request
    case methods.connectionTune:
      if (args.frameMax) {
          debug("tweaking maxFrameBuffer to " + args.frameMax);
          maxFrameBuffer = args.frameMax;
      }
      // 5. We respond with connectionTuneOk
      this._sendMethod(0, methods.connectionTuneOk,
          { channelMax: 0
          , frameMax: maxFrameBuffer
          , heartbeat: this.options.heartbeat || 0
          });
      // 6. Then we have to send a connectionOpen request
      this._sendMethod(0, methods.connectionOpen,
          { virtualHost: this.options.vhost
          // , capabilities: ''
          // , insist: true
          , reserved1: ''
          , reserved2: true
          });
      break;


    case methods.connectionOpenOk:
      // 7. Finally they respond with connectionOpenOk
      // Whew! That's why they call it the Advanced MQP.
      if (this._readyCallback) {
        this._readyCallback(this);
        this._readyCallback = null;
      }
      this.emit('ready');
      break;

    case methods.connectionClose:
      var e = new Error(args.replyText);
      e.code = args.replyCode;
      if (!this.listeners('close').length) {
        console.log('Unhandled connection error: ' + args.replyText);
      }
      this.destroy(e);
      break;

    default:
      throw new Error("Uncaught method '" + method.name + "' with args " +
          JSON.stringify(args));
  }
};

Connection.prototype.heartbeat = function () {
  if(this.writable) this.write(new Buffer([8,0,0,0,0,0,0,206]));
};

Connection.prototype._outboundHeartbeatTimerReset = function () {
  if (this._outboundHeartbeatTimer !== null) {
    clearTimeout(this._outboundHeartbeatTimer);
    this._outboundHeartbeatTimer = null;
  }
  if (this.writable && this.options.heartbeat) {
    var self = this;
    this._outboundHeartbeatTimer = setTimeout(function () {
      self.heartbeat();
      self._outboundHeartbeatTimerReset();
    }, 1000 * this.options.heartbeat);
  }
};

Connection.prototype._inboundHeartbeatTimerReset = function () {
  if (this._inboundHeartbeatTimer !== null) {
    clearTimeout(this._inboundHeartbeatTimer);
    this._inboundHeartbeatTimer = null;
  }
  if (this.options.heartbeat) {
    var self = this;
    var gracePeriod = 2 * this.options.heartbeat;
    this._inboundHeartbeatTimer = setTimeout(function () {
      if(self.readable)
        self.emit('error', new Error('no heartbeat or data in last ' + gracePeriod + ' seconds'));
    }, gracePeriod * 1000);
  }
};

Connection.prototype._sendMethod = function (channel, method, args) {
  debug(channel + " < " + method.name + " " + JSON.stringify(args));
  var b = this._sendBuffer;
  b.used = 0;

  b[b.used++] = 1; // constants.frameMethod

  serializer.serializeInt(b, 2, channel);

  var lengthIndex = b.used;

  serializer.serializeInt(b, 4, 42); // replace with actual length.

  var startIndex = b.used;


  serializer.serializeInt(b, 2, method.classIndex); // short, classId
  serializer.serializeInt(b, 2, method.methodIndex); // short, methodId

  serializer.serializeFields(b, method.fields, args, true);

  var endIndex = b.used;

  // write in the frame length now that we know it.
  b.used = lengthIndex;
  serializer.serializeInt(b, 4, endIndex - startIndex);
  b.used = endIndex;

  b[b.used++] = 206; // constants.frameEnd;

  var c = b.slice(0, b.used);

  //debug("sending frame: " + c);

  this.write(c);
  
  this._outboundHeartbeatTimerReset();
};


// connection: the connection
// channel: the channel to send this on
// size: size in bytes of the following message
// properties: an object containing any of the following:
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
Connection.prototype.sendHeader = function(channel, size, properties) {
  var b = new Buffer(maxFrameBuffer); // FIXME allocating too much.
                                      // use freelist?
  b.used = 0;

  var classInfo = classes[60]; // always basic class.

  // 7 OCTET FRAME HEADER

  b[b.used++] = 2; // constants.frameHeader

  serializer.serializeInt(b, 2, channel);

  var lengthStart = b.used;

  serializer.serializeInt(b, 4, 0 /*dummy*/); // length

  var bodyStart = b.used;

  // HEADER'S BODY

  serializer.serializeInt(b, 2, classInfo.index);   // class 60 for Basic
  serializer.serializeInt(b, 2, 0);                 // weight, always 0 for rabbitmq
  serializer.serializeInt(b, 8, size);              // byte size of body

  // properties - first propertyFlags
  properties = _.defaults(properties || {}, {contentType: 'application/octet-stream'});
  var propertyFlags = 0;
  for (var i = 0; i < classInfo.fields.length; i++) {
    if (properties[classInfo.fields[i].name]) propertyFlags |= 1 << (15-i);
  }
  serializer.serializeInt(b, 2, propertyFlags);
  // now the actual properties.
  serializer.serializeFields(b, classInfo.fields, properties, false);

  //serializeTable(b, properties);

  var bodyEnd = b.used;

  // Go back to the header and write in the length now that we know it.
  b.used = lengthStart;
  serializer.serializeInt(b, 4, bodyEnd - bodyStart);
  b.used = bodyEnd;

  // 1 OCTET END

  b[b.used++] = 206; // constants.frameEnd;

  var s = b.slice(0, b.used);

  //debug('header sent: ' + JSON.stringify(s));

  this.write(s);
};


Connection.prototype._sendBody = function (channel, body, properties) {
  var r = this._bodyToBuffer(body);
  var props = r[0], buffer = r[1];

  properties = _.extend(props || {}, properties);

  this.sendHeader(channel, buffer.length, properties);

  var pos = 0, len = buffer.length;
  while (len > 0) {
    var sz = len < maxFrameBuffer ? len : maxFrameBuffer;

    var b = new Buffer(7 + sz + 1);
    b.used = 0;
    b[b.used++] = 3; // constants.frameBody
    serializer.serializeInt(b, 2, channel);
    serializer.serializeInt(b, 4, sz);
    buffer.copy(b, b.used, pos, pos+sz);
    b.used += sz;
    b[b.used++] = 206; // constants.frameEnd;
    this.write(b);

    len -= sz;
    pos += sz;
  }
  return;
};

Connection.prototype._bodyToBuffer = function (body) {
  // Handles 3 cases
  // - body is utf8 string
  // - body is instance of Buffer
  // - body is an object and its JSON representation is sent
  // Does not handle the case for streaming bodies.
  // Returns buffer.
  if (typeof(body) == 'string') {
    return [null, new Buffer(body, 'utf8')];
  } else if (body instanceof Buffer) {
    return [null, body];
  } else {
    var jsonBody = JSON.stringify(body);

    debug('sending json: ' + jsonBody);

    var props = {contentType: 'application/json'};
    return [props, new Buffer(jsonBody, 'utf8')];
  }
};


// Options
// - passive (boolean)
// - durable (boolean)
// - exclusive (boolean)
// - autoDelete (boolean, default true)
Connection.prototype.queue = function (name /* options, openCallback */) {
  var options, callback;
  if (typeof arguments[1] == 'object') {
    options = arguments[1];
    callback = arguments[2];
  } else {
    callback = arguments[1];
  }

  this.channelCounter++;
  var channel = this.channelCounter;

  var q = new Queue(this, channel, name, options, callback);
  this.channels[channel] = q;
  return q;
};

// remove a queue when it's closed (called from Queue)
Connection.prototype.queueClosed = function (name) {
  if (this.queues[name]) delete this.queues[name];
};

// remove an exchange when it's closed (called from Exchange)
Connection.prototype.exchangeClosed = function (name) {
  if (this.exchanges[name]) delete this.exchanges[name];
};


// connection.exchange('my-exchange', { type: 'topic' });
// Options
// - type 'fanout', 'direct', or 'topic' (default)
// - passive (boolean)
// - durable (boolean)
// - autoDelete (boolean, default true)
Connection.prototype.exchange = function (name, options, openCallback) {
  if (name === undefined) name = this.implOptions.defaultExchangeName;

  if (!options) options = {};
  if (name !== '' && options.type === undefined) options.type = 'topic';

  this.channelCounter++;
  var channel = this.channelCounter;
  var exchange = new Exchange(this, channel, name, options, openCallback);
  this.channels[channel] = exchange;
  this.exchanges[name] = exchange;
  return exchange;
};

// Publishes a message to the default exchange.
Connection.prototype.publish = function (routingKey, body, options, callback) {
  if (!this._defaultExchange) this._defaultExchange = this.exchange();
  return this._defaultExchange.publish(routingKey, body, options, callback);
};
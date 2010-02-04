var events = require('events'),
    sys = require('sys'),
    net = require('net'),  // requires net2 branch of node
    protocol = require('./amqp-definitions-0-8');



var Buffer = process.Buffer;

process.Buffer.prototype.toString = function () {
  return this.utf8Slice(0, this.length);
};

process.Buffer.prototype.toJSON = function () {
  return this.utf8Slice(0, this.length);
};



var debugLevel = 0;
if ('NODE_DEBUG_AMQP' in process.ENV) debugLevel = 1;
function debug (x) {
  if (debugLevel > 0) {
    process.stdio.writeError(x + '\n');
  }
}



// a look up table for methods recieved
// indexed on class id, method id
var methodTable = {};

// methods keyed on their name
var methods = {};

(function () { // anon scope for init
  //debug("initializing amqp methods...");
  for (var i = 0; i < protocol.classes.length; i++) {
    var classInfo = protocol.classes[i];
    for (var j = 0; j < classInfo.methods.length; j++) {
      var methodInfo = classInfo.methods[j];

      var name = classInfo.name
               + methodInfo.name[0].toUpperCase()
               + methodInfo.name.slice(1);
      //debug(name);

      var method = { name: name
                   , fields: methodInfo.fields
                   , methodIndex: methodInfo.index
                   , classIndex: classInfo.index
                   };

      if (!methodTable[classInfo.index]) methodTable[classInfo.index] = {};
      methodTable[classInfo.index][methodInfo.index] = method;
      methods[name] = method;
    }
  }
})(); // end anon scope



// parser


var maxFrameBuffer = 131072; // same as rabbitmq


// An interruptible AMQP parser.
//
// type is either 'server' or 'client'
// version is '0-8' or '0-9-1'. Currently only supporting '0-8'.
//
// Instances of this class have several callbacks
// - onMethod(channel, method, args);
// - onHeartBeat()
// - onContent(channel, buffer);
// - onContentHeader(channel, class, weight, size);
//
// This class does not subclass EventEmitter, in order to reduce the speed
// of emitting the callbacks. Since this is an internal class, that should
// be fine.
function AMQPParser (version, type) {
  this.isClient = (type == 'client');
  this.state = this.isClient ? 'frameHeader' : 'protocolHeader';

  if (version != '0-8') throw new Error("Unsupported protocol version");

  this.frameHeader = new Buffer(7);
  this.frameHeader.used = 0;
}


// Everytime data is recieved on the socket, pass it to this function for
// parsing.
AMQPParser.prototype.execute = function (data) {
  // This function only deals with dismantling and buffering the frames.
  // It delegats to other functions for parsing the frame-body.
  for (var i = 0; i < data.length; i++) {
    switch (this.state) {
      case 'frameHeader':
        // Here we buffer the frame header. Remember, this is a fully
        // interruptible parser - it could be (although unlikely)
        // that we receive only several octets of the frame header
        // in one packet.
        this.frameHeader[this.frameHeader.used++] = data[i];

        if (this.frameHeader.used == this.frameHeader.length) {
          // Finished buffering the frame header - parse it
          //var h = this.frameHeader.unpack("oonN", 0);

          this.frameHeader.read = 0;
          this.frameType = this.frameHeader[this.frameHeader.read++];
          this.frameChannel = parseInt(this.frameHeader, 2);
          this.frameSize = parseInt(this.frameHeader, 4);

          this.frameHeader.used = 0; // for reuse

          /*
          debug("got frame: " + JSON.stringify([ this.frameType
                                               , this.frameChannel
                                               , this.frameSize
                                               ]));
          */

          if (this.frameSize > maxFrameBuffer) {
            throw new Error("Oversized frame " + this.frameSize);
          }

          // TODO use a free list and keep a bunch of 8k buffers around
          this.frameBuffer = new Buffer(this.frameSize);
          this.frameBuffer.used = 0;
          this.state = 'bufferFrame';
        }
        break;

      case 'bufferFrame':
        // Buffer the entire frame. I would love to avoid this, but doing
        // otherwise seems to be extremely painful.

        // Copy the incoming data byte-by-byte to the buffer.
        // FIXME This is slow! Can be improved with a memcpy binding.
        this.frameBuffer[this.frameBuffer.used++] = data[i];

        if (this.frameBuffer.used == this.frameSize) {
          // Finished buffering the frame. Parse the frame.
          switch (this.frameType) {
            case 1:
              this._parseMethodFrame(this.frameChannel, this.frameBuffer);
              break;

            case 2:
              this._parseHeaderFrame(this.frameChannel, this.frameBuffer);
              break;

            case 3:
              if (this.onContent) {
                this.onContent(this.frameChannel, this.frameBuffer);
              }
              break;

            case 8:
              if (this.onHeartBeat) this.onHeartBeat();
              break;

            default:
              throw new Error("Unhandled frame type " + this.frameType);
              break;
          }
          this.state = 'frameEnd';
        }
        break;

      case 'frameEnd':
        // Frames are terminated by a single octet.
        if (data[i] != 206 /* constants.frameEnd */) throw new Error("Oversized frame");
        this.state = 'frameHeader';
        break;
    }
  }
};


// parse Network Byte Order integers. size can be 1,2,4,8
function parseInt (buffer, size) {
  var int = 0;
  switch (size) {
    case 1:
      return buffer[buffer.read++];

    case 2:
      return (buffer[buffer.read++] << 8) + buffer[buffer.read++];

    case 4:
      return (buffer[buffer.read++] << 24) + (buffer[buffer.read++] << 16) +
             (buffer[buffer.read++] << 8)  + buffer[buffer.read++];

    case 8:
      return (buffer[buffer.read++] << 56) + (buffer[buffer.read++] << 48) +
             (buffer[buffer.read++] << 40) + (buffer[buffer.read++] << 32) +
             (buffer[buffer.read++] << 24) + (buffer[buffer.read++] << 16) +
             (buffer[buffer.read++] << 8)  + buffer[buffer.read++];

    default:
      throw new Error("cannot parse ints of that size");
  }
}


function parseShortString (buffer) {
  var length = buffer[buffer.read++];
  var s = buffer.utf8Slice(buffer.read, buffer.read+length);
  buffer.read += length;
  return s;
}


function parseLongString (buffer) {
  var length = parseInt(buffer, 4);
  var s = buffer.slice(buffer.read, buffer.read + length);
  buffer.read += length;
  return s;
}


function parseSignedInteger (buffer) {
  var int = parseInt(buffer, 4);
  if (int & 0x80000000) {
    int |= 0xEFFFFFFF;
    int = -int;
  }
  return int;
}


function parseTable (buffer) {
  var length = parseInt(buffer, 4);
  var table = {};
  while (buffer.read < length) {
    var field = parseShortString(buffer);
    switch (buffer[buffer.read++]) {
      case 'S'.charCodeAt(0):
        table[field] = parseLongString(buffer);
        break;

      case 'I'.charCodeAt(0):
        table[field] = parseSignedInteger(buffer);
        break;

      case 'D'.charCodeAt(0):
        var decimals = buffer[buffer.read++];
        var int = parseInt(buffer, 4);
        // TODO make into float...?
        // FIXME this isn't correct
        table[field] = '?';
        break;

      case 'T'.charCodeAt(0):
        // 64bit time stamps. Awesome.
        var int = parseInt(buffer, 8);
        // TODO FIXME this isn't correct
        table[field] = '?';
        break;

      case 'F'.charCodeAt(0):
        table[field] = parseTable(buffer);
        break;

      default:
        throw new Error("Unknown field value type " + buffer[buffer.read-1]);
    }
  }
  return table;
}


AMQPParser.prototype._parseMethodFrame = function (channel, buffer) {
  buffer.read = 0;
  var classId = parseInt(buffer, 2),
     methodId = parseInt(buffer, 2);


  // Make sure that this is a method that we understand.
  if (!methodTable[classId] || !methodTable[classId][methodId]) {
    throw new Error("Received unknown [classId, methodId] pair [" +
                    classId + ", " + methodId + "]");
  }

  var method = methodTable[classId][methodId];

  if (!method) throw new Error("bad method?");

  var args = {};

  var bitIndex = 0;

  var value;
  for (var i = 0; i < method.fields.length; i++) {
    var field = method.fields[i];
    // debug("parsing field " + field.name);
    switch (field.domain) {
      case 'bit':
        // 8 bits can be packed into one octet.

        // XXX check if bitIndex greater than 7?

        if (buffer[buffer.read] & (1 << bitIndex)) {
          value = true;
        } else {
          value = false;
        }

        if (method.fields[i+1].domain == 'bit') {
          bitIndex++;
        } else {
          bitIndex = 0;
          buffer.read++;
        }
        break;

      case 'octet':
        value = buffer[buffer.read++];
        break;

      case 'short':
        value = parseInt(buffer, 2);
        break;

      case 'long':
        value = parseInt(buffer, 4);
        break;

      case 'longlong':
        value = parseInt(buffer, 8);
        break;

      case 'shortstr':
        value = parseShortString(buffer);
        break;

      case 'longstr':
        value = parseLongString(buffer);
        break;

      case 'table':
        value = parseTable(buffer);
        break;

      default:
        throw new Error("Unhandled parameter type " + field.domain);
    }
    //debug("got " + value);
    args[field.name] = value;
  }

  if (this.onMethod) {
    this.onMethod(channel, method, args);
  }
};


AMQPParser.prototype._parseHeaderFrame = function (channel, buffer) {
  buffer.read = 0;

  var class = parseInt(buffer, 2);
  var weight = parseInt(buffer, 2);
  var size = parseInt(buffer, 8);

  // ignore flags for now.

  if (this.onContentHeader) {
    this.onContentHeader(channel, class, weight, size);
  }
};


// Network byte order serialization
// (NOTE: javascript always uses network byte order for its ints.)
function serializeInt (b, size, int) {
  if (b.used + size >= b.length) {
    throw new Error("write out of bounds");
  }

  switch (size) {
    // octet
    case 1:
      b[b.used++] = int;
      break;

    // short
    case 2:
      b[b.used++] = int & 0xFF00;
      b[b.used++] = int & 0x00FF;
      break;

    // long
    case 4:
      b[b.used++] = int & 0xFF000000;
      b[b.used++] = int & 0x00FF0000;
      b[b.used++] = int & 0x0000FF00;
      b[b.used++] = int & 0x000000FF;
      break;

    
    // long long
    case 8:
      b[b.used++] = int & 0xFF00000000000000;
      b[b.used++] = int & 0x00FF000000000000;
      b[b.used++] = int & 0x0000FF0000000000;
      b[b.used++] = int & 0x000000FF00000000;
      b[b.used++] = int & 0x00000000FF000000;
      b[b.used++] = int & 0x0000000000FF0000;
      b[b.used++] = int & 0x000000000000FF00;
      b[b.used++] = int & 0x00000000000000FF;
      break;

    default:
      throw new Error("Bad size");
  }
}


function serializeShortString (b, string) {
  if (typeof(string) != "string") {
    throw new Error("param must be a string");
  }
  var byteLength = Buffer.utf8ByteLength(string);
  if (byteLength > 0xFF) {
    throw new Error("String too long for 'shortstr' parameter");
  }
  if (1 + byteLength + b.used >= b.length) {
    throw new Error("Not enough space in buffer for 'shortstr'");
  }
  b[b.used++] = byteLength;
  b.utf8Write(string, b.used); // error here
  b.used += byteLength;
}


function serializeLongString (b, string) {
  // we accept string, object, or buffer for this parameter.
  // in the case of string we serialize it to utf8.
  if (typeof(string) == 'string') {
    var byteLength = Buffer.utf8ByteLength(string);
    serializeInt(b, 4, byteLength);
    b.utf8Write(string, b.used);
    b.used += byteLength;
  } else if (typeof(string) == 'object') {
    serializeTable(b, string);
  } else {
    // data is Buffer
    var byteLength = string.length;
    serializeInt(b, 4, byteLength);
    b.write(string, b.used); // memcpy
    b.used += byteLength;
  }
}


function serializeTable (b, object) {
  if (typeof(object) != "object") {
    throw new Error("param must be an object");
  }

  var lengthIndex = b.used;
  b.used += 4; // for the long

  var startIndex = b.used;

  for (var key in object) {
    if (!object.hasOwnProperty(key)) continue;

    serializeShortString(b, key);

    var value = object[key];

    switch (typeof(value)) {
      case 'string':
        b[b.used++] = 'S'.charCodeAt(0);
        serializeLongString(b, value);
        break;

      case 'number':
        if (value < 0) {
          b[b.used++] = 'I'.charCodeAt(0);
          serializeInt(b, 4, value);
        } else if (value > 0xFFFFFFFF) {
          b[b.used++] = 'T'.charCodeAt(0);
          serializeInt(b, 8, value);
        }
        // TODO decimal? meh.
        break;

      case 'object':
        serializeTable(b, value);
        break;

      default:
        throw new Error("unsupported type in amqp table");
    }
  }

  var endIndex = b.used;

  b.used = lengthIndex;
  serializeInt(b, 4, endIndex - startIndex);
  b.used = endIndex;
}


function Connection (options) {
  process.EventEmitter.call(this);

  var self = this;
  var opts = {};
  this.opts = opts;

  this.channels = [];

  process.mixin(opts, exports.defaultOptions, options);

  this.connection = net.createConnection(opts.port, opts.host);
  var conn = this.connection;

  var parser = new AMQPParser('0-8', 'client');

  var state = 'handshake';

  conn.addListener('close', function () {
    self.emit('close');
  });

  conn.addListener('error', function (e) {
    self.emit('error', e);
  });

  conn.addListener('end', function () {
    debug('got eof');
    self.emit('close');
  });

  conn.addListener('data', function (data) {
    parser.execute(data);
  });

  conn.addListener("connect", function () {
    debug("connected...");
    // Time to start the AMQP 7-way connection initialization handshake!
    // 1. The client sends the server a version string
    conn.send("AMQP" + String.fromCharCode(1,1,8,0));
    state = 'handshake';
  });

  parser.onMethod = function (channel, method, args) {
    self._onMethod(channel, method, args);
  };

  parser.onContent = function (channel, data) {
    debug(channel + " > content " + data.length);
    var i = channel-1;
    if (self.channels[i] && self.channels[i]._onContent) {
      self.channels[i]._onContent(channel, data);
    } else {
      debug("unhandled content: " + data);
    }
  };

  parser.onContentHeader = function (channel, class, weight, size) {
    debug(channel + " > content header " + [class, weight, size]);
    var i = channel-1;
    if (self.channels[i] && self.channels[i]._onContentHeader) {
      self.channels[i]._onContentHeader(channel, class, weight, size);
    } else {
      debug("unhandled content header");
    }
  };

  parser.onHeartBeat = function () {
    debug("heartbeat: ");
  };

  /*
  var handshakeListener = function (message) {
    if (message.matchMethod(C.Connection.Start)) {
    } else if (message.matchMethod(C.Connection.Tune)) {
      conn.send(Method.serialize(C.Connection.TuneOk, C.Channel.All, 0, 131072, 0));
      conn.send(Method.serialize(C.Connection.Open, C.Channel.All, opts.vhost, '', ''));
    } else if (message.matchMethod(C.Connection.OpenOk)) {
      conn.send(Method.serialize(C.Channel.Open, 1, ''));
    } else if (message.matchMethod(C.Channel.OpenOk)) {
      self.conn = conn;
      self.emit('connect');
      conn.removeListener(handshakeListener);
    }
  }
  conn.addListener("message", handshakeListener);
  */

};
sys.inherits(Connection, process.EventEmitter);
exports.Connection = Connection;

exports.createConnection = function (opts) {
  return new Connection(opts);
};

exports.defaultOptions = {
  host: 'localhost',
  port: 5672,
  login: 'guest',
  vhost: '/',
  password: 'guest'
};


Connection.prototype._onMethod = function (channel, method, args) {
  debug(channel + " > " + method.name + " " + JSON.stringify(args));

  if (channel) {
    if (!this.channels[channel-1]) {
      debug("received message on untracked channel.");
      return;
    }
    if (!this.channels[channel-1]._onMethod) return;
    this.channels[channel-1]._onMethod(channel, method, args);
    return;
  }

  // channel 0

  switch (method) {
    // 2. The server responds, after the version string, with the
    // 'connectionStart' method (contains various useless information)
    case methods.connectionStart:
      // We check that they're serving us AMQP 0-8
      if (args.versionMajor != 8 && args.versionMinor != 0) {
        this.connection.close();
        this.emit('error', new Error("Bad server version"));
      } else {
        // 3. Then we reply with StartOk, containing our useless information.
        this._send(0, methods.connectionStartOk,
            { clientProperties:
              { version: '0.0.1'
              , platform: 'node-' + process.version
              , product: 'node-amqp'
              }
            , mechanism: 'AMQPLAIN'
            , response:
              { LOGIN: this.opts.login
              , PASSWORD: this.opts.password
              }
            , locale: 'en_US'
            });
      }
      break;

    // 4. The server responds with a connectionTune request
    case methods.connectionTune:
      // 5. We respond with connectionTuneOk
      this._send(0, methods.connectionTuneOk,
          { channelMax: 0
          , frameMax: maxFrameBuffer
          , heartbeat: 0
          });
      // 6. Then we have to send a connectionOpen request
      this._send(0, methods.connectionOpen,
          { virtualHost: this.opts.vhost
          , capabilities: ''
          , insist: true
          });
      break;


    case methods.connectionOpenOk:
      // 7. Finally they respond with connectionOpenOk
      // Whew! That's why they call it the Advanced MQP.
      this.emit('connect');
      break;


    default:
      throw new Error("Uncaught method '" + method.name + "' with args " +
          JSON.stringify(args));
  }
};

Connection.prototype._send = function (channel, method, args) {
  debug(channel + " < " + method.name + " " + JSON.stringify(args));
  var b = new Buffer(maxFrameBuffer);
  b.used = 0;

  b[b.used++] = 1; // constants.frameMethod

  serializeInt(b, 2, channel);

  var lengthIndex = b.used;

  serializeInt(b, 4, 42); // replace with actual length.

  var startIndex = b.used;


  serializeInt(b, 2, method.classIndex); // short, classId
  serializeInt(b, 2, method.methodIndex); // short, methodId

  var bitField = 0;
  var bitIndex = 0;

  for (var i = 0; i < method.fields.length; i++) {
    var field = method.fields[i];
    var domain = field.domain;
    
    if (!(field.name in args)) {
      debug(JSON.stringify(args));
      throw new Error("Missing method field '" + field.name + "' of type " + domain);
    }
    var param = args[field.name];

    //debug("domain: " + domain + " param: " + param);
    var s = b.used;


    switch (domain) {
      case 'bit':
        if (typeof(param) != "boolean") {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }

        bitField &= (1 << (7 - bitIndex))

        if (!method.fields[i+1] || method.fields[i+1].domain != 'bit') {
          b[b.used++] = bitField;
          bitField = 0;
          bitIndex = 0;
        }
        break;

      case 'octet':
        if (typeof(param) != "number" || param > 0xFF) {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        b[b.used++] = param;
        break;

      case 'short':
        if (typeof(param) != "number" || param > 0xFFFF) {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        serializeInt(b, 2, param);
        break;

      case 'long':
        if (typeof(param) != "number" || param > 0xFFFFFFFF) {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        serializeInt(b, 4, param);
        break;

      case 'longlong':
        serializeInt(b, 8, param);
        break;

      case 'shortstr':
        if (typeof(param) != "string" || param.length > 0xFF) {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        serializeShortString(b, param);
        break;

      case 'longstr':
        serializeLongString(b, param);
        break;

      case 'table':
        if (typeof(param) != "object") {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        serializeTable(b, param);
        break;

      default:
        throw new Error("Unknown domain value type " + domain);
    }
    //debug("enc: " + b.slice(s, b.used));
  }

  var endIndex = b.used;

  // write in the frame length now that we know it.
  b.used = lengthIndex;
  serializeInt(b, 4, endIndex - startIndex);
  b.used = endIndex;

  b[b.used++] = 206; // constants.frameEnd;

  var c = b.slice(0, b.used);

  //debug("sending frame: " + c);

  this.connection.send(c);
};


Connection.prototype.queue = function (name, options) {
  var channel = this.channels.length + 1;
  var q = new Queue(this, channel, name, options);
  this.channels.push(q);
  return q;
};




function Message (queue, args) {
  events.EventEmitter.call(this);

  this.queue = queue;

  this.deliveryTag = args.deliveryTag;
  this.redelivered = args.redelivered;
  this.exchange    = args.exchange;
  this.routingKey  = args.routingKey;
}
sys.inherits(Message, events.EventEmitter);


// Acknowledge recept of message.
// Set first arg to 'true' to acknowledge this and all previous messages
// received on this channel.
Message.prototype.acknowledge = function (all) {
  this.queue.connection._send(this.queue.channel, methods.basicAck,
      { ticket: 0
      , deliveryTag: this.deliveryTag
      , multiple: all ? true : false
      });
};




function Queue (connection, channel, name, options) {
  events.EventEmitter.call(this);
  this.connection = connection;
  this.channel = channel;
  this.name = name;
  this.options = options;

  this._bindQueue = [];

  this.state = "open channel";
  //this.connection._send(channel, methods.channelOpen, {outOfBand: ""});
  this.connection._send(channel, methods.channelOpen, {outOfBand: ""});
}
sys.inherits(Queue, events.EventEmitter);


Queue.prototype._onContentHeader = function (channel, classId, weight, size) {
  var m = this.currentMessage;

  m.weight = weight;
  m.size = size;
  m.read = 0;

  this.emit('message', m);
};


Queue.prototype._onContent = function (channel, data) {
  var m = this.currentMessage;

  m.read += data.length

  m.emit('data', data);

  if (m.read == m.size) m.emit('end');
};


Queue.prototype._onMethod = function (channel, method, args) {
  switch (method) {
    case methods.channelOpenOk:
      this.connection._send(channel, methods.queueDeclare,
          { ticket: 0
          , queue: this.name
          , passive: false
          , durable: false
          , exclusive: false
          , autoDelete: false
          , nowait: true
          , "arguments": {}
          });
      this.state = "declare queue";
      break;

    case methods.queueDeclareOk:
      this.connection._send(channel, methods.basicConsume,
          { ticket: 0
          , queue: this.name
          , consumerTag: "."
          , noLocal: false
          , noAck: true
          , exclusive: false
          , nowait: true
          , "arguments": {}
          });
      this.state = "consuming";
      break;

    case methods.basicConsumeOk:
      this.state = "open";
      this._bindQueueFlush();
      break;

    case methods.queueBindOk:
      var b = this._bindQueue.shift();
      b.promise.emitSuccess();
      break;

    case methods.channelClose:
      this.state = "closed";
      var e = new Error(args.replyText);
      e.code = args.replyCode;
      this.emit('close', e);
      break;

    case methods.basicDeliver:
      this.currentMessage = new Message(this, args);
      break;

    default:
      throw new Error("Uncaught method '" + method.name + "' with args " +
          JSON.stringify(args));
  }
};







Queue.prototype.bind = function (exchange, routingKey, opts) {
  var promise = new events.Promise();
  this._bindQueue.push({ promise: promise
                       , sent: false
                       , args: Array.prototype.slice.call(arguments)
                       });
  this._bindQueueFlush();
  return promise;
};


Queue.prototype._bindQueueFlush = function () {
  if (this.state != 'open') return;

  for (var i = 0; i < this._bindQueue.length; i++) {
    var b = this._bindQueue[i];
    if (b.sent) continue;
    this.connection._send(this.channel, methods.queueBind,
        { ticket: 0
        , queue: this.name
        , exchange: b.args[0]
        , routingKey: b.args[1]
        , nowait: true
        , "arguments": {}
        });
  }
};




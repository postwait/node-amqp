var events = require('events'),
    sys = require('sys'),
    net = require('net'),
    protocol = require('./amqp-definitions-0-8'),
    Buffer = require('buffer').Buffer,
    Promise = require('./promise').Promise;

function mixin () {
  // copy reference to target object
  var target = arguments[0] || {}, i = 1, length = arguments.length, deep = false, source;

  // Handle a deep copy situation
  if ( typeof target === "boolean" ) {
    deep = target;
    target = arguments[1] || {};
    // skip the boolean and the target
    i = 2;
  }

  // Handle case when target is a string or something (possible in deep copy)
  if ( typeof target !== "object" && !(typeof target === 'function') )
    target = {};

  // mixin process itself if only one argument is passed
  if ( length == i ) {
    target = GLOBAL;
    --i;
  }

  for ( ; i < length; i++ ) {
    // Only deal with non-null/undefined values
    if ( (source = arguments[i]) != null ) {
      // Extend the base object
      Object.getOwnPropertyNames(source).forEach(function(k){
        var d = Object.getOwnPropertyDescriptor(source, k) || {value: source[k]};
        if (d.get) {
          target.__defineGetter__(k, d.get);
          if (d.set) {
            target.__defineSetter__(k, d.set);
          }
        }
        else {
          // Prevent never-ending loop
          if (target === d.value) {
            return;
          }

          if (deep && d.value && typeof d.value === "object") {
            target[k] = mixin(deep,
              // Never move original objects, clone them
              source[k] || (d.value.length != null ? [] : {})
            , d.value);
          }
          else {
            target[k] = d.value;
          }
        }
      });
    }
  }
  // Return the modified object
  return target;
}


var debugLevel = process.env['NODE_DEBUG_AMQP'] ? 1 : 0;
function debug (x) {
  if (debugLevel > 0) sys.error(x + '\n');
}



// a look up table for methods recieved
// indexed on class id, method id
var methodTable = {};

// methods keyed on their name
var methods = {};

// classes keyed on their index
var classes = {};

(function () { // anon scope for init
  //debug("initializing amqp methods...");
  for (var i = 0; i < protocol.classes.length; i++) {
    var classInfo = protocol.classes[i];
    classes[classInfo.index] = classInfo;
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
// - onContentHeader(channel, class, weight, properties, size);
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
  debug('execute: ' + data.toString());
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

          debug("got frame: " + JSON.stringify([ this.frameType
                                               , this.frameChannel
                                               , this.frameSize
                                               ]));

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
        if (data[i] != 206 /* constants.frameEnd */) {
          debug('data[' + i + '] = ' + data[i].toString(16));
          debug('data = ' + data.toString());
          debug('frameHeader: ' + this.frameHeader.toString());
          debug('frameBuffer: ' + this.frameBuffer.toString());
          throw new Error("Oversized frame");
        }
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
  var s = buffer.toString('utf-8', buffer.read, buffer.read+length);
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
  var length = buffer.read + parseInt(buffer, 4);
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

function parseFields (buffer, fields) {
  var args = {};

  var bitIndex = 0;

  var value;

  for (var i = 0; i < fields.length; i++) {
    var field = fields[i];

    //debug("parsing field " + field.name + " of type " + field.domain);

    switch (field.domain) {
      case 'bit':
        // 8 bits can be packed into one octet.

        // XXX check if bitIndex greater than 7?

        value = (buffer[buffer.read] & (1 << bitIndex)) ? true : false;

        if (fields[i+1] && fields[i+1].domain == 'bit') {
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

  return args;
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

  var args = parseFields(buffer, method.fields);

  if (this.onMethod) {
    this.onMethod(channel, method, args);
  }
};


AMQPParser.prototype._parseHeaderFrame = function (channel, buffer) {
  buffer.read = 0;

  var classIndex = parseInt(buffer, 2);
  var weight = parseInt(buffer, 2);
  var size = parseInt(buffer, 8);



  var classInfo = classes[classIndex];

  if (classInfo.fields.length > 15) {
    throw new Error("TODO: support more than 15 properties");
  }


  var propertyFlags = parseInt(buffer, 2);

  var fields = [];
  for (var i = 0; i < classInfo.fields.length; i++) {
    var field = classInfo.fields[i];
    // groan.
    if (propertyFlags & (1 << (15-i))) fields.push(field);
  }

  var properties = parseFields(buffer, fields);

  if (this.onContentHeader) {
    this.onContentHeader(channel, classInfo, weight, properties, size);
  }
};


// Network byte order serialization
// (NOTE: javascript always uses network byte order for its ints.)
function serializeInt (b, size, int) {
  if (b.used + size >= b.length) {
    throw new Error("write out of bounds");
  }

  // Only 4 cases - just going to be explicit instead of looping.

  switch (size) {
    // octet
    case 1:
      b[b.used++] = int;
      break;

    // short
    case 2:
      b[b.used++] = (int & 0xFF00) >> 8;
      b[b.used++] = (int & 0x00FF) >> 0;
      break;

    // long
    case 4:
      b[b.used++] = (int & 0xFF000000) >> 24;
      b[b.used++] = (int & 0x00FF0000) >> 16;
      b[b.used++] = (int & 0x0000FF00) >> 8;
      b[b.used++] = (int & 0x000000FF) >> 0;
      break;


    // long long
    case 8:
      b[b.used++] = (int & 0xFF00000000000000) >> 56;
      b[b.used++] = (int & 0x00FF000000000000) >> 48;
      b[b.used++] = (int & 0x0000FF0000000000) >> 40;
      b[b.used++] = (int & 0x000000FF00000000) >> 32;
      b[b.used++] = (int & 0x00000000FF000000) >> 24;
      b[b.used++] = (int & 0x0000000000FF0000) >> 16;
      b[b.used++] = (int & 0x000000000000FF00) >> 8;
      b[b.used++] = (int & 0x00000000000000FF) >> 0;
      break;

    default:
      throw new Error("Bad size");
  }
}


function serializeShortString (b, string) {
  if (typeof(string) != "string") {
    throw new Error("param must be a string");
  }
  var byteLength = Buffer.byteLength(string, 'utf8');
  if (byteLength > 0xFF) {
    throw new Error("String too long for 'shortstr' parameter");
  }
  if (1 + byteLength + b.used >= b.length) {
    throw new Error("Not enough space in buffer for 'shortstr'");
  }
  b[b.used++] = byteLength;
  b.write(string, b.used, 'utf8');
  b.used += byteLength;
}


function serializeLongString (b, string) {
  // we accept string, object, or buffer for this parameter.
  // in the case of string we serialize it to utf8.
  if (typeof(string) == 'string') {
    var byteLength = Buffer.byteLength(string, 'utf8');
    serializeInt(b, 4, byteLength);
    b.write(string, b.used, 'utf-8');
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


function serializeFields (buffer, fields, args, strict) {
  var bitField = 0;
  var bitIndex = 0;

  for (var i = 0; i < fields.length; i++) {
    var field = fields[i];
    var domain = field.domain;

    if (!(field.name in args)) {
      if (strict) {
        throw new Error("Missing field '" + field.name + "' of type " + domain);
      }
      continue;
    }

    var param = args[field.name];

    //debug("domain: " + domain + " param: " + param);

    switch (domain) {
      case 'bit':
        if (typeof(param) != "boolean") {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }

        if (param) bitField |= (1 << bitIndex);
        bitIndex++;

        if (!fields[i+1] || fields[i+1].domain != 'bit') {
          debug('SET bit field ' + field.name + ' 0x' + bitField.toString(16));
          buffer[buffer.used++] = bitField;
          bitField = 0;
          bitIndex = 0;
        } 
        break;

      case 'octet':
        if (typeof(param) != "number" || param > 0xFF) {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        buffer[buffer.used++] = param;
        break;

      case 'short':
        if (typeof(param) != "number" || param > 0xFFFF) {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        serializeInt(buffer, 2, param);
        break;

      case 'long':
        if (typeof(param) != "number" || param > 0xFFFFFFFF) {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        serializeInt(buffer, 4, param);
        break;

      case 'longlong':
        serializeInt(buffer, 8, param);
        break;

      case 'shortstr':
        if (typeof(param) != "string" || param.length > 0xFF) {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        serializeShortString(buffer, param);
        break;

      case 'longstr':
        serializeLongString(buffer, param);
        break;

      case 'table':
        if (typeof(param) != "object") {
          throw new Error("Unmatched field " + JSON.stringify(field));
        }
        serializeTable(buffer, param);
        break;

      default:
        throw new Error("Unknown domain value type " + domain);
    }
  }
}




function Connection (options) {
  net.Stream.call(this);

  var self = this;

  this.setOptions(options);

  var state = 'handshake';
  var parser;

  this._defaultExchange = null;

  self.addListener('connect', function () {
    // channel 0 is the control channel.
    self.channels = [self];
    self.queues = {};
    self.exchanges = {};

    parser = new AMQPParser('0-8', 'client');

    parser.onMethod = function (channel, method, args) {
      self._onMethod(channel, method, args);
    };

    parser.onContent = function (channel, data) {
      debug(channel + " > content " + data.length);
      if (self.channels[channel] && self.channels[channel]._onContent) {
        self.channels[channel]._onContent(channel, data);
      } else {
        debug("unhandled content: " + data);
      }
    };

    parser.onContentHeader = function (channel, classInfo, weight, properties, size) {
      debug(channel + " > content header " + JSON.stringify([classInfo.name, weight, properties, size]));
      if (self.channels[channel] && self.channels[channel]._onContentHeader) {
        self.channels[channel]._onContentHeader(channel, classInfo, weight, properties, size);
      } else {
        debug("unhandled content header");
      }
    };

    parser.onHeartBeat = function () {
      debug("heartbeat");
    };

    //debug("connected...");
    // Time to start the AMQP 7-way connection initialization handshake!
    // 1. The client sends the server a version string
    self.write("AMQP" + String.fromCharCode(1,1,8,0));
    state = 'handshake';
  });

  self.addListener('data', function (data) {
    parser.execute(data);
  });

  self.addListener('end', function () {
    self.end();
    // in order to allow reconnects, have to clear the
    // state.
    parser = null;
  });
}
sys.inherits(Connection, net.Stream);
exports.Connection = Connection;


var defaultOptions = { host: 'localhost'
                     , port: 5672
                     , login: 'guest'
                     , password: 'guest'
                     , vhost: '/'
                     };


exports.createConnection = function (options) {
  var c = new Connection();
  c.setOptions(options);
  c.reconnect();
  return c;
};

Connection.prototype.setOptions = function (options) {
  var o  = {};
  mixin(o, defaultOptions, options || {});
  this.options = o;
};

Connection.prototype.reconnect = function () {
  this.connect(this.options.port, this.options.host);
};

Connection.prototype._onMethod = function (channel, method, args) {
  debug(channel + " > " + method.name + " " + JSON.stringify(args));

  // Channel 0 is the control channel. If not zero then deligate to
  // one of the channel objects.

  if (channel > 0) {
    if (!this.channels[channel]) {
      debug("Received message on untracked channel.");
      return;
    }
    if (!this.channels[channel]._onMethod) {
      throw new Error('Channel ' + channel + ' has no _onMethod method.');
    }
    this.channels[channel]._onMethod(channel, method, args);
    return;
  }

  // channel 0

  switch (method) {
    // 2. The server responds, after the version string, with the
    // 'connectionStart' method (contains various useless information)
    case methods.connectionStart:
      // We check that they're serving us AMQP 0-8
      if (args.versionMajor != 8 && args.versionMinor != 0) {
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
          , mechanism: 'AMQPLAIN'
          , response:
            { LOGIN: this.options.login
            , PASSWORD: this.options.password
            }
          , locale: 'en_US'
          });
      break;

    // 4. The server responds with a connectionTune request
    case methods.connectionTune:
      // 5. We respond with connectionTuneOk
      this._sendMethod(0, methods.connectionTuneOk,
          { channelMax: 0
          , frameMax: maxFrameBuffer
          , heartbeat: 0
          });
      // 6. Then we have to send a connectionOpen request
      this._sendMethod(0, methods.connectionOpen,
          { virtualHost: this.options.vhost
          , capabilities: ''
          , insist: true
          });
      break;


    case methods.connectionOpenOk:
      // 7. Finally they respond with connectionOpenOk
      // Whew! That's why they call it the Advanced MQP.
      this.emit('ready');
      break;

    case methods.connectionClose:
      var e = new Error(args.replyText);
      e.code = args.replyCode;
      if (!this.listeners('close').length) {
        sys.puts('Unhandled connection error: ' + args.replyText);
      }
      this.destroy(e);
      break;

    default:
      throw new Error("Uncaught method '" + method.name + "' with args " +
          JSON.stringify(args));
  }
};


Connection.prototype._sendMethod = function (channel, method, args) {
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

  serializeFields(b, method.fields, args, true);

  var endIndex = b.used;

  // write in the frame length now that we know it.
  b.used = lengthIndex;
  serializeInt(b, 4, endIndex - startIndex);
  b.used = endIndex;

  b[b.used++] = 206; // constants.frameEnd;

  var c = b.slice(0, b.used);

  //debug("sending frame: " + c);

  this.write(c);
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
// - experation
// - messageId
// - timestamp
// - userId
// - appId
// - clusterId
function sendHeader (connection, channel, size, properties) {
  var b = new Buffer(maxFrameBuffer); // FIXME allocating too much.
                                      // use freelist?
  b.used = 0;

  var classInfo = classes[60]; // always basic class.

  // 7 OCTET FRAME HEADER

  b[b.used++] = 2; // constants.frameHeader

  serializeInt(b, 2, channel);

  var lengthStart = b.used;

  serializeInt(b, 4, 0 /*dummy*/); // length

  var bodyStart = b.used;

  // HEADER'S BODY

  serializeInt(b, 2, classInfo.index);   // class 60 for Basic
  serializeInt(b, 2, 0);                 // weight, always 0 for rabbitmq
  serializeInt(b, 8, size);              // byte size of body

  // properties - first propertyFlags
  var props = {'contentType': 'application/octet-stream'};
  mixin(props, properties);
  var propertyFlags = 0;
  for (var i = 0; i < classInfo.fields.length; i++) {
    if (props[classInfo.fields[i].name]) propertyFlags |= 1 << (15-i);
  }
  serializeInt(b, 2, propertyFlags);
  // now the actual properties.
  serializeFields(b, classInfo.fields, props, false);

  //serializeTable(b, props);

  var bodyEnd = b.used;

  // Go back to the header and write in the length now that we know it.
  b.used = lengthStart;
  serializeInt(b, 4, bodyEnd - bodyStart);
  b.used = bodyEnd;

  // 1 OCTET END

  b[b.used++] = 206; // constants.frameEnd;

  var s = b.slice(0, b.used);

  //debug('header sent: ' + JSON.stringify(s));

  connection.write(s);
}


Connection.prototype._sendBody = function (channel, body, properties) {
  // Handles 3 cases
  // - body is utf8 string
  // - body is instance of Buffer
  // - body is an object and its JSON representation is sent
  // Does not handle the case for streaming bodies.
  if (typeof(body) == 'string') {
    var length = Buffer.byteLength(body);
    //debug('send message length ' + length);

    sendHeader(this, channel, length, properties);

    //debug('header sent');

    var b = new Buffer(7+length+1);
    b.used = 0;
    b[b.used++] = 3; // constants.frameBody
    serializeInt(b, 2, channel);
    serializeInt(b, 4, length);

    b.write(body, b.used, 'utf8');
    b.used += length;

    b[b.used++] = 206; // constants.frameEnd;
    return this.write(b);

    //debug('body sent: ' + JSON.stringify(b));

  } else if (body instanceof Buffer) {
    sendHeader(this, channel, body.length, properties);

    var b = new Buffer(7);
    b.used = 0;
    b[b.used++] = 3; // constants.frameBody
    serializeInt(b, 2, channel);
    serializeInt(b, 4, body.length);
    this.write(b);

    this.write(body);

    return this.write(String.fromCharCode(206)); // frameEnd

  } else {
    // Optimize for JSON.
    // Use asciiWrite() which is much faster than utf8Write().
    var jsonBody = JSON.stringify(body);
    var length = jsonBody.length;

    debug('sending json: ' + jsonBody);

    properties = mixin({contentType: 'text/json' }, properties);

    sendHeader(this, channel, length, properties);

    var b = new Buffer(7+length+1);
    b.used = 0;

    b[b.used++] = 3; // constants.frameBody
    serializeInt(b, 2, channel);
    serializeInt(b, 4, length);

    b.write(jsonBody, b.used, 'ascii');
    b.used += length;

    b[b.used++] = 206; // constants.frameEnd;
    return this.write(b);
  }
};


// Options
// - passive (boolean)
// - durable (boolean)
// - exclusive (boolean)
// - autoDelete (boolean, default true)
Connection.prototype.queue = function (name /* , options, openCallback */) {
  if (this.queues[name]) return this.queues[name];
  var channel = this.channels.length;

  var options, callback;
  if (typeof arguments[1] == 'object') {
    options = arguments[1];
    callback = arguments[2];
  } else {
    callback = arguments[1];
  }


  var q = new Queue(this, channel, name, options, callback);
  this.channels.push(q);
  this.queues[name] = q;
  return q;
};

// remove a queue when it's closed (called from Queue)
Connection.prototype.queueClosed = function (name) {
  if (this.queues[name]) delete this.queues[name];
};


// connection.exchange('my-exchange', { type: 'topic' });
// Options
// - type 'fanout', 'direct', or 'topic' (default)
// - passive (boolean)
// - durable (boolean)
// - autoDelete (boolean, default true)
Connection.prototype.exchange = function (name, options) {
  if (!name) name = 'amq.topic';

  if (!options) options = {};
  if (options.type === undefined) options.type = 'topic';

  if (this.exchanges[name]) return this.exchanges[name];
  var channel = this.channels.length;
  var exchange = new Exchange(this, channel, name, options);
  this.channels.push(exchange);
  this.exchanges[name] = exchange;
  return exchange;
};

// Publishes a message to the amq.topic exchange.
Connection.prototype.publish = function (routingKey, body) {
  if (!this._defaultExchange) this._defaultExchange = this.exchange();
  return this._defaultExchange.publish(routingKey, body);
};



// Properties:
// - routingKey
// - size
// - deliveryTag
//
// - contentType (default 'application/octet-stream')
// - contentEncoding
// - headers
// - deliveryMode
// - priority (0-9)
// - correlationId
// - replyTo
// - experation
// - messageId
// - timestamp
// - userId
// - appId
// - clusterId
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
// received on this queue.
Message.prototype.acknowledge = function (all) {
  this.queue.connection._sendMethod(this.queue.channel, methods.basicAck,
      { ticket: 0
      , deliveryTag: this.deliveryTag
      , multiple: all ? true : false
      });
};


// This class is not exposed to the user. Queue and Exchange are subclasses
// of Channel. This just provides a task queue.
function Channel (connection, channel) {
  events.EventEmitter.call(this);

  this.channel = channel;
  this.connection = connection;
  this._tasks = [];

  this.connection._sendMethod(channel, methods.channelOpen, {outOfBand: ""});
}
sys.inherits(Channel, events.EventEmitter);


Channel.prototype._taskPush = function (reply, cb) {
  var promise = new Promise();
  this._tasks.push({ promise: promise
                   , reply: reply
                   , sent: false
                   , cb: cb
                   });
  this._tasksFlush();
  return promise;
};


Channel.prototype._tasksFlush = function () {
  if (this.state != 'open') return;

  for (var i = 0; i < this._tasks.length; i++) {
    var task = this._tasks[i];
    if (task.sent) continue;
    task.cb();
    task.sent = true;
    if (!task.reply) {
      // if we don't expect a reply, just delete it now
      this._tasks.splice(i, 1);
      i = i-1;
    }
  }
};

Channel.prototype._handleTaskReply = function (channel, method, args) {
  var task, i;

  for (i = 0; i < this._tasks.length; i++) {
    if (this._tasks[i].reply == method) {
      task = this._tasks[i];
      this._tasks.splice(i, 1);
      task.promise.emitSuccess();
      this._tasksFlush();
      return true;
    }
  }

  return false;
};



function Queue (connection, channel, name, options, callback) {
  Channel.call(this, connection, channel);

  this.name = name;

  this.options = { autoDelete: true };
  if (options) mixin(this.options, options);

  this._openCallback = callback;
}
sys.inherits(Queue, Channel);


Queue.prototype.subscribeRaw = function (/* options, messageListener */) {
  var self = this;

  var messageListener = arguments[arguments.length-1];
  this.addListener('rawMessage', messageListener);

  var options = { };
  if (typeof arguments[0] == 'object') {
    mixin(options, arguments[0]);
  }

  return this._taskPush(methods.basicConsumeOk, function () {
    self.connection._sendMethod(self.channel, methods.basicConsume,
        { ticket: 0
        , queue: self.name
        , consumerTag: ''+new Date().getTime()
        , consumerTag: "."
        , noLocal: options.noLocal ? true : false
        , noAck: options.noAck ? true : false
        , exclusive: options.exclusive ? true : false
        , nowait: false
        , "arguments": {}
        });
  });
};


Queue.prototype.subscribe = function (/* options, messageListener */) {
  var self = this;

  var messageListener = arguments[arguments.length-1];

  var options = { ack: false };
  if (typeof arguments[0] == 'object') {
    if (arguments[0].ack) options.ack = true;
  }

  this.addListener('message', messageListener);

  if (options.ack) {
    this._taskPush(methods.basicQosOk, function () {
      self.connection._sendMethod(self.channel, methods.basicQos,
          { ticket: 0
          , prefetchSize: 0
          , prefetchCount: 1
          , global: false
          });
    });
  }

  // basic consume
  var rawOptions = { noAck: !options.ack };
  return this.subscribeRaw(rawOptions, function (m) {
    var isJSON = (m.contentType == 'text/json') || (m.contentType == 'application/json');

    var b;

    if (isJSON) {
      b = ""
    } else {
      b = new Buffer(m.size);
      b.used = 0;
    }

    self._lastMessage = m;

    m.addListener('data', function (d) {
      if (isJSON) {
        b += d.toString();
      } else {
        d.copy(b, b.used);
        b.used += d.length;
      }
    });

    m.addListener('end', function () {
      var json;
      if (isJSON) {
        json = JSON.parse(b);
      } else {
        json = { data: b, contentType: m.contentType };
      }

      json._routingKey = m.routingKey;
      json._deliveryTag = m.deliveryTag;


      self.emit('message', json);
    });
  });
};
Queue.prototype.subscribeJSON = Queue.prototype.subscribe;


/* Acknowledges the last message */
Queue.prototype.shift = function () {
  if (this._lastMessage) {
    this._lastMessage.acknowledge();
  }
};


Queue.prototype.bind = function (/* [exchange,] routingKey */) {
  var self = this;

  // The first argument, exchange is optional.
  // If not supplied the connection will use the default 'amq.topic'
  // exchange.
 
  var exchange, routingKey;

  if (arguments.length == 2) {
    exchange = arguments[0];
    routingKey = arguments[1];
  } else {
    exchange = 'amq.topic';   
    routingKey = arguments[0];
  }


  return this._taskPush(methods.queueBindOk, function () {
    var exchangeName = exchange instanceof Exchange ? exchange.name : exchange;
    self.connection._sendMethod(self.channel, methods.queueBind,
        { ticket: 0
        , queue: self.name
        , exchange: exchangeName
        , routingKey: routingKey
        , nowait: false
        , "arguments": {}
        });
  });
};


Queue.prototype.destroy = function (options) {
  var self = this;
  options = options || {};
  return this._taskPush(methods.queueDeleteOk, function () {
    self.connection.queueClosed(self.name);
    self.connection._sendMethod(self.channel, methods.queueDelete,
        { ticket: 0
        , queue: self.name
        , ifUnused: options.ifUnused ? true : false
        , ifEmpty: options.ifEmpty ? true : false
        , nowait: false
        , "arguments": {}
        });
  });
};


Queue.prototype._onMethod = function (channel, method, args) {
  if (this._handleTaskReply.apply(this, arguments)) return;

  switch (method) {
    case methods.channelOpenOk:
      this.connection._sendMethod(channel, methods.queueDeclare,
          { ticket: 0
          , queue: this.name
          , passive: this.options.passive ? true : false
          , durable: this.options.durable ? true : false
          , exclusive: this.options.exclusive ? true : false
          , autoDelete: this.options.autoDelete ? true : false
          , nowait: false
          , "arguments": {}
          });
      this.state = "declare queue";
      break;

    case methods.queueDeclareOk:
      this.state = 'open';
      if (this._openCallback) {
        this._openCallback(args.messageCount, args.consumerCount);
        this._openCallback = null;
      }
      // TODO this is legacy interface, remove me
      this.emit('open', args.messageCount, args.consumerCount);
      break;

    case methods.channelClose:
      this.state = "closed";
      var e = new Error(args.replyText);
      e.code = args.replyCode;
      if (!this.listeners('close').length) {
        sys.puts('Unhandled channel error: ' + args.replyText);
      }
      this.emit('error', e);
      this.emit('close', e);
      break;

    case methods.basicDeliver:
      this.currentMessage = new Message(this, args);
      break;

    default:
      throw new Error("Uncaught method '" + method.name + "' with args " +
          JSON.stringify(args) + "; tasks = " + JSON.stringify(this._tasks));
  }

  this._tasksFlush();
};


Queue.prototype._onContentHeader = function (channel, classInfo, weight, properties, size) {
  mixin(this.currentMessage, properties);
  this.currentMessage.read = 0;
  this.currentMessage.size = size;

  this.emit('rawMessage', this.currentMessage);
};


Queue.prototype._onContent = function (channel, data) {
  this.currentMessage.read += data.length
  this.currentMessage.emit('data', data);
  if (this.currentMessage.read == this.currentMessage.size) {
    this.currentMessage.emit('end');
  }
};




function Exchange (connection, channel, name, options) {
  Channel.call(this, connection, channel);
  this.name = name;
  this.options = options || { autoDelete: true};
}
sys.inherits(Exchange, Channel);



Exchange.prototype._onMethod = function (channel, method, args) {
  if (this._handleTaskReply.apply(this, arguments)) return true;

  switch (method) {
    case methods.channelOpenOk:
      // Default exchanges don't need to be declared
      if (/^amq\./.test(this.name)) {
        this.state = 'open';
        this.emit('open');
      } else {
        this.connection._sendMethod(channel, methods.exchangeDeclare,
            { ticket: 0
            , exchange:   this.name
            , type:       this.options.type || 'topic'
            , passive:    this.options.passive    ? true : false
            , durable:    this.options.durable    ? true : false
            , autoDelete: this.options.autoDelete ? true : false
            , internal:   this.options.internal   ? true : false
            , nowait:     false
            , "arguments": {}
            });
        this.state = 'declaring';
      }
      break;

    case methods.exchangeDeclareOk:
      this.state = 'open';
      this.emit('open');
      break;

    case methods.channelClose:
      this.state = "closed";
      var e = new Error(args.replyText);
      e.code = args.replyCode;
      if (!this.listeners('close').length) {
        sys.puts('Unhandled channel error: ' + args.replyText);
      }
      this.emit('close', e);
      break;

    case methods.basicReturn:
      sys.puts("Warning: Uncaught basicReturn: "+JSON.stringify(args));
      this.emit('basicReturn', args);
      break;

    default:
      throw new Error("Uncaught method '" + method.name + "' with args " +
          JSON.stringify(args));
  }

  this._tasksFlush();
};


// exchange.publish('routing.key', 'body');
//
// the thrid argument can specify additional options
// - mandatory (boolean, default false)
// - immediate (boolean, default false)
// - contentType (default 'application/octet-stream')
// - contentEncoding
// - headers
// - deliveryMode
// - priority (0-9)
// - correlationId
// - replyTo
// - experation
// - messageId
// - timestamp
// - userId
// - appId
// - clusterId
Exchange.prototype.publish = function (routingKey, data, options) {
  options = options || {};

  var self = this;
  return this._taskPush(null, function () {
    self.connection._sendMethod(self.channel, methods.basicPublish,
        { ticket: 0
        , exchange:   self.name
        , routingKey: routingKey
        , mandatory:  options.mandatory ? true : false
        , immediate:  options.immediate ? true : false
        });
    // This interface is probably not appropriate for streaming large files.
    // (Of course it's arguable about whether AMQP is the appropriate
    // transport for large files.) The content header wants to know the size
    // of the data before sending it - so there's no point in trying to have a
    // general streaming interface - streaming messages of unknown size simply
    // isn't possible with AMQP. This is all to say, don't send big messages.
    // If you need to stream something large, chunk it yourself.
    self.connection._sendBody(self.channel, data, options);
  });
};


Exchange.prototype.destroy = function (ifUnused) {
  var self = this;
  return this._taskPush(methods.exchangeDeleteOk, function () {
    self.connection._sendMethod(self.channel, methods.exchangeDelete,
        { ticket: 0
        , exchange: self.name
        , ifUnused: ifUnused ? true : false
        , nowait: false
        });
  });
};


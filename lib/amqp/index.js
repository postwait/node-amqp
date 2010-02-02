var debugLevel = 0;
if ('NODE_DEBUG' in process.ENV) debugLevel = 1;
function debug (x) {
  if (debugLevel > 0) {
    process.stdio.writeError(x + '\n');
  }
}

var Buffer = process.Buffer;


Buffer.prototype.toString = function () {
  var out = "[";
  for (var i = 0; i < this.length; i++) {
    out += this[i];
    if (i != this.length - 1)  out += ", ";
  }
  out += "]";
  return out;
};



var sys = require('sys');
var net = require('net');
var constants = require('./constants');


// AMQP frame parser states
var s_frameHeader = 1,
    s_bufferFrame = 2,
    s_frameEnd = 3;

var s_handshake = 1;


var maxFrameBuffer = 8 * 1024;


// An interruptible AMQP parser.
//
// type is either 'server' or 'client'
// version is '0-8' or '0-9-1'. Currently only supporting '0-8'.
//
// Instances of this class have several callbacks
// - onMethod(channel, classId, methodId, args);
// - onHeartBeat()
// - onContent(channel, buffer);
//
// This class does not subclass EventEmitter, in order to reduce the speed
// of emitting the callbacks. Since this is an internal class, that should
// be fine.
function AMQPParser (version, type) {
  this.isClient = (type == 'client');
  this.state = this.isClient ? s_frameHeader : s_protocolHeader;

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
      case s_frameHeader:
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

          debug("got frame: " + JSON.stringify([ this.frameType
                                               , this.frameChannel
                                               , this.frameSize
                                               ]));

          if (this.frameSize > maxFrameBuffer) {
            throw new Error("Oversized frame");
          }

          // TODO use a free list and keep a bunch of 8k buffers around
          this.frameBuffer = new Buffer(this.frameSize);
          this.frameBuffer.used = 0;
          this.state = s_bufferFrame;
        }
        break;

      case s_bufferFrame:
        // Buffer the entire frame. I would love to avoid this, but doing
        // otherwise seems to be extremely painful.
        
        // Copy the incoming data byte-by-byte to the buffer.
        // FIXME This is slow! Can be improved with a memcpy binding.
        this.frameBuffer[this.frameBuffer.used++] = data[i];

        if (this.frameBuffer.used == this.frameSize) {
          // Finished buffering the frame. Parse the frame.
          switch (this.frameType) {
            case constants.frameMethod:
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
          this.state = s_frameEnd;
        }
        break;

      case s_frameEnd:
        // Frames are terminated by a single octet.
        if (data[i] != constants.frameEnd) throw new Error("Oversized frame");
        this.state = s_frameHeader;
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


function parseShort (buffer) {
  return parseInt(buffer, 2);
}


function parseLong (buffer) {
  return parseInt(buffer, 4);
}


function parseLongLong (buffer) {
  // 64-bit integers? What the fuck.
  // Yeah, like we're going to be sending +4gig files through
  // the message queue. Thanks for covering all the bases, AMQP
  // committee.
  return parseInt(buffer, 8);
}


function parseShortString (buffer) {
  var length = buffer[buffer.read++];
  var s = buffer.utf8Slice(buffer.read, buffer.read+length);
  buffer.read += length;
  return s;
}


function parseLongString (buffer) {
  var length = parseLong(buffer);
  var s = buffer.slice(buffer.read, buffer.read + length);
  buffer.read += length;
  return s;
}


function parseSignedInteger (buffer) {
  var int = parseLong(buffer);
  if (int & 0x80000000) {
    int |= 0xEFFFFFFF;
    int = -int;
  }
  return int;
}


function parseTable (table) {
  var length = parseLong(buffer);
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
        var int = parseLong(buffer);
        // TODO make into float...?
        // FIXME this isn't correct
        table[field] = '?';
        break;

      case 'T'.charCodeAt(0):
        // 64bit time stamps. Awesome.
        var int = parseLongLong(buffer);
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
  var classId = parseShort(buffer),
     methodId = parseShort(buffer);


  // Make sure that this is a method that we understand.
  if (!constants.methods[classId] || !constants.methods[classId][methodId]) {
    throw new Error("Received unknown [classId, methodId] pair [" + 
                    classId + ", " + methodId + "]");
  }

  var method = constants.methods[classId][methodId];

  var args = [];

  var bitIndex = 0;

  for (var i = 0; i < method.params; i++) {
    switch (method.params[i]) {
      case 'bit':
        // 8 bits can be packed into one octet.

        // XXX check if bitIndex greater than 7?

        if (buffer[buffer.read] & (1 << bitIndex)) {
          args.push(true);
        } else {
          args.push(false);
        }

        if (method.params[i+1] == 'bit')  {
          bitIndex++;
        } else {
          bitIndex = 0;
          buffer.read++;
        }
        break;

      case 'octet':
        args.push(buffer[buffer.read]);
        buffer.read += 1;
        break;

      case 'short':
        args.push(parseShort(buffer));
        break;

      case 'long':
        args.push(parseLong(buffer));
        break;

      case 'longlong':
        args.push(parseLongLong(buffer));
        break;

      case 'shortstr':
        args.push(parseShortString(buffer));
        break;

      case 'longstr':
        args.push(parseLongString(buffer));
        break;

      case 'table':
        args.push(parseTable(buffer));
        break;

      default:
        throw new Error("Unhandled parameter type " + paramType);
    }
  }

  if (this.onMethod) {
    this.onMethod(channel, classId, methodId, args);
  }
};


AMQPParser.prototype._parseHeaderFrame = function (channel, buffer) {
  // Does anyone even know what header frames are for? Ignoring.
  buffer.read = 0;

  /*
  var class = parseShort(buffer);
  var weight = parseShort(buffer);
  var size = parseLongLong(buffer);
  */

  //var flags = parseShort(buffer);

};


exports.createConnection = function (opts) {
  return new exports.Connection(opts);
};

exports.defaultOptions = {
  host: 'localhost',
  port: 5672,
  login: 'guest',
  vhost: '/',
  password: 'guest'
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
        serializeShortString(b, value);
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


function sendMethod (conn, method, channel) {
  var b = new Buffer(maxFrameBuffer);
  b.used = 0;

  b[b.used++] = constants.frameMethod;

  serializeInt(b, 2, channel);

  var lengthIndex = b.used;

  serializeInt(b, 4, 42); // replace with actual length.

  var startIndex = b.used;


  serializeInt(b, 2, method[0]); // short, classId
  serializeInt(b, 2, method[1]); // short, methodId

  for (var i = 2; i < method.length; i++) {
    var arg = method[i];
    var param = arguments[i+1];

    debug("arg: " + arg + " param: " + param);
    var s = b.used;

    switch (arg) {
      case 'octet':
        b[b.used++] = param;
        break;

      case 'short':
        serializeInt(b, 2, param);
        break;

      case 'long':
        serializeInt(b, 4, param);
        break;

      case 'longlong':
        serializeInt(b, 8, param);
        break;

      case 'shortstr':
        serializeShortString(b, param);
        break;

      case 'longstr':
        // we accept string, object, or buffer for this parameter.
        // in the case of string we serialize it to utf8.
        if (typeof(param) == 'string') {
          var byteLength = Buffer.utf8ByteLength(param);
          serializeInt(b, 4, byteLength);
          b.utf8Write(param, b.used);
          b.used += byteLength;
        } else if (typeof(param) == 'object') {
          serializeTable(b, param);
        } else {
          // data is Buffer
          var byteLength = param.length;
          serializeInt(b, 4, byteLength);
          b.write(param, b.used); // memcpy
          b.used += byteLength;
        }
        break;

      case 'table':
        serializeTable(b, param);
        break;

      default:
        throw new Error("Unknown arg value type " + arg);
    }
    debug("enc: " + b.slice(s, b.used));
  }


  var endIndex = b.used;

  // write in the frame length now that we know it.
  b.used = lengthIndex;
  serializeInt(b, 4, endIndex - startIndex);
  b.used = endIndex;

  b[b.used++] = constants.frameEnd;

  var c = b.slice(0, b.used);

  debug("sending frame: " + c);

  conn.send(c);
}


function match (classId, methodId, method) {
  return classId == method[0] && methodId == method[1];
}


exports.Connection = function (options) {
  process.EventEmitter.call(this);

  var self = this;
  var opts = {};

  process.mixin(opts, exports.defaultOptions, options);

  this.connection = net.createConnection(opts.port, opts.host);
  var conn = this.connection;

  var parser = new AMQPParser('0-8', 'client');

  var state;

  conn.addListener("connect", function () {
    debug("connected...");
    conn.send("AMQP" + String.fromCharCode(1,1,8,0));
    state = s_handshake;
  });

  conn.addListener('close', function () {
    self.emit('close');
    debug('close');
  });

  conn.addListener('end', function () {
    debug('got eof');
    self.emit('close');
  });

  conn.addListener("data", function (data) {
    parser.execute(data);
  });

  parser.onMethod = function (channel, classId, methodId, args) {
    switch (state) {
      case s_handshake:
        debug("args: " + args);
        if (match(classId, methodId, constants.Connection.Start)) {
          sendMethod( conn
                    , constants.Connection.StartOk
                    , constants.Channel.All
                    , { version: '0.0.1'
                      , platform: 'node'
                      , product: 'node-amqp'
                      }
                    , 'AMQPLAIN'
                    , { LOGIN: opts.login
                      , PASSWORD: opts.password
                      }
                    , 'en_US'
                    );
        }
        break;
    }
  };

  parser.onContent = function (channel, data) {
    debug("content: " + data);  
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
sys.inherits(exports.Connection, process.EventEmitter);

var proto = exports.Connection.prototype;


proto.queue = function (name) {
  return new Queue.Queue(this.conn, {name: name});
};

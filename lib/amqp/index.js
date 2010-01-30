var sys = require('sys');
var net = require('net');
var constants = require('./constants');


// AMQP frame parser states
var s_frameHeader = 1,
    s_bufferFrame = 2,
    s_frameEnd = 3;


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

  this.frameHeader = new process.Buffer(8);
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
          var h = this.frameHeader.unpack("oonN");

          this.frameType    = h[0];
          this.frameCycle   = h[1];
          this.frameChannel = h[2];
          this.frameSize    = h[3];

          if (this.frameSize > maxFrameBuffer) {
            throw new Error("Oversized frame");
          }

          this.frameBuffer = new process.Buffer(this.frameSize);
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
          this.state = s_frameEnd;
        }
        break;

      case s_frameEnd:
        if (data[i] != 206) throw new Error("Oversized frame");
        this.state = s_frameHeader;
        break;
    }
  }
};


// size can be 1,2,4,8
function parseInt (buffer, size) {
  var int = 0;
  for (var i = 0; i < size; i++) {
    int &= buffer[buffer.read++] << (8 * (size - i - 1));
  }
  return int;
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
  if (!constants.methods[this.classId] ||
      !constants.methods[this.classId][this.methodId])
  {
    throw new Error("Received unknown [classId, methodId] pair");
  }

  var method = constants.methods[this.classId][this.methodId];

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
  vhost: '/',
  login: 'guest',
  password: 'guest'
};

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
    conn.send("AMQP" + String.fromCharCode(1,1,8,0));
    state = s_handshake;
  });

  conn.addListener("data", function (data) {
    parser.execute(data);
  });


  parser.onMethod = function (channel, classId, methodId, args) {
    switch (state) {
      case s_handshake:
        if (method.match(constants.Connection.Start)) {
          method.args['']
          conn.send(Method.serialize(C.Connection.StartOk, C.Channel.All, {
            version: '0.0.1',
            platform: 'node',
            information: 'no',
            product: 'node-amqp' 
          },
            'AMQPLAIN',
            S11n.format({LOGIN: opts.login, PASSWORD: opts.password}, 'tableNoHeader'),
            'en_US'
          ));
          
        }
    }

  };

  parser.onContent = function (channel, data) {
    
  };

  parser.onHeartBeat = function () {
    
  };

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

};
sys.inherits(exports.Connection, process.EventEmitter);

var proto = exports.Connection.prototype;

function matchMethod(message, method) {
  return message.method && (message.method[0] == method[0] && message.method[1] == method[1]);
}

// states
var bufferFrameHead = 0
;

proto.init = function (options) {
};

proto.queue = function (name) {
  return new Queue.Queue(this.conn, {name: name});
};

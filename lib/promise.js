var events = require('events');
var inherits = require('util').inherits;

exports.Promise = function () {
  events.EventEmitter.call(this);
  this._blocking = false;
  this.hasFired = false;
  this.hasAcked = false;
  this._values = undefined;
};
inherits(exports.Promise, events.EventEmitter);


exports.Promise.prototype.timeout = function(timeout) {
  if (!timeout) {
    return this._timeoutDuration;
  }
  
  this._timeoutDuration = timeout;
  
  if (this.hasFired) return;
  this._clearTimeout();

  var self = this;
  this._timer = setTimeout(function() {
    self._timer = null;
    if (self.hasFired) {
      return;
    }

    self.emitError(new Error('timeout'));
  }, timeout);

  return this;
};

exports.Promise.prototype._clearTimeout = function() {
  if (!this._timer) return;
  
  clearTimeout(this._timer);
  this._timer = null;
}

exports.Promise.prototype.emitSuccess = function() {
  if (this.hasFired) return;
  this.hasFired = 'success';
  this._clearTimeout();

  this._values = Array.prototype.slice.call(arguments);
  this.emit.apply(this, ['success'].concat(this._values));
};

exports.Promise.prototype.emitAck = function() {
  if (this.hasAcked) return;
  this.hasAcked = 'true';

  this._values = Array.prototype.slice.call(arguments);
  this.emit.apply(this, ['ack'].concat(this._values));
};

exports.Promise.prototype.emitError = function() {
  if (this.hasFired) return;
  this.hasFired = 'error';
  this._clearTimeout();

  this._values = Array.prototype.slice.call(arguments);
  this.emit.apply(this, ['error'].concat(this._values));

  if (this.listeners('error').length == 0) {
    var self = this;
    process.nextTick(function() {
      if (self.listeners('error').length == 0) {
        throw (self._values[0] instanceof Error)
          ? self._values[0]
          : new Error('Unhandled emitError: '+JSON.stringify(self._values));
      }
    });
  }
};

exports.Promise.prototype.addCallback = function (listener) {
  if (this.hasFired === 'success') {
    listener.apply(this, this._values);
  }

  return this.addListener("success", listener);
};

exports.Promise.prototype.addErrback = function (listener) {
  if (this.hasFired === 'error') {
    listener.apply(this, this._values);
  }

  return this.addListener("error", listener);
};

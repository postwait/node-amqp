# node-amqp

IMPORTANT: This only works with the net2 branch of node. net2 has better
support for parsing raw binary.

This is a client for RabbitMQ (and maybe other servers?). It partially
implements the 0.8 version of the AMQP protocol.


## Synopsis

An example of connecting to a server and listening on a queue.

    var sys = require('sys');
    var amqp = require('./amqp');
    var connection = amqp.createConnection({ host: 'dev.rabbitmq.com' });
    connection.addListener('ready', function () {
      var exchange = connection.exchange('my-exchange');
      var queue = connection.queue('my-queue');
      queue.bind(exchange, "*")
      queue.subscribeJSON(function (message) {
        sys.p(message);
      });
    });



## Connection

`amqp.createConnection()` returns an instance of `amqp.Connection`, which is
a subclass of `net.Connection`. All the event and methods which work on
`net.Connection` can also be used on an `amqp.Connection` instace.

`amqp.createConnection()` takes an options object as its only parameter.
The options object has the these defaults:

    { host: 'localhost'
    , port: 5672
    , login: 'guest'
    , password: 'guest'
    , vhost: '/'
    }

After a connection is established the `'connect'` event is fired as it is
with any `net.Connection` instance. AMQP requires a 7-way handshake which
must be completed before any communication can begin. `net.Connection` does
the handshake automatically and emits the `ready` event when the handshaking
is complete.

To close the connection use `connection.close()`.


## Exchange

Events: `'declared'`

### `connection.exchange()`
### `connection.exchange(name, options={})`

An exchange can be created using `connection.exchange()`. The method returns
an `amqp.Exchange` object. 

Without any arguments, this method returns the default exchange `amq.topic`.
Otherwise a string, `name`, is given as the first argument and an `options`
object for the second. The options are

- `type`: the type of exchange `'direct'`, `'fanout'`, or `'topic'` (default).
- `passive`: boolean, default false.
    If set, the server will not create the exchange.  The client can use
    this to check whether an exchange exists without modifying the server
    state.
- `durable`: boolean, default false.
    If set when creating a new exchange, the exchange will be marked as
    durable.  Durable exchanges remain active when a server restarts.
    Non-durable exchanges (transient exchanges) are purged if/when a
    server restarts.
- `autoDelete`: boolean, default true.
    If set, the exchange is deleted when all queues have finished using
    it.

An exchange will emit the `'open'` event when it is finally declared.


### `exchange.publish(routingKey, message, options)`

Publishes a message to the exchange. The `routingKey` argument is a string
which helps routing in `topic` and `direct` exchanges. The `message` can be
either a Buffer or Object. A Buffer is used for sending raw bytes; an Object
is convereted to JSON.

`options` is an object with any of the following

- `mandatory`: boolean, default false.
    This flag tells the server how to react if the message cannot be
    routed to a queue.  If this flag is set, the server will return an
    unroutable message with a Return method.  If this flag is zero, the
    server silently drops the message.
- `immediate`: boolean, default false.
    This flag tells the server how to react if the message cannot be
    routed to a queue consumer immediately.  If this flag is set, the
    server will return an undeliverable message with a Return method.
    If this flag is zero, the server will queue the message, but with
    no guarantee that it will ever be consumed.
- `contentType`: default 'application/octet-stream'
- `contentEncoding`: default null.
- `headers`: default `{}`.
- `deliveryMode`: Non-persistent (1) or persistent (2)
- `priority`: The message priority, 0 to 9.


### `exchange.destroy(ifUnused = true)`

Deletes an exchange. 
If the optional boolean second argument is set, the server will only
delete the exchange if it has no queue bindings. If the exchange has queue
bindings the server does not delete it but raises a channel exception
instead.


## Queue

### `connection.queue(name, options)`

Returns a reference to a queue. The options are

- `passive`: boolean, default false.
    If set, the server will not create the queue.  The client can use
    this to check whether a queue exists without modifying the server
    state.
- `durable`: boolean, default false.
    Durable queues remain active when a server restarts.
    Non-durable queues (transient queues) are purged if/when a
    server restarts.  Note that durable queues do not necessarily
    hold persistent messages, although it does not make sense to
    send persistent messages to a transient queue.
- `exclusive`: boolean, default false.
    Exclusive queues may only be consumed from by the current connection.
    Setting the 'exclusive' flag always implies 'auto-delete'.
- `autoDelete`: boolean, default true.
    If set, the queue is deleted when all consumers have finished
    using it. Last consumer can be cancelled either explicitly or because
    its channel is closed. If there was no consumer ever on the queue, it
    won't be deleted.

When a queue has been declared it will emit an `'open'` event. The `'open'`
event receives two arguments `(messageCount, consumerCount)`, which specify 
the state of the recently-declared queue.



### `queue.subscribe(listener, options)`

### `queue.subscribeJSON(listener, options)`

### `queue.bind(exchange, routing)`

This method binds a queue to an exchange.  Until a queue is
bound it will not receive any messages.

### `queue.delete(options)`

Delete the queue. Without options, the queue will be deleted even if it has
pending messages or attached consumers. If +options.ifUnused+ is true, then 
the queue will only be deleted if there are no consumers. If
+options.ifEmpty+ is true, the queue will only be deleted if it has no
messages.

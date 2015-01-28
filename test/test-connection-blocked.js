var harness = require('./harness');
var sys = require('sys');
var exec = require('child_process').exec;

if (typeof(options.clientProperties) === 'undefined') {
  options.clientProperties = {};
}
if (typeof(options.clientProperties.capabilities) === 'undefined') {
  options.clientProperties.capabilities = {};
}
options.clientProperties.capabilities['connection.blocked'] = true;

var connection = harness.run();
var exchange;

var blockedCnt = 0;
var unblockedCnt = 0;
var errorWhenBlocked = false;

var finishTimeout = setTimeout(function() {
    //console.log('!!!fired!!!');
    connection.end();
}, 10000);

connection.once('ready', function() {
    exchange = connection.exchange('node-connection-blocked', {
        autoDelete: true
    }, function(exchange) {
        exec('rabbitmqctl set_vm_memory_high_watermark 0', function(err, stdout, stderr) {
            exchange.publish("", "hello");
        });
    });
});

connection.on('blocked', function() {
    //console.log('!blocked');
    blockedCnt++;

    exchange.publish("", "hello", {}, function(isErr, err) {
        if (isErr && err) {
            errorWhenBlocked = true;
        }
        exec('rabbitmqctl set_vm_memory_high_watermark 0.4');
    });
});

connection.on('unblocked', function() {
    //console.log('!unblocked');

    unblockedCnt++;
    clearTimeout(finishTimeout);
    connection.end();
});

process.addListener('exit', function() {
    exec('rabbitmqctl set_vm_memory_high_watermark 0.4');

    assert.equal(1, blockedCnt);
    assert.equal(1, unblockedCnt);
    assert.equal(true, errorWhenBlocked);
});

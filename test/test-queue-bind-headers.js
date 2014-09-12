require('./harness').run();
var testName = __filename.replace(__dirname+'/','').replace('.js','');
var recvCount = 0;
connection.addListener('ready', function () {
    puts("connected to " + connection.serverProperties.product);
    
    connection.exchange('node.'+testName+'.exchange', {type: 'headers'}, function(exchange) {
        connection.queue( 'node.'+testName+'.queue', { durable: false, autoDelete : true },  function (queue) {
            puts("Queue ready");
            // main test for callback
            queue.bind_headers(exchange, {headerOne: "one", headerTwo: "two"});
            queue.subscribe(function(message){
                puts("Message from queue");
                recvCount+=1;
            });

            exchange.publish('', {body: "body"}, {headers: {headerOne: "one", headerTwo: "two"}});
            exchange.publish('', {body: "body"}, {headers: {headerOne: "two", headerTwo: "one"}});
            setTimeout(function() {
                puts("Destroying connection");
                connection.destroy();
            }, 500);
        });
    });
});

process.addListener('exit', function () {
    puts("Checking assertion of message received");
    assert.equal(1, recvCount);
});

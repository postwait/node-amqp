require('./harness').run();
var testName = __filename.replace(__dirname+'/','').replace('.js','');
var recvCount = 0;
connection.addListener('ready', function () {
    puts("connected to " + connection.serverProperties.product);
    
    connection.exchange('node.'+testName+'.exchange', {type: 'headers'}, function(exchange) {
        connection.queue( 'node.'+testName+'.queueref', { durable: false, autoDelete : true },  function (queueref) {
          queueref.bind_headers(exchange, {headerOne: "one", headerTwo: "two"});
          connection.queue( 'node.'+testName+'.queue', { durable: false, autoDelete : true },  function (queue) {
            puts("Queue ready");
            // main test for callback
            queue.bind_headers(exchange, {headerOne: "one", headerTwo: "two"});
            queue.subscribe(function(message){
                puts("Message from queue");
                recvCount+=1;
            });

            exchange.publish('', {body: "body"}, {headers: {headerOne: "one", headerTwo: "two"}});
            exchange.publish('', {body: "body"}, {headers: {headerOne: "one", headerTwo: "two"}});
            queue.unbind_headers(exchange, {headerOne: "one", headerTwo: "two"});
            exchange.publish('', {body: "body"}, {headers: {headerOne: "one", headerTwo: "two"}});

            setTimeout(function() {
              puts("Destroying connection");
                  connection.destroy();
              }, 1000);
          });
       });
    });
});

process.addListener('exit', function () {
    puts("Checking assertion of message received");
    assert.equal(2, recvCount);
});

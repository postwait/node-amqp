require('./harness');
var testName = __filename.replace(__dirname+'/','').replace('.js','');
var msgsReceived = 0;
connection.addListener('ready', function () {
    puts("connected to " + connection.serverProperties.product);
    var callbackCalled = false;
    
    connection.exchange('node.'+testName+'.dstExchange', {type: 'topic'}, function(dstExchange) {
        connection.exchange('node.'+testName+'.srcExchange', {type: 'topic'}, function(srcExchange) {
            dstExchange.bind(srcExchange, '#', function () {
              connection.queue( 'node.'+testName+'.nestedExchangeQueue', { durable: false, autoDelete : true },  function (queue) {
                  queue.bind(dstExchange, '#', function () {
                      queue.subscribe(function ( msg ) {
                          puts(msg.data.toString());
                          msgsReceived++;
                      });
                      srcExchange.publish('node.'+testName+'.nestedExchangeTest', 
                          'Queue received message from non-directly-bound exchange.');
                      dstExchange.unbind(srcExchange,'#', function () {
                        srcExchange.publish('node.'+testName+'.nestedExchangeTest', 
                          'You should NOT see this.');
                      });
                      setTimeout(function () {
                          // wait one second to receive the message, then quit
                          queue.destroy();
                          dstExchange.destroy();
                          srcExchange.destroy();
                          connection.end();
                        }, 1000);
                  });
              });
            });
        });
    });
});

process.addListener('exit', function() {
  assert.equal(1, msgsReceived);
});
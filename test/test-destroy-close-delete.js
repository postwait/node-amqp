require('./harness');
var assert = require('assert');

connection.on('ready', function(){
    var exchange1 = connection.exchange('test-exchange-1');
    var exchange2 = connection.exchange('test-exchange-2');
    
    var queue = connection.queue('test-queue');

    assert.equal(4, Object.keys(connection.channels).length);
    
    messages = 0
    
    function subscribe(queue){
        queue.subscribe(function(message){
            console.log('message ' + queue.name)
            messages[queue] = messages[queue] + 1;
        });
    }
    
    function bind(queue){
        queue.bind(exchange2, '')
    }


    exchange1.on('close', function(){
        delete connection.exchanges[exchange1.name]
        delete connection.channels[exchange1.channel]
        assert.equal('closed', exchange1.state)
        
        assert.equal(3, Object.keys(connection.channels).length)
        exchange2.publish('','test3')
        exchange2.destroy()
        exchange2.close()
    })
    
    exchange2.on('close', function(){
        delete connection.exchanges[exchange2.name]
        delete connection.channels[exchange2.channel]
        assert.equal('closed', exchange2.state)
        
        assert.equal(2, Object.keys(connection.channels).length)
        assert.equal("3", Object.keys(connection.channels)[1])
        assert.equal(2, messages)
        connection.destroy()
    })

    queue.bind(exchange2, '')
    
    queue.subscribe(function(message){
        messages++
    }).addCallback(function(){
        exchange1.publish('','test1')
        exchange2.publish('','test2')
        exchange1.destroy()
        exchange1.close()
        assert.equal('closing', exchange1.state)
    })

})

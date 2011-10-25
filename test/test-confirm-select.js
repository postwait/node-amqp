require('./harness');

var fire, fired = false;

connection.addListener('ready', function () {
	connection.exchange('node-simple-fanout', {
		type: 'fanout'
	},
	function(exchange) {
		var promise = exchange.confirm();

		promise.addCallback(function() {

			var promise = exchange.publish("", "hello");
			promise.addCallback(function(){
				fired = true;
				followup();
			});

		});

	});
});

function followup() {
	clearTimeout(fire);
	assert.ok(fired);
	connection.end();
}
fire = setTimeout(function() {
	followup();
}, 5000);

sys = require('sys');
amqp = require('../amqp');

var name = process.argv[2];
sys.puts("exchange: " + name);

var creds =
  { host:     process.env['AMQP_HOST']      || 'localhost'
  , login:    process.env['AMQP_LOGIN']     || 'guest'
  , password: process.env['AMQP_PASSWORD']  || 'guest'
  , vhost:    process.env['AMQP_VHOST']     || '/'
  };

connection = amqp.createConnection(creds);

connection.addListener('error', function (e) {
  throw e;
});

connection.addListener('ready', function () {
  sys.puts("Connected");
  var e = connection.exchange(name);
  e.destroy().addCallback(function () {
    sys.puts('exchange destroyed.');
    connection.close();
  });
});


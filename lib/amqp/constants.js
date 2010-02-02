var sys = require('sys');
var constants = require('./constants-generated');
process.mixin(exports, constants)

constants.Connection.Open[4] = 'shortstr' // xml-spec says "bit", PDF/rabbit say shortstr
constants.Basic.Consume.pop()             // rabbit doesn't like the table bit on the end

// reorganize the constants for look up.
var methods = {};
for (var className in constants) {
  if (!constants.hasOwnProperty(className)) continue;
  for (var methodName in constants[className]) {
    if (!constants[className].hasOwnProperty(methodName)) continue;
    var info = constants[className][methodName];
    var classId = parseInt(info[0]);
    var methodId = parseInt(info[1]);
    var params = info.slice(2);

    if (!methods[classId]) methods[classId] = {};

    methods[classId][methodId] = { className: className
                                 , methodName: methodName
                                 , params: params
                                 };
  }
}
exports.methods = methods;

constants.Channel.All = 0;

exports.frameMethod = 1; // TODO extract me from xml
exports.frameEnd = 206; // TODO extract me from xml

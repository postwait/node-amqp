process.mixin(exports, require('./constants-generated'))

exports.Channel.All = 0;
exports.Connection.Open[4] = 'shortstr' // xml-spec says "bit", PDF/rabbit say shortstr
exports.Basic.Consume.pop()             // rabbit doesn't like the table bit on the end

// reorganize the constants for look up.
var methods = {};
for (var className in constants) {
  if (!constants.hasOwnProperty(className)) continue;
  for (var methodName in constants[className]) {
    if (!constants[className].hasOwnProperty(methodName)) continue;
    var info = constants[className][methodName];
    var classId = info[0];
    var methodId = info[1];
    var params = info.slice(2);

    if (!methods[classId]) methods[classId] = {};

    methods[classId][methodId] = { className: className
                                 , methodName: methodName
                                 , params: params
                                 };
  }
}
exports.methods = methods;

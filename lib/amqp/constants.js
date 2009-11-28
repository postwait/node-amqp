process.mixin(exports, require('./constants-generated'))

exports.Channel.All = 0;
exports.Connection.Open[4] = 'shortstr' // xml-spec says "bit", PDF/rabbit say shortstr
exports.Basic.Consume.pop()             // rabbit doesn't like the table bit on the end

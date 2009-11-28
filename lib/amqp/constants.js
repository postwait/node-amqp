exports.Connection = {
  Start:   [10, 10],
  StartOk: [10, 11, 'table', 'shortstr', 'table', 'shortstr'],
  Tune:    [10, 30],
  TuneOk:  [10, 31, 'short', 'long', 'short'],
  Open:    [10, 40, 'shortstr', 'shortstr', 'octet'], // TODO: Last is actually a bit
  OpenOk:  [10, 41]
}

exports.Channel = {
  All: 0,
  Open:   [20, 10, 'shortstr'],
  OpenOk: [20, 11, 'longstr']
}

exports.Queue = {
  Declare: [50, 10, 'short', 'shortstr', 'octet', 'table'], // TODO: 3rd is actually 5 bits
  DeclareOk: [50, 11, 'shortstr', 'long', 'long'],
  Bind: [50, 20, 'short', 'shortstr', 'shortstr', 'short', 'table'],
  BindOk: [50, 21]
}

exports.Basic = {
  Consume: [60, 20, 'short', 'shortstr', 'shortstr', 'octet'],
  ConsumeOk: [60, 21],
  Deliver: [60, 60]
}

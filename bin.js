#!/usr/bin/env node

var cmd = process.argv[2]
var fs = require('fs')

process.argv.splice(2, 1)

if (cmd === 'seed') require('./bin/seed')
else if (cmd === 'create') require('./bin/create')
else if (cmd === 'run' || cmd === 'boot') require('./bin/boot')
else if (cmd === 'destroy') require('./bin/destroy')
else if (cmd === 'tracker') require('./bin/tracker')
else console.log(fs.readFileSync(__dirname+'/help.txt', 'utf-8'))
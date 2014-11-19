#!/usr/bin/env node

var cmd = process.argv[2]

process.argv.splice(2, 1)

if (cmd === 'seed') require('./bin/seed')
else if (cmd === 'create') require('./bin/create')
else if (cmd === 'run' || cmd === 'boot') require('./bin/run')
else console.error('Usage: docker-instant [cmd] [opts]')
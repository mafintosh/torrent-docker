#!/usr/bin/env node

var minimist = require('minimist')
var tracker = require('bittorrent-tracker/server')
var fs = require('fs')

var argv = minimist(process.argv.slice(2))

if (argv.help) {
  console.error(fs.readFileSync(__dirname+'/../docs/tracker.txt', 'utf-8'))
  process.exit(1)
}

var server = tracker()

server.on('warning', function (err) {
  // client sent bad data. probably not a problem, just a buggy client.
  console.log(err.message)
})

server.on('listening', function (port) {
  console.log('tracker server is now listening on ' + port)
})

// listen for individual tracker messages from peers:

server.on('start', function (addr) {
  console.log('got start message from ' + addr)
})

server.on('complete', function (addr) {
  console.log('got complete message from '+addr)
})

server.on('update', function (addr) {
  console.log('got update message from '+addr)
})

server.on('stop', function (addr) {
  console.log('got stop message from '+addr)
})

// start tracker server listening!
server.listen(argv.port || 80)

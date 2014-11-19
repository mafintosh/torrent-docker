#!/usr/bin/env node

var torrents = require('torrent-stream')
var pretty = require('pretty-bytes')
var path = require('path')
var mkdirp = require('mkdirp')
var fs = require('fs')

var torrent = process.argv[2] 
if (!torrent) {
  console.error('Usage: seed [torrent]')
  process.exit(1)
}

var engine = torrents(fs.readFileSync(torrent), {
  path: path.dirname(torrent)
})

engine.swarm.add('127.0.0.1:51413')

var peers = 0

engine.on('peer', function(peer) {
  peers++
})

engine.files.forEach(function(f) {
  f.select()
})

engine.listen()
console.log('seeding on port %d', engine.port)
setInterval(function() {
  console.log('connected to %d peers. found %d in total. upload: %s', engine.swarm.wires.length, peers, pretty(engine.swarm.uploadSpeed()))
}, 1000)
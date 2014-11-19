#!/usr/bin/env node

var torrents = require('torrent-stream')
var filesystem = require('./filesystem')
var path = require('path')
var mkdirp = require('mkdirp')
var fs = require('fs')

var torrent = process.argv[2] 
if (!torrent) {
  console.error('Usage: seed-torrent [torrent]')
  process.exit(1)
}

var engine = torrents(fs.readFileSync(torrent), {
  path: path.dirname(torrent)
})

engine.swarm.add('127.0.0.1:51413')
engine.on('peer', function(peer) {
  console.log(peer)
})

engine.files.forEach(function(f) {
  f.select()
})

engine.listen()
console.log('seeding on port %d', engine.port)
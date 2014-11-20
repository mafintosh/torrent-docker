#!/usr/bin/env node

var torrents = require('torrent-stream')
var pretty = require('pretty-bytes')
var path = require('path')
var mkdirp = require('mkdirp')
var fs = require('fs')
var minimist = require('minimist')

var argv = minimist(process.argv.slice(2), {alias:{peer:'p', tracker:'t', nomount:'n'}})
var trackers = argv.t && [].concat(argv.t)

var torrent = argv._[0]
if (!torrent || argv.help) {
  console.error(fs.readFileSync(__dirname+'/../docs/seed.txt', 'utf-8'))
  process.exit(1)
}

var engine = torrents(fs.readFileSync(torrent), {
  path: path.dirname(torrent),
  trackers: trackers
})

var peers = [].concat(argv.peer || [])
peers.forEach(function(p) {
  engine.swarm.add(p)
})

var peers = 0

engine.on('peer', function(peer) {
  peers++
})

engine.files.forEach(function(f) {
  f.select()
})

engine.listen(function() {
  console.log('seeding on port %d', engine.port)
  setInterval(function() {
    console.log('connected to %d peers. found %d in total. upload: %s', engine.swarm.wires.length, peers, pretty(engine.swarm.uploadSpeed()))
  }, 1000)
})
#!/usr/bin/env node

var torrents = require('torrent-stream')
var filesystem = require('../filesystem')
var mkdirp = require('mkdirp')
var fs = require('fs')
var pretty = require('pretty-bytes')
var proc = require('child_process')
var freeport = require('freeport')
var net = require('net')
var minimist = require('minimist')

var argv = minimist(process.argv.slice(2), {alias:{peer:'p', tracker:'t'}})
var trackers = argv.t && [].concat(argv.t)

var torrent = argv._[0]
if (!torrent) {
  console.error('Usage: run [torrent]')
  process.exit(1)
}

var engine = torrents(fs.readFileSync(torrent), {trackers:trackers})
var container = process.argv[3] || Math.random().toString(16).slice(2)
var mnt = container+'/mnt'
var data = container+'/data'

engine.swarm.add('128.199.33.21:6881') // TODO: remove me

var peers = [].concat(argv.peer || [])
peers.forEach(function(p) {
  engine.swarm.add(p)
})

engine.on('peer', function(peer) {
//  console.log(peer)
})

engine.files.forEach(function(f) {
  f.select()
})

freeport(function(err, port) {
  if (err) return
  engine.listen(port)
  console.log('engine is listening on port %d', port)
})

mkdirp.sync(mnt)
container = fs.realpathSync(container)

var sockets = []
var server = net.createServer(function(socket) {
  sockets.push(socket)
  socket.on('error', socket.destroy)
  socket.on('close', function() {
    var i = sockets.indexOf(socket)
    if (i > -1) sockets.splice(i, 1)
  })
})

var log = function() {
  var msg = require('util').format.apply(null, arguments)
  sockets.forEach(function(s) {
    s.write(msg+'\n')
  })
}

setInterval(function() {
  log('down: %s/s, up: %s/s, peers: %d', pretty(engine.swarm.downloadSpeed()), pretty(engine.swarm.uploadSpeed()), engine.swarm.wires.length)
}, 1000)

server.listen(10000)
server.once('error', function() {
  freeport(function(err, port) {
    if (err) throw err
    server.listen(port)
  })
})

server.on('listening', function() {
  console.log('access log server by doing: nc localhost %d', server.address().port)
  console.log('loading index...')
  filesystem(mnt, data, {
    createImageStream: function(opts) {
      return engine.files[0].createReadStream(opts)
    },
    createIndexStream: function() {
      return engine.files[1].createReadStream()
    },
    log: log,
    uid: process.getuid(),
    gid: process.getgid(),
    readable: true
  }, function(err, fs) {
    if (err) throw err
    if (argv.docker === false) return console.log('torrent mounted. go to: '+container+'/mnt')
    console.log('index loaded. booting vm...')
    fs.readdir('/', function(err, files) {
      if (err) throw err

      files = files
        .filter(function(file) {
          return file !== '.' && file !== '..' && file !== 'proc' && file !== 'dev'
        })
        .map(function(file) {
          return '-v '+container+'/mnt/'+file+':/'+file+' '
        })
        .join('').trim().split(/\s+/)

      proc.spawn('docker', ['run', '--net=host', '-it', '--rm', '--entrypoint=/bin/bash'].concat(files).concat('scratch'), {stdio:'inherit'}).on('exit', function() {
        process.exit()
      })
    })
  })
})

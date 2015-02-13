#!/usr/bin/env node

var torrents = require('torrent-stream')
var filesystem = require('../filesystem')
var mkdirp = require('mkdirp')
var fs = require('fs')
var pretty = require('pretty-bytes')
var proc = require('child_process')
var net = require('net')
var minimist = require('minimist')

var argv = minimist(process.argv.slice(2), {alias:{peer:'p', tracker:'t', nomount:'n'}})
var trackers = argv.t && [].concat(argv.t)

var torrent = argv._[0]
var container = argv._[1]

if (!torrent || !container || argv.help) {
  console.error(fs.readFileSync(__dirname+'/../docs/boot.txt', 'utf-8'))
  process.exit(1)
}

var noMount = [].concat(argv.nomount || [])
var engine = torrents(fs.readFileSync(torrent), {trackers:trackers})
var mnt = container+'/mnt'
var data = container+'/data'

// TODO: remove me - this is the address of registry.mathiasbuus.eu - incase i forget for me demo
// engine.swarm.add('128.199.33.21:6881')

var peers = [].concat(argv.peer || [])
peers.forEach(function(p) {
  engine.swarm.add(p)
})

// engine.on('peer', function(peer) {
//   console.log(peer)
// })

engine.files.forEach(function(f) {
  f.select()
})

engine.listen(function() {
  console.log('engine is listening on port %d', engine.port)
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
  console.log('mounting container drive here: '+container+'/mnt')
  if (noMount.length) console.log('not mounting: '+noMount.join(' '))
  console.log('access log server by doing: nc localhost %d', server.address().port)
  console.log('downloading filesystem index...')
  filesystem(mnt, data, {
    createImageStream: function(opts) {
      return engine.files[0].createReadStream(opts)
    },
    createIndexStream: function() {
      return engine.files[1].createReadStream()
    },
    log: log,
    uid: argv.uid !== undefined ? Number(argv.uid) : process.getuid(),
    gid: argv.gid !== undefined ? Number(argv.gid) : process.getgid()
  }, function(err, fs) {
    if (err) throw err
    if (argv.docker === false) return console.log('torrent mounted...')
    console.log('filesystem index loaded. booting vm...')  
    fs.readdir('/', function(err, files) {
      if (err) throw err

      files = files
        .filter(function(file) {
          return file !== '.' && file !== '..' && file !== 'proc' && file !== 'dev' && noMount.indexOf(file) === -1
        })
        .map(function(file) {
          return '-v '+container+'/mnt/'+file+':/'+file+' '
        })
        .join('').trim().split(/\s+/)

      var vars = [].concat(argv.e || []).concat(argv.env || [])
      var env = []

      vars.forEach(function(v) {
        env.push('-e', v)
      })

      var spawn = function() {
        proc.spawn('docker', ['run', '--net', argv.net || 'bridge', '-it', '--rm', '--entrypoint=/bin/bash'].concat(env).concat(files).concat('scratch'), {stdio:'inherit'}).on('exit', function() {
          process.exit()
        })        
      }

      var ns = new Buffer('nameserver 8.8.8.8\nnameserver 8.8.4.4\n')
      fs.open('/etc/resolv.conf', 1, function(err, fd) {
        if (err < 0) return spawn()
        fs.write('/etc/resolv.conf', 0, ns.length, ns, fd, function(err) {
          if (err < 0) return spawn()
          fs.release('/etc/resolv.conf', fd, spawn)
        })
      })
    })
  })
})

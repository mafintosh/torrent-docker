var tar = require('tar-stream')
var tarfs = require('tar-fs')
var lexint = require('lexicographic-integer')
var pump = require('pump')
var zlib = require('zlib')
var through = require('through2')
var duplexify = require('duplexify')
var level = require('level')
var fs = require('fs')

// fs.createReadStream('image.tar', {
//   start: 32857088,
//   end: 32857088+140-1
// }).pipe(process.stdout)

var toIndexKey = function(name) {
  var depth = name.split('/').length-1
  return lexint.pack(depth, 'hex')+name
}

var index = function() {
  var e = tar.extract()
  var output = through.obj()

  e.on('entry', function(header, stream, cb) {
    header.name = ('/' + header.name).replace('//', '/').replace(/(.)\/$/, '$1')
    stream.resume()

    var entry = {
      key: toIndexKey(header.name),
      valueEncoding: 'json',
      value: {
        name: header.name,
        mode: header.mode,
        type: header.type,
        start: stream.offset,
        size: header.size,
        linkname: header.linkname     
      }
    }

    output.write(entry, cb)
  })

  return duplexify.obj(e, output)
}

var tgz = function() {
  tarfs.pack('image.db').pipe(zlib.createGzip()).pipe(fs.createWriteStream('image.db.tgz'))
}

// return tgz()

var db = level('image.db')
var save = function(db, filename, cb) {
  pump(
    fs.createReadStream(filename),
    index(),
    db.createWriteStream(),
    cb
  )
}

// save(db, 'image.tar')
// return

require('./filesystem')('mnt', 'container', {
  createImageStream: function(opts) {
    return fs.createReadStream('image.tar', opts)
  },
  createIndexStream: function() {
    return fs.createReadStream('image.db.tgz')
  },
  log: function(type) {
    console.log.apply(console, arguments)
  },
  uid: process.getuid(),
  gid: process.getgid(),
  readable: true
})

// save('image.tar', function() {
//   console.log('done!')
// })

// db.createReadStream().on('data', console.log)

return

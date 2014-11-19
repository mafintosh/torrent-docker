#!/usr/bin/env node

var docker = require('docker-remote-api')
var zlib = require('zlib')
var level = require('level')
var mkdirp = require('mkdirp')
var rimraf = require('rimraf')
var fs = require('fs')
var lexint = require('lexicographic-integer')
var tar = require('tar-stream')
var tarfs = require('tar-fs')
var createTorrent = require('create-torrent')

var image = process.argv[2]

if (!image) {
  console.error('Usage: create-torrent [image]')
  process.exit(1)
}

var request = docker()

var getImage = function(cb) {
  request.post('/containers/create', {
    json: {
      Image: image
    }
  }, function(err, c) {
    if (err) return cb(err)

    request.get('/containers/'+c.Id+'/export', function(err, stream) {
      if (err) return cb(err)

      stream.on('end', function() {
        request.del('/containers/'+c.Id)
      })

      cb(null, stream, c.Id)
    })
  })
}

var dir = image.replace(/\//g, '-')

var toIndexKey = function(name) {
  var depth = name.split('/').length-1
  return lexint.pack(depth, 'hex')+name
}

console.log('creating a torrent for %s', image)

getImage(function(err, stream, id) {
  if (err) throw err

  console.log('exporting docker image layer')
  mkdirp(dir, function(err) {
    if (err) throw err
    stream.pipe(fs.createWriteStream(dir+'/image.tar')).on('finish', function() {
      console.log('indexing image layer')

      var db = level(dir+'/index')

      fs.createReadStream(dir+'/image.tar').pipe(tar.extract())
        .on('entry', function(header, stream, next) {
          header.name = ('/' + header.name).replace('//', '/').replace(/(.)\/$/, '$1')
          stream.resume()

          var entry = {
            key: toIndexKey(header.name),
            value: {
              name: header.name,
              mode: header.mode,
              type: header.type,
              start: stream.offset,
              size: header.size,
              linkname: header.linkname     
            }
          }

          db.put(entry.key, entry.value, {valueEncoding:'json'}, next)
        })
        .on('finish', function() {
          tarfs.pack(dir+'/index').pipe(zlib.createGzip()).pipe(fs.createWriteStream(dir+'/index.tgz')).on('finish', function() {
            rimraf(dir+'/index', function() {
              console.log('generating torrent file')
              createTorrent(dir, function(err, buf) {
                if (err) throw err
                fs.writeFile(dir+'.torrent', buf, function(err) {
                  if (err) throw err
                  console.log('torrent created and written to '+dir+'.torrent')
                })
              })
            })
          })
        })
    })
  })
})
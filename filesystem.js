var f4js = require('fuse4js')
var fs = require('fs')
var collect = require('stream-collector')
var p = require('path')
var os = require('os')
var pump = require('pump')
var cuid = require('cuid')
var mkdirp = require('mkdirp')
var lexint = require('lexicographic-integer')
var level = require('level')
var tar = require('tar-fs')
var zlib = require('zlib')
var shasum = require('shasum')
var umount = require('./umount')
var stream = require('stream')

var ENOENT = -2
var EPERM = -1
var EINVAL = -22

var toIndexKey = function(name) {
  var depth = name.split('/').length-1
  return lexint.pack(depth, 'hex')+name
}

var empty = function() {
  var p = new stream.PassThrough()
  p.end()
  return p
}

module.exports = function(mnt, container, opts, cb) {
  if (typeof opts === 'function') return module.exports(mnt, container, null, opts)
  if (!opts) opts = {}

  var dmode = 0
  var fmode = 0
  var log = opts.log || function() {}

  if (opts.readable) {
    dmode |= 0555
    fmode |= 0444
  }
  if (opts.writable) {
    dmode |= 0333
    fmode |= 0222
  }

  var handlers = {}
  var store = container

  var createImageStream = opts.createImageStream || empty
  var createIndexStream = opts.createIndexStream || empty

  var createReadStream = function(entry, offset) {
    var end = entry.start + entry.size - 1
    return createImageStream({start:entry.start+offset, end:end})
  }

  var ready = function() {
    var db = level(p.join(store, 'db'))

    var get = function(path, cb) {
      if (path === '/') return cb(null, {name:'/', mode: 0755, type:'directory'})

      db.get(toIndexKey(path), {valueEncoding:'json'}, function(err, entry) {
        if (err) return cb(err)
        if (entry.type === 'symlink') return get(p.resolve(p.dirname(path), entry.linkname), cb)
        if (!entry.layer) return cb(null, entry)
        fs.stat(entry.layer, function(err, stat) {
          entry.size = stat ? stat.size : 0
          cb(null, entry)
        })
      })      
    }

    handlers.getattr = function(path, cb) {
      log('getattr', path)

      get(path, function(err, entry) {
        if (err) return cb(ENOENT)

        var stat = {}

        if (opts.uid !== undefined) stat.uid = opts.uid
        if (opts.gid !== undefined) stat.gid = opts.gid

        if (entry.type === 'file') {
          stat.size = entry.size
          stat.mode = 0100000 | entry.mode | fmode
          return cb(0, stat)
        }

        stat.size = 4096
        stat.mode = 040000 | entry.mode | dmode

        return cb(0, stat)
      })
    }

    handlers.readdir = function(path, cb) {
      log('readdir', path)

      if (!/\/$/.test(path)) path += '/'

      var prefix = toIndexKey(path)
      var rs = db.createReadStream({
        gte: prefix,
        lt: prefix+'\xff',
        valueEncoding: 'json'
      })

      collect(rs, function(err, entries) {
        if (err) return cb(ENOENT)

        var files = entries.map(function(entry) {
          return p.basename(entry.value.name)
        })

        cb(0, files)
      })
    }

    var files = []

    var toFlag = function(flags) {
      if (flags === 0) return 'r'
      if (flags === 1) return 'w'
      return 'r+'
    }

    var open = function(path, flags, cb) {
      var push = function(data) {
        var list = files[path] = files[path] || [true, true, true] // fd > 3
        var fd = list.indexOf(null)
        if (fd === -1) fd = list.length
        list[fd] = data
        cb(0, fd)        
      }

      get(path, function(err, entry) {
        if (err) return cb(ENOENT)
        if (entry.type !== 'file') return cb(EINVAL)

        if (!entry.layer) return push({offset:0, entry:entry})

        fs.open(entry.layer, toFlag(flags), function(err, fd) {
          if (err) return cb(EPERM)
          push({fd:fd, entry:entry})
        })
      })
    }

    var copyOnWrite = function(path, mode, upsert, cb) {
      log('copy-on-write', path)

      var target = p.join(store, 'layer', shasum(path))

      var done = function(entry) {
        db.put(toIndexKey(entry.name), entry, {valueEncoding:'json'}, function(err) {
          if (err) return cb(EPERM)
          cb(0)
        })
      }

      var create = function() {
        var entry = {name:path, size:0, type:'file', mode:mode, layer:target}
        fs.writeFile(target, '', function(err) {
          if (err) return cb(EPERM)
          done(entry)
        })
      }

      get(path, function(err, entry) {
        if (entry && entry.layer) return cb(0)

        if (!entry && upsert) return create()
        if (!entry) return cb(ENOENT)

        entry.layer = target
        if (mode) entry.mode = mode

        pump(createReadStream(entry, 0), fs.createWriteStream(target), function(err) {
          if (err) return cb(EPERM)
          done(entry)
        })
      })      
    }

    handlers.open = function(path, flags, cb) {
      log('open', path, flags)

      if (flags === 0) return open(path, flags, cb)
      copyOnWrite(path, 0, false, function(err) {
        if (err) return cb(err)
        open(path, flags, cb)
      })
    }

    handlers.release = function(path, handle, cb) {
      log('release', path, handle)

      var list = files[path] || []
      var file = list[handle]
      if (!file) return cb(ENOENT)

      if (file.stream) file.stream.destroy()
      list[handle] = null
      if (!list.length) delete files[path]

      if (file.fd === undefined) return cb(0)

      fs.close(file.fd, function(err) {
        if (err) return cb(EPERM)
        cb(0)
      })
    }

    handlers.read = function(path, offset, len, buf, handle, cb) {
      log('read', path, offset, len, handle)

      var list = files[path] || []
      var file = list[handle]
      if (!file) return cb(ENOENT)

      if (len + offset > file.entry.size) len = file.entry.size - offset;

      if (file.fd !== undefined) {
        fs.read(file.fd, buf, 0, len, offset, function(err, bytes) {
          if (err) return cb(EPERM)
          cb(bytes)
        })
        return
      }

      if (file.stream && file.offset !== offset) {
        file.stream.destroy()
        file.stream = null
      }

      if (!file.stream) {
        file.stream = createReadStream(file.entry, offset)
        file.offset = offset
      }

      var loop = function() {
        var result = file.stream.read(len)
        if (!result) return file.stream.once('readable', loop)
        file.offset += len
        result.copy(buf)
        cb(result.length)
      }

      loop()
    }

    handlers.truncate = function(path, size, cb) {
      log('truncate', path, size)

      copyOnWrite(path, 0, false, function(err) {
        if (err) return cb(err)
        get(path, function(err, entry) {
          if (err || !entry.layer) return cb(EPERM)
          fs.truncate(entry.layer, size, function(err) {
            if (err) return cb(EPERM)
            cb(0)
          })
        })
      })
    }

    handlers.write = function(path, offset, len, buf, handle, cb) {
      log('write', path, offset, len, handle)

      var list = files[path] || []
      var file = list[handle]
      if (!file) return cb(ENOENT)
      if (file.fd === undefined) {
        return cb(EPERM)
      }

      fs.write(file.fd, buf, 0, len, offset, function(err, bytes) {
        if (err) return cb(EPERM)
        cb(bytes)
      })
    }

    handlers.unlink = function(path, cb) {
      log('unlink', path)

      get(path, function(err, entry) {
        if (!entry) return cb(ENOENT)
        db.del(toIndexKey(path), function() {
          if (!entry.layer) return cb(0)
          fs.unlink(p.join(store, 'layer', entry.layer), function() {
            cb(0)
          })
        })
      })
    }

    handlers.rename = function(src, dst, cb) {
      log('rename', src, dst)

      copyOnWrite(src, 0, false, function(err) {
        if (err) return cb(err)
        get(src, function(err, entry) {
          if (err || !entry.layer) return cb(EPERM)
          var batch = [{type:'del', key:toIndexKey(entry.name)}, {type:'put', key:toIndexKey(dst), valueEncoding:'json', value:entry}]
          entry.name = dst
          db.batch(batch, function(err) {
            if (err) return cb(EPERM)
            cb(0)
          })
        })
      })
    }

    handlers.mkdir = function(path, mode, cb) {
      log('mkdir', path)

      db.put(toIndexKey(path), {name:path, mode:mode, type:'directory', size:0}, {valueEncoding:'json'}, function(err) {
        if (err) return cb(EPERM)
        cb(0)
      })
    }

    handlers.rmdir = function(path, cb) {
      log('rmdir', path)

      handlers.readdir(path, function(err, list) {
        if (err) return cb(EPERM)
        if (list.length) return cb(EPERM)
        handlers.unlink(path, cb)
      })
    }

    handlers.chown = function() {
      console.error('chown is not implemented')
    }

    handlers.chmod = function(path, mode, cb) {
      log('chmod', path, mode)

      get(path, function(err, entry) {
        if (err) return cb(err)
        entry.mode = mode
        db.put(toIndexKey(path), entry, {valueEncoding:'json'}, function(err) {
          if (err) return cb(EPERM)
          cb(0)
        })
      })
    }

    handlers.create = function(path, mode, cb) {
      log('create', path, mode)

      copyOnWrite(path, mode, true, function(err) {
        if (err) return cb(err)
        open(path, 1, cb)
      })      
    }

    handlers.getxattr = function(path, cb) {
      log('getxattr')

      cb(EPERM)
    }

    handlers.setxattr = function(path, name, value, size, a, b, cb) {
      log('setxattr')

      cb(0)
    }

    handlers.statfs = function(cb) {
      cb(0, {
        bsize: 1000000,
        frsize: 1000000,
        blocks: 1000000,
        bfree: 1000000,
        bavail: 1000000,
        files: 1000000,
        ffree: 1000000,
        favail: 1000000,
        fsid: 1000000,
        flag: 1000000,
        namemax: 1000000
      })
    }

    handlers.destroy = function(cb) {
      cb()
    }

    f4js.start(mnt, handlers, false, [])
    if (cb) cb(null, handlers) 
  }

  fs.exists(p.join(store, 'db'), function(exists) {
    if (exists) return umount(mnt, ready)

    mkdirp(p.join(store, 'layer'), function() {
      pump(
        createIndexStream(),
        zlib.createGunzip(),
        tar.extract(p.join(store, 'db')),
        function() {
          umount(mnt, ready)
        }
      )
    })    
  })
}
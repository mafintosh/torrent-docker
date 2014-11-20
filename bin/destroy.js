#!/usr/bin/env node

var umount = require('../umount')
var rimraf = require('rimraf')
var fs = require('fs')

var name = process.argv[2]
if (!name || process.argv.indexOf('--destroy') > -1) {
  console.error(fs.readFileSync(__dirname+'/../docs/destroy.txt', 'utf-8'))
  process.exit(0)
}

umount(name+'/mnt', function() {
  rimraf.sync(name)
})
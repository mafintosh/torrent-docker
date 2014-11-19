#!/usr/bin/env node

var umount = require('../umount')
var rimraf = require('rimraf')

var name = process.argv[2]
if (!name) {
  console.error('Usage: destroy [container]')
  process.exit(0)
}

umount(name+'/mnt', function() {
  rimraf.sync(name)
})
#!/usr/bin/env node

var umount = require('../umount')
var rimraf = require('rimraf')
var fs = require('fs')
var minimist = require('minimist')

var argv = minimist(process.argv.slice(2))
var name = argv._[0]

if (!name || argv.help) {
  console.error(fs.readFileSync(__dirname+'/../docs/destroy.txt', 'utf-8'))
  process.exit(0)
}

umount(name+'/mnt', function() {
  rimraf.sync(name)
})
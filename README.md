# docker-instant

MAD SCIENCE realtime boot of remote docker images using bittorrent

```
npm install -g docker-instant
docker-instant --help
```

## HOLD ON TO YOUR BRAIN

Docker images are HUGE. A simple `hello world` node app easily takes up `> 600MB` space.
Downloading/uploading these images can a looong time.

To fix this `docker-instant` implements a union file system that allows you to mount a docker image
shared using bittorrent and boot a container - all in realtime!

![whoa](http://i.imgur.com/rfFWukr.gif)

## Usage

### Seed a docker image

First create a docker image

```
FROM ubuntu:14.04
RUN apt-get update && apt-get install -qy curl vim
```

Then build it

```
docker build -t test-image
```

Now all we need to do is create a torrent from the docker image

```
docker-instant create test-image
```

This creates a file `test-image.torrent` and a data folder `test-image/`.
Share this torrent using your favorite torrent client or do

```
docker-instant seed test-image.torrent # will print a activity log
```

### Realtime boot the docker image

Now copy `test-image.torrent` to another machine.
To boot the image do

```
docker-instant boot test-image.torrent my-container
```

This will mount the torrent as a union file system (that is writable!) and boot the docker image.
In addition it will also seed the torrent which means the more containers you boot the more the torrent will be seeded.

You can attach to the debug log to see download speed, how many peers your are connected to, which files are being accessed etc using

```
nc localhost 10000 # will tail the debug log from the boot process
```

After a couple of seconds (depending on your internet connection, ymmw) you should be attached to a bash process
running in your image! If for some reason your boot process cannot find a seeder you can specify them doing

```
docker-instant boot test-image.torrent my-container --peer 128.199.33.21:6441
```

## Dependencies

On OSX you'll need the following

* boot2docker, https://github.com/boot2docker/boot2docker
* osx fuse, http://sourceforge.net/projects/osxfuse/files/latest/download?source=files
* pkg-config, `brew install pkg-config`

To make `/var`, `/etc` belong to root you need to run the following after installing boot2docker

```
boot2docker ssh
sudo umount /Users
sudo mount -t vboxsf Users /Users/
```

You need to run this everytime you boot boot2docker

## Troubleshooting

THIS IS HIGHLY EXPERIMENTAL.

Currently I have only tested this on OSX using OSX fuse and boot2docker.

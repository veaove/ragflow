#!/bin/bash
export PATH=/usr/local/go/bin:/usr/bin:/bin:/usr/sbin:/sbin
export GOTMPDIR=/root/tmp-go
mkdir -p /root/tmp-go
cd /root/ragflow
bash build.sh --test 2>&1

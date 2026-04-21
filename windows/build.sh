#!/bin/bash
#

node build-portable.js
cd build 
zip -r moonplayer-win.zip moonplayer-win
cd ..

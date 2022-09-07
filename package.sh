#!/bin/bash

set -o errexit # Exit on error
CWD=$(pwd)
BUILD_PATH_LAYERS=$CWD/layers
cd $CWD

# Package typescript code
npm install --prefer-offline --platform=linux --arch=x64
npm run build

# Package node_modules
mkdir -p $BUILD_PATH_LAYERS
cp $CWD/package.json $BUILD_PATH_LAYERS/package.json

cd $BUILD_PATH_LAYERS
echo "installing production only dependencies"
npm install --production --prefer-offline --platform=linux --arch=x64

echo "exiting to root directory"
cd $CWD

echo "build Dockerfile"
docker build . -t 016437323894.dkr.ecr.us-east-1.amazonaws.com/dev-image-resizer:latest --platform=linux/amd64
docker push 016437323894.dkr.ecr.us-east-1.amazonaws.com/dev-image-resizer:latest

echo "Done."
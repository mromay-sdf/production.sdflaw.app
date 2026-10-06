#!/bin/sh
set -eu
# Keep app assets in wwwroot while installing runtime packages on local disk.
# Installing thousands of dependency files on the shared /home mount is slow.
app_root=/home/site/wwwroot
runtime_root=/tmp/sdf-production-runtime
mkdir -p "$runtime_root"
cp "$app_root/package.json" "$app_root/package-lock.json" "$runtime_root/"
cp -R "$app_root/dist-server" "$runtime_root/"
cd "$runtime_root"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund --cache /tmp/sdf-npm-cache
cd "$app_root"
exec node "$runtime_root/dist-server/index.js"

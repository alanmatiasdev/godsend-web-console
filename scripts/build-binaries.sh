#!/usr/bin/env bash
set -euo pipefail

upstream="$(realpath "${1:?usage: build-binaries.sh UPSTREAM TAG OUTPUT}")"
tag="${2:?usage: build-binaries.sh UPSTREAM TAG OUTPUT}"
output="$(realpath -m "${3:?usage: build-binaries.sh UPSTREAM TAG OUTPUT}")"
mkdir -p "$output"

test -f "$upstream/src/server/interfaces/http/webui/index.html"
cd "$upstream/src/server"

for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do
  goos="${target%/*}"
  goarch="${target#*/}"
  name="godsend-${tag}-${goos}-${goarch}"
  staging="$(mktemp -d)"
  mkdir "$staging/$name"
  cp "$upstream/LICENSE" "$staging/$name/LICENSE-GODSend-360"
  binary=godsend
  if [[ "$goos" == windows ]]; then binary=godsend.exe; fi
  echo "Building $target"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build -trimpath -ldflags='-s -w' -o "$staging/$name/$binary" .
  if [[ "$goos" == linux ]]; then
    mkdir -p "$output/bin/linux-$goarch"
    cp "$staging/$name/$binary" "$output/bin/linux-$goarch/godsend"
  fi
  if [[ "$goos" == windows ]]; then
    (cd "$staging" && zip -q -r "$output/$name.zip" "$name")
  else
    tar czf "$output/$name.tar.gz" -C "$staging" "$name"
  fi
  rm -rf "$staging"
done

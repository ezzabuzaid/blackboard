#!/bin/sh
set -eu

image=self-delegate-agent-browser:0.26.0-r4
archive=$(mktemp "${TMPDIR:-/tmp}/self-delegate-agent-browser.XXXXXX")
trap 'rm -f "$archive"' EXIT

docker buildx build \
  --tag "$image" \
  --output "type=oci,dest=$archive" \
  "$(dirname "$0")"
msb image load --input "$archive" --tag "$image"

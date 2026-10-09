#!/usr/bin/env bash
set -euo pipefail

if [ "$(jq -r '.private // false' package.json)" = "true" ]; then
  echo "Skipping private package"
  exit 0
fi

name="$(jq -er '.name' package.json)"
version="$(jq -er '.version' package.json)"
pack_dir="$(mktemp -d)"
prepared=false

cleanup() {
  local status=$?
  if [ "$prepared" = "true" ] && [ -f node_modules/.package.dev.json ]; then
    bun run publish-manifest postpack || status=$?
  fi
  rm -rf "$pack_dir"
  exit "$status"
}

trap cleanup EXIT

if npm view "$name@$version" version --json >"$pack_dir/version.json" 2>"$pack_dir/error.json"; then
  echo "Skipping $name@$version: already published"
  exit 0
fi

registry_error="$(jq -r '.error.code // empty' "$pack_dir/error.json" 2>/dev/null || true)"
if [ -z "$registry_error" ]; then
  registry_error="$(jq -r '.error.code // empty' "$pack_dir/version.json" 2>/dev/null || true)"
fi

if [ "$registry_error" != "E404" ]; then
  cat "$pack_dir/version.json" "$pack_dir/error.json" >&2
  echo "Cannot determine whether $name@$version is published" >&2
  exit 1
fi

echo "Publishing $name@$version"
if [ -f node_modules/.package.dev.json ]; then
  echo "A package manifest preparation is already active" >&2
  exit 1
fi

prepared=true
bun run publish-manifest prepack
bun pm pack --ignore-scripts --filename "$pack_dir/package.tgz"
bun run publish-manifest postpack
npm publish "$pack_dir/package.tgz" --access public

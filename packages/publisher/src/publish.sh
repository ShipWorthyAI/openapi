#!/usr/bin/env bash
# Publishes every public workspace package whose current version is not on npm.
# Bun packs and resolves `workspace:` and `catalog:` specifiers; npm publishes
# the tarballs using local login credentials or GitHub Actions trusted publishing.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../.."

pack_dir="$(mktemp -d)"
trap 'rm -rf "$pack_dir"' EXIT

for manifest in packages/*/package.json; do
  if [ "$(jq -r '.private // false' "$manifest")" = "true" ]; then
    continue
  fi

  name="$(jq -r '.name' "$manifest")"
  version="$(jq -r '.version' "$manifest")"

  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "Skipping $name@$version: already published"
    continue
  fi

  echo "Publishing $name@$version"
  (
    cd "$(dirname "$manifest")"
    bun pm pack --filename "$pack_dir/package.tgz"
    npm publish "$pack_dir/package.tgz" --access public
  )
done

bun x changeset git-tag

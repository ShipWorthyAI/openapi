#!/usr/bin/env bash
# Publishes every public workspace package whose current version is not on npm.
# `bun publish` replaces `workspace:` and `catalog:` specifiers with real versions,
# which `changeset publish` (npm) does not.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../.."

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
  (cd "$(dirname "$manifest")" && bun publish --access public)
done

bun x changeset git-tag

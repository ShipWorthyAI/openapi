# @shipworthy/publisher

Private workspace tooling for packing and publishing this repository's packages. Requires Bun, Bash, jq, and npm.

Run `bun run release` from the repository root to publish public packages whose versions are not yet on npm and create Changesets git tags. The release task is never cached.

Packages use `@shipworthy/publisher` as a workspace dev dependency and call its manifest command from their packing hooks:

```json
{
  "scripts": {
    "prepack": "bun run build && bun run publish-manifest prepack",
    "postpack": "bun run publish-manifest postpack"
  },
  "devDependencies": {
    "@shipworthy/publisher": "workspace:*"
  }
}
```

`publish-manifest` operates on the current directory's `package.json`. `prepack` backs up the development manifest in `node_modules/.package.dev.json` and promotes compiled entries from `publishConfig`; `postpack` restores the original manifest.

# @shipworthy/publisher

Private workspace tooling for packing and publishing this repository's packages. Requires Bun, Bash, jq, Node.js 24, and npm 11.5.1 or later.

Run `bun run release` from the repository root to publish public packages whose versions are not yet on npm and create Changesets git tags. The release task is never cached.

The release script packs each package with `bun pm pack`, preserving the packing hooks and resolving `workspace:` and `catalog:` dependency versions. It publishes the temporary tarball with `npm publish --access public` and removes the tarballs when the script exits.

## Initial local release

With an npm account that can publish under the `@shipworthy` scope, run these commands from the repository root:

```sh
npm login
bun run --cwd packages/publisher release
```

Run the publisher directly for this local release so npm can use the terminal for any required two-factor authentication. npm uses your local login credentials. The initial release creates the packages on npm so their trusted publishers can be configured.

## GitHub Actions trusted publishing

After the initial release, configure a GitHub Actions trusted publisher in **Settings → Trusted publishing** for every public package, including `@shipworthy/typescript-config`:

- Organization or user: `ShipWorthyAI`
- Repository: `openapi`
- Workflow filename: `release.yml`
- Environment name: leave blank (the workflow does not use a GitHub environment)
- Allowed actions: allow direct publishing with `npm publish`

The release workflow uses a GitHub-hosted runner, Node.js 24, and `id-token: write`. Turbo passes the OIDC request variables and GitHub context to the release task so npm can authenticate and generate provenance. No `NPM_TOKEN` repository secret is required.

New trusted publisher configurations must complete a successful publish within two days. Merge a Changesets version PR to publish a new version; the workflow can also be started manually after setup. Already published versions are skipped, so validating trust requires an unpublished version of each package.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Packing hooks

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

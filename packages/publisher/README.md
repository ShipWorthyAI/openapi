# @shipworthy/publisher

Private workspace commands for packing and verifying release artifacts. Requires Bun, tar,
Node.js 24, and npm 11.5.1 or later. Install workspace dependencies and run commands from the
repository root.

## Prepare artifacts

Complete checks and builds, then pack and verify:

```sh
bun run check
bun run build
bun run release:pack
bun run release:verify
```

`release-artifacts pack` discovers unpublished versions through Changesets and writes tarballs
and a Changesets-compatible `publish-plan.json` to `.release`. The command preserves source
manifests and refuses to overwrite an existing output directory. Builds must already be complete.

To use a saved Changesets plan or a different output directory:

```sh
bun run release-artifacts pack --from-publish-plan ./plan.json --out-dir ./release-artifacts
bun run release-artifacts verify ./release-artifacts
```

Private packages, unknown packages, duplicate releases, and versions differing from the
workspace manifests are rejected. Changesets dependency groups, npm access, dist-tags, and
tag-only entries are preserved.

## Verify artifacts

`release-artifacts verify` checks archive digests, manifests, resolved dependency ranges,
compiled entry points, declarations, and executables. It installs the tarballs in an isolated
npm consumer with lifecycle scripts disabled, imports JavaScript entry points and schema
subpaths, type-checks their declarations, and runs CLI help commands. Consumer verification
requires registry access. Successful verification creates `verified.json` in the artifact directory.

Before publication, verify the saved result and archive digests without installing a consumer:

```sh
bun run release-artifacts verify ./release-artifacts --integrity-only
```

A missing verification marker, changed plan, changed tarball, or failed consumer check fails
with a nonzero exit code. A failed full verification removes any previous verification marker.

## Publish and retry

The repository's `bun run release` command checks `.release` integrity and delegates publication
to Changesets. For a custom verified directory:

```sh
bun run release-artifacts verify ./release-artifacts --integrity-only
bun run changeset publish --from-pack-dir ./release-artifacts
```

Reuse saved tarballs for retries. Changesets handles versions already published and creates
Git tags for successful releases. The GitHub Actions v2 publish action consumes structured
Changesets output to push tags and create GitHub releases. See
[CONTRIBUTING.md](../../CONTRIBUTING.md#releasing) for the complete contributor workflow.

## Authentication

npm uses local login credentials or GitHub Actions trusted publishing. Use `npm login` for an
initial local release. npm supports interactive two-factor authentication and `NPM_CONFIG_OTP`.

Configure a GitHub Actions trusted publisher for each public package:

- Organization or user: `ShipWorthyAI`
- Repository: `openapi`
- Workflow filename: `release.yml`
- Environment name: leave blank.
- Allowed actions: allow direct publishing with `npm publish`.

Only the publish job requires `id-token: write`. No `NPM_TOKEN` secret is required. A newly
created trusted publisher must complete its first successful publish within two days; otherwise
it expires and must be recreated. Packing, integrity checks, and already-published versions do
not validate a new trusted publisher.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

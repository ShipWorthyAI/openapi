# @shipworthy/publisher

Private workspace commands for preparing package manifests and publishing Bun tarballs.
Requires Bun, Bash, jq, Node.js 24, and npm 11.5.1 or later.

## Installation

Declare the workspace tool as a development dependency:

```json
{
  "devDependencies": {
    "@shipworthy/publisher": "workspace:*"
  }
}
```

## Commands

Run commands from the directory containing the target package's `package.json`.

### `publish-manifest prepack`

Prepares the manifest using the package's `publishConfig` entries. An already active
preparation fails. Configure the compiled `main`, `types`, `exports`, and `bin` entries in
`publishConfig`; registry options such as `access` and `registry` remain there.

### `publish-manifest postpack`

Restores the original manifest. It has no effect if no preparation is active.

### `publish-package`

Publishes the current public package's version. Its build must already be complete.
The command skips private packages and versions already present on npm. Registry errors,
packing errors, and publish errors fail with a nonzero exit code. The original manifest is
restored after packing, including when packing fails.

```sh
bun run build
bun run --cwd packages/openapi-cli release
```

For the repository-wide release command and contributor workflow, see
[CONTRIBUTING.md](../../CONTRIBUTING.md#releasing).

## Authentication

npm uses its configured local login credentials or GitHub Actions trusted publishing.
Run `npm login` for a local release. For two-factor authentication through Turbo, provide
`NPM_CONFIG_OTP`; direct package release commands allow npm to use the terminal interactively.

For GitHub Actions, configure a trusted publisher for each public package:

- Organization or user: `ShipWorthyAI`
- Repository: `openapi`
- Workflow filename: `release.yml`
- Environment name: leave blank.
- Allowed actions: allow direct publishing with `npm publish`.

The workflow requires a GitHub-hosted runner, Node.js 24, and `id-token: write`. The release
configuration passes the OIDC request variables, GitHub context, and npm configuration to npm.
No `NPM_TOKEN` repository secret is required. Already published versions are skipped, so
validating a new trusted publisher requires an unpublished version.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

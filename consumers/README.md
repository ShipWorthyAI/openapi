# Release consumers

Each directory is a small npm project that `release-artifacts verify` installs against the packed
tarballs. Dependencies named after a released package resolve to its tarball; everything else comes
from the registry using the project's own `.npmrc`. Verification then runs the project's `verify`
script.

| Consumer                | Covers                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commonjs-typescript-5` | React Native style apps: CommonJS, TypeScript 5.0 pinned by an npm override (`NodeNext` and `bundler`), TanStack Query 5.59, `legacy-peer-deps`. |
| `esm-typescript-7`      | ESM apps on TypeScript 7 with `bundler` resolution and the current TanStack Query.                                                               |

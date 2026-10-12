# Example: CommonJS app on TypeScript 5.0

A React Native style app: CommonJS, TypeScript 5.0 pinned by an npm override, TanStack Query 5.59,
and npm's `legacy-peer-deps`. Its `verify` script generates a TanStack Query client with the
`openapi` CLI, type-checks it with `NodeNext` and `bundler` resolution, and calls the CommonJS build.

`release-artifacts verify` installs this example with npm against the packed tarballs and runs
`verify`.

# @shipworthy/openapi

OpenAPI tooling for TypeScript: bundle, overlay, and lint API documents, generate types and runtime
validators, and build typed Fetch and TanStack Query clients.

Accepts OpenAPI 3.0 and 3.1 documents in JSON or YAML, including external `$ref`s. The generation
pipeline bundles references and upgrades OpenAPI 3.0 documents to 3.1 before generating code.

## Quick start

Install the CLI and the TypeScript generator in your project:

```sh
bun add -d @shipworthy/openapi-cli @shipworthy/openapi-typescript
```

Lint your API document and generate TypeScript types:

```sh
bunx --bun @shipworthy/openapi-cli lint ./openapi.yaml
bunx --bun @shipworthy/openapi-cli generate typescript -i ./openapi.yaml -o ./src/generated
```

The generated `src/generated/types.ts` exports `paths`, `components`, and `operations` types. Use them directly in
your application, or with [`@shipworthy/openapi-fetch`](./packages/openapi-fetch/README.md) for
typed HTTP requests.

The CLI requires Node.js **22.19.0 or later**, or Bun. Packages ship ESM JavaScript and TypeScript
declarations. Install only the generators you need; see the
[CLI documentation](./packages/openapi-cli/README.md) for bundling, other generators, and their
dependencies.

## Packages

Each package's README includes installation instructions, examples, and API documentation.

### Code generation and clients

| Package                                                                               | Use it to                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`@shipworthy/openapi-cli`](./packages/openapi-cli/README.md)                         | Bundle, overlay, lint, and generate code from the command line.                 |
| [`@shipworthy/openapi-typescript`](./packages/openapi-typescript/README.md)           | Generate TypeScript types for paths, operations, and components.                |
| [`@shipworthy/openapi-standard-schema`](./packages/openapi-standard-schema/README.md) | Generate Standard Schema validators backed by Effect Schema.                    |
| [`@shipworthy/openapi-zod`](./packages/openapi-zod/README.md)                         | Generate Zod 4 runtime validators.                                              |
| [`@shipworthy/openapi-tanstack-query`](./packages/openapi-tanstack-query/README.md)   | Generate operation-based query options, keys, and mutations for TanStack Query. |
| [`@shipworthy/openapi-react-query`](./packages/openapi-react-query/README.md)         | Use path-based React hooks with an API client provider.                         |
| [`@shipworthy/openapi-fetch`](./packages/openapi-fetch/README.md)                     | Make typed HTTP requests using generated `paths` types.                         |

### Programmatic tooling

The parsing and generation APIs use Effect 4. The pipeline parses an OpenAPI document, transforms
it into a shared `ParsedService` model, then passes that model to a generator plugin.

| Package                                                                       | Use it to                                                               |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`@shipworthy/openapi-overlay`](./packages/openapi-overlay/README.md)         | Apply OpenAPI Overlay 1.0 and 1.1 documents with Effect.                |
| [`@shipworthy/openapi-parser`](./packages/openapi-parser/README.md)           | Load, bundle, upgrade, and validate OpenAPI documents.                  |
| [`@shipworthy/openapi-transformer`](./packages/openapi-transformer/README.md) | Convert a bundled OpenAPI document into the `ParsedService` HTTP model. |
| [`@shipworthy/openapi-generator`](./packages/openapi-generator/README.md)     | Run generator plugins from code or write your own.                      |
| [`@shipworthy/openapi-validator`](./packages/openapi-validator/README.md)     | Lint API documents with Spectral.                                       |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, checks, example generation, and the
release workflow.

## Acknowledgments

- [`@shipworthy/openapi-transformer`](./packages/openapi-transformer/README.md) was inspired by [@stoplightio/http-spec](https://github.com/stoplightio/http-spec).
- [`@shipworthy/openapi-tanstack-query`](./packages/openapi-tanstack-query/README.md) was inspired by [@orpc/tanstack-query](https://github.com/middleapi/orpc).
- [`@shipworthy/openapi-typescript`](./packages/openapi-typescript/README.md) was inspired by [openapi-typescript](https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-typescript).
- [`@shipworthy/openapi-fetch`](./packages/openapi-fetch/README.md) was inspired by [openapi-fetch](https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-fetch).

## License

MIT. See [LICENSE](./LICENSE).

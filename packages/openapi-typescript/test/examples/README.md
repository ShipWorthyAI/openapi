# openapi-typescript examples

Each directory is one API. `schema.yaml` (or `schema.json`, or `schema/` for a multi-file spec) is the OpenAPI document. Each variant directory is the TypeScript that variant's flags produce. `manifest.ts` is the list of schemas and flags.

These examples show the generation from an OpenAPI schema to its associated types. None of the example schemas here are associated with this project, and all code are © their respective owners.

| Example            | Generated types                        | Source                                                                                                                | License                                                                    |
| :----------------- | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| `digital-ocean`    | `digital-ocean/default/types.ts`       | [GitHub](https://github.com/digitalocean/openapi)                                                                     | [Apache 2.0](https://github.com/digitalocean/openapi/blob/main/LICENSE)    |
| `github`           | `github/default/types.ts` and variants | [GitHub](https://github.com/github/rest-api-description/tree/main/descriptions/api.github.com)                        | [MIT](https://github.com/github/rest-api-description/blob/main/LICENSE.md) |
| `github-next`      | `github-next/default/types.ts`         | [GitHub](https://github.com/github/rest-api-description/tree/main/descriptions-next/api.github.com)                   | [MIT](https://github.com/github/rest-api-description/blob/main/LICENSE.md) |
| `octokit-ghes-3.6` | `octokit-ghes-3.6/default/types.ts`    | [GitHub](https://github.com/octokit/octokit-next.js/tree/main/packages/types-openapi-ghes-3.6-diff-to-api.github.com) | [MIT](https://github.com/octokit/octokit-next.js/blob/main/LICENSE)        |
| `stripe`           | `stripe/default/types.ts`              | [GitHub](https://github.com/stripe/openapi)                                                                           | [MIT](https://github.com/stripe/openapi/blob/master/LICENSE)               |

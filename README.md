# @shipworthy/openapi

Libraries for parsing OpenAPI documents, generating TypeScript types and runtime validators, and building typed API clients.

The generator, fetch client, and supporting helpers are based on [openapi-typescript](https://github.com/openapi-ts/openapi-typescript).

## Parsing and transformation

The generation pipeline has three stages:

1. **Parse:** `@shipworthy/openapi-parser` bundles and validates an OpenAPI document, producing `ParsedOpenApi`. OpenAPI 3.1 objects are defined with Effect v4 schemas, and their TypeScript types are inferred from those schemas.
2. **Transform:** `@shipworthy/openapi-transformer` converts the prepared document into `ParsedService`, the shared HTTP meta model.
3. **Generate:** Generator plugins consume `ParsedService` to produce TypeScript types, runtime validators, and other output.

## Parse JSON or YAML

`ParsedOpenApiFromString` parses JSON or YAML, bundles external references, upgrades OpenAPI 3.0 to 3.1, and validates the result. Compose it with `ParsedServiceFromParsedOpenApi` to obtain the HTTP meta model:

```ts
import { OpenApiSource, ParsedOpenApiFromString } from "@shipworthy/openapi-parser";
import { ParsedServiceFromParsedOpenApi } from "@shipworthy/openapi-transformer";
import { Effect, Schema } from "effect";

const serviceFromString = ParsedOpenApiFromString.pipe(
  Schema.decodeTo(ParsedServiceFromParsedOpenApi),
);

const parseService = (text: string, sourceUrl: string) =>
  Schema.decodeUnknownEffect(serviceFromString)(text).pipe(
    Effect.provideService(OpenApiSource, sourceUrl),
  );
```

Set `OpenApiSource` to the root document's URL or absolute file path so relative references resolve correctly. `parseService` returns an Effect; provide Effect's filesystem and HTTP client services when running it.

For a file URL or an existing document object, use `loadDocument` followed by `bundleDocument`. Object input is processed directly, without serialization.

## Validation and encoding

Validation and transformation failures are reported as `SchemaError`. The OpenAPI schemas validate document structure. Embedded JSON Schemas are checked only for an object or boolean shape; their keywords are not validated.

The parser preserves the distinction between omitted fields and explicit empty arrays so the transformer can apply inheritance correctly.

- **`ParsedOpenApiFromString`:** Encoding produces the prepared document as JSON. It does not restore the original file layout or YAML formatting.
- **`ParsedServiceFromParsedOpenApi`:** Encoding is forbidden; conversion to the HTTP meta model is one-way.

# @shipworthy/openapi

OpenAPI libraries for Shipworthy: schema-to-TypeScript generation, Zod validators, a typed fetch client, and helpers for consuming those types.

The generator, fetch client, and helpers were rebuilt from [openapi-typescript](https://github.com/openapi-ts/openapi-typescript).

`@shipworthy/openapi-parser` defines the OpenAPI 3.1 objects as Effect v4 schemas, with their
TypeScript types inferred from those schemas. `ParsedOpenApiFromString` accepts JSON or YAML,
bundles external references, upgrades OpenAPI 3.0, and validates the resulting `ParsedOpenApi`.
Provide `OpenApiSource` with the root document's URL or absolute file path so relative references
resolve against the right source, along with Effect filesystem and HTTP services for external files.

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

For file URLs or object input, use `loadDocument` followed by `bundleDocument`; object input is
not serialized. The transformer converts prepared documents into `ParsedService`;
generators consume that meta model. Malformed structural fields and failed transformations are
reported through `SchemaError`, while embedded JSON Schemas retain their object/boolean values
and keywords. Omitted fields remain omitted so inheritance can distinguish them from explicit
empty arrays.

Encoding `ParsedOpenApiFromString` writes the prepared document as JSON. It does not restore the
original files or YAML formatting. Encoding `ParsedServiceFromParsedOpenApi` is forbidden.

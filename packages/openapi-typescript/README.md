# @shipworthy/openapi-typescript

Generate TypeScript types from OpenAPI 3.0 and 3.1 documents. The package is a generator plugin
for the `@shipworthy/*` OpenAPI toolchain. It takes a parsed document (`ParsedService` from
`@shipworthy/openapi-transformer`) and returns TypeScript AST nodes for `paths`, `webhooks`,
`components`, `$defs`, and `operations`. It emits types only and adds no runtime code. Use it to
get compile-time types for an API, either directly or through the `openapi generate typescript`
CLI command from `@shipworthy/openapi-cli`. The output follows the shape of
[openapi-typescript](https://github.com/openapi-ts/openapi-typescript), which this package is
based on. `@shipworthy/openapi-tanstack-query` uses these types for its generated `types.ts`.

## Installation

```sh
npm install -D @shipworthy/openapi-typescript @shipworthy/openapi-cli typescript@^7 effect
pnpm add -D @shipworthy/openapi-typescript @shipworthy/openapi-cli typescript@^7 effect
yarn add -D @shipworthy/openapi-typescript @shipworthy/openapi-cli typescript@^7 effect
bun add -d @shipworthy/openapi-typescript @shipworthy/openapi-cli typescript@^7 effect
```

Install `@shipworthy/openapi-cli` only if you use the CLI. If you call the plugin from code, also
install `@shipworthy/openapi-transformer`.

Requirements:

| Requirement       | Detail                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peer dependencies | `typescript` `^7.0.0`: the generator builds its AST with the `typescript/unstable` API that ships with TypeScript 7. `effect` `^4.0.0`: install it yourself so every package shares one Effect instance. |
| Runtime           | Node.js `>=22.19.0`, or Bun. The package ships compiled JavaScript and `.d.ts` declarations in `dist/`, so no TypeScript loader or bundler is needed.                                                    |
| Module format     | ESM only (`"type": "module"`). There is no CommonJS build.                                                                                                                                               |
| Entry points      | `.` and `./compiler`.                                                                                                                                                                                    |
| CLI runtime       | The `openapi` binary from `@shipworthy/openapi-cli` runs on Node.js (`npx openapi ...`) or Bun (`bunx openapi ...`).                                                                                     |
| Bundled deps      | `oxfmt` ^0.72.0 (used by `formatTypeScript`).                                                                                                                                                            |

## Quick start

### CLI

```sh
openapi generate typescript ./openapi.yaml -o ./src/api/schema.ts
```

Then use the generated types:

```ts
import type { components, operations, paths } from "./api/schema";

type Pet = components["schemas"]["Pet"];
type GetPetResponse = operations["getPet"]["responses"][200]["content"]["application/json"];
type GetPetPath = paths["/pets/{id}"]["get"]["parameters"]["path"];
```

### Programmatic

This script was run against the current code. `decode` expects an OpenAPI 3.1 object with no
external `$ref`s. For files, URLs, or 3.0 documents, see
[Generating from a file, URL, or 3.0 document](#generating-from-a-file-url-or-30-document).

```ts
import { decode } from "@shipworthy/openapi-transformer";
import { astToString, formatTypeScript, typescript } from "@shipworthy/openapi-typescript";
import { Effect } from "effect";

const document = {
  openapi: "3.1.0",
  info: { title: "Pets", version: "1.0.0" },
  paths: {
    "/pets/{id}": {
      get: {
        operationId: "getPet",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "200": {
            description: "A pet",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Pet" } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          tag: { type: "string", enum: ["dog", "cat"] },
        },
      },
    },
  },
};

const program = Effect.gen(function* () {
  const model = yield* decode(document);
  const nodes = yield* typescript.generate(model, { alphabetize: true });
  // Print each top-level declaration separately so they are separated by blank lines.
  return nodes.map((node) => astToString([node])).join("\n");
});

const source = await Effect.runPromise(program);
console.log(await formatTypeScript(source));
```

Output:

```ts
export interface paths {
  "/pets/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getPet"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}

export type webhooks = Record<string, never>;

export interface components {
  schemas: {
    Pet: {
      id: number;
      name: string;
      /** @enum {string} */
      tag?: "dog" | "cat";
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}

export type $defs = Record<string, never>;

export interface operations {
  getPet: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description A pet */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Pet"];
        };
      };
    };
  };
}
```

## CLI: `openapi generate typescript`

This command comes from `@shipworthy/openapi-cli`. It loads this package by name, so install both.

```
openapi generate typescript [flags] [<input>]
```

| Argument / flag  | Description                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<input>`        | OpenAPI file (JSON or YAML) or URL. If you omit it, the command reads the schema from stdin.                                                                  |
| `--output`, `-o` | Output file. Parent directories are created. If you omit it, output goes to stdout and the plugin's warnings are silenced (`silent: true`).                   |
| `--check`        | Do not write. Compare the generated output with the existing `--output` file and exit with status 1 and `Generated types are not up-to-date!` if they differ. |

Every other flag maps to a [plugin option](#options) with the same name in kebab-case. All
flags are booleans:

`--enum`, `--enum-values`, `--conditional-enums`, `--dedupe-enums`, `--export-type` (`-t`),
`--immutable`, `--additional-properties`, `--empty-objects-unknown`, `--default-non-nullable`
(on by default; turn it off with `--default-non-nullable=false` or `--no-default-non-nullable`),
`--properties-required-by-default`, `--array-length`, `--path-params-as-types`, `--alphabetize`,
`--exclude-deprecated`, `--root-types`, `--root-types-no-schema-prefix`,
`--root-types-keep-casing`, `--make-paths-enum`, `--read-write-markers`,
`--generate-path-params`.

The CLI formats the output with `formatTypeScript` and adds a header:

```ts
/**
 * This file was auto-generated by @shipworthy/openapi-typescript.
 * Do not make direct changes to the file.
 *
 * @shipworthy/openapi-typescript@0.0.1:<sha256 of the schema contents>
 */
```

Examples:

```sh
# Write to a file
openapi generate typescript ./openapi.yaml -o ./src/api/schema.ts

# Read from stdin and write to stdout
cat openapi.json | openapi generate typescript > schema.ts

# Fail CI when the committed types are out of date
openapi generate typescript ./openapi.yaml -o ./src/api/schema.ts --check

# Readonly types, root-level aliases, and real enums
openapi generate typescript ./openapi.yaml -o schema.ts --immutable --root-types --enum
```

The CLI warns if you pass `--root-types-no-schema-prefix` or `--root-types-keep-casing` without
`--root-types`.

## API

### Entry point `@shipworthy/openapi-typescript`

#### `typescript`

```ts
const typescript: Generator<ts.Node[], TypegenError>;
// {
//   id: "typescript";
//   generate(model: ParsedService, options: Readonly<Record<string, unknown>>): Effect<ts.Node[], TypegenError>;
// }
```

This is the generator plugin. `Generator` comes from `@shipworthy/openapi-generator`.
`ParsedService` comes from `@shipworthy/openapi-transformer`.

- `model`: the decoded document.
- `options`: an object of [plugin options](#options). Missing booleans take their defaults.
  The object is validated, so a value of the wrong type (for example `{ alphabetize: "yes" }`)
  fails with a `TypegenError` whose message names the key (`Expected boolean at ["alphabetize"]`).
- Returns an `Effect` that succeeds with the top-level declarations in this order:
  1. The `$Read`/`$Write` helper types, if `readWriteMarkers` is set.
  2. The `inject` code, if `inject` is set.
  3. `paths`, `webhooks`, `components`, `$defs`, and any root type aliases (`rootTypes`).
  4. `operations` and any enums created by `enum`/`enumValues`, in the order they were
     generated. In practice, enums from component schemas come after `operations`.
  5. The `ApiPaths` enum, if `makePathsEnum` is set.
- Fails with `TypegenError` if the options are invalid, if a `$ref` is not a JSON Pointer, or if
  a `transform`, `postTransform`, or `transformProperty` hook throws. A hook's error message
  becomes the `TypegenError` message.

#### `astToString(ast, options?)`

```ts
function astToString(
  ast: ts.Node | ts.Node[] | ts.TypeElement | ts.TypeElement[],
  options?: {
    fileName?: string; // default "openapi-ts.ts"
    sourceText?: string; // default ""
    formatOptions?: ts.PrinterOptions; // { newLine?: number; removeComments?: boolean }
  },
): string;
```

This prints AST nodes as TypeScript source, using LF newlines and keeping comments by default.
The output is not formatted, so pass it to `formatTypeScript` for stable output. If you print
the whole array at once, the declarations are not separated by blank lines. If you want them
separated, print each node on its own as the quick start does.

#### `formatTypeScript(source)`

```ts
function formatTypeScript(source: string): Promise<string>;
```

This formats TypeScript source with `oxfmt` using `printWidth: 100` and makes sure the result
ends with a newline. If the formatter reports an error-severity diagnostic, it rejects with an
`Error` that carries that message.

#### `resolveRef(model, $ref, options)`

```ts
function resolveRef<T = unknown>(
  model: unknown,
  $ref: string,
  options: { silent?: boolean; visited?: string[] },
): T | undefined;
```

This follows a local JSON Pointer `$ref` (such as `"#/components/schemas/Pet"`) within `model`
and keeps following `$ref` chains. It returns `undefined` when the pointer is empty or the target
does not exist, and logs a warning unless `silent: true` is set. `visited` is used to detect
cycles, so callers normally pass `{}`.

```ts
resolveRef(model, "#/components/schemas/Pet", {}); // the Pet schema object
resolveRef(model, "#/components/schemas/Nope", { silent: true }); // undefined
```

#### `TypegenError`

```ts
class TypegenError extends Schema.TaggedError<TypegenError>()("TypegenError", {
  message: Schema.String,
}) {}
```

This is the only error type in the generator's error channel. `_tag` is `"TypegenError"`.

```ts
const result = await Effect.runPromise(
  typescript
    .generate(model, options)
    .pipe(Effect.catchTag("TypegenError", (error) => Effect.succeed(`failed: ${error.message}`))),
);
```

#### Types

- `OpenAPITSOptions`: the typed form of the [plugin options](#options).
- `TransformNodeOptions`: the second argument passed to the hooks:
  `{ path?: string; schema?: ParsedSchema; ctx: GlobalContext }`. `path` is the schema's JSON
  Pointer in the bundled document (for example `#/components/schemas/Pet`). `ctx` holds the
  resolved options and has a `resolve($ref)` helper.
- `TransformObject`: `{ schema: ts.TypeNode; questionToken: boolean }`. A `transform` hook can
  return this instead of a bare type node. `questionToken: true` makes the property optional.

### Entry point `@shipworthy/openapi-typescript/compiler`

The default export, `ts`, provides the part of the classic TypeScript compiler API that this
generator and its CLIs use. TypeScript 7 does not ship that API, so `ts` is built on
`typescript/unstable`. Use it to build nodes in `transform`, `postTransform`, and
`transformProperty` hooks.

```ts
import ts from "@shipworthy/openapi-typescript/compiler";

ts.factory.createTypeReferenceNode("Date");
ts.factory.createUnionTypeNode([
  ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
  ts.factory.createLiteralTypeNode(ts.factory.createNull()),
]);
```

Members of `ts`:

- `ts.factory`: `createArrayLiteralExpression`, `createArrayTypeNode`, `createEnumDeclaration`,
  `createEnumMember`, `createFalse`, `createIdentifier`, `createIndexedAccessTypeNode`,
  `createIndexSignature`, `createInterfaceDeclaration`, `createIntersectionTypeNode`,
  `createKeywordTypeNode`, `createLiteralTypeNode`, `createModifier`, `createNodeArray`,
  `createNull`, `createNumericLiteral`, `createParameterDeclaration`,
  `createPrefixUnaryExpression`, `createPropertySignature`, `createRestTypeNode`,
  `createStringLiteral`, `createToken`, `createTrue`, `createTupleTypeNode`,
  `createTypeAliasDeclaration`, `createTypeLiteralNode`, `createTypeOperatorNode`,
  `createTypeReferenceNode`, `createUnionTypeNode`, `createVariableDeclaration`,
  `createVariableDeclarationList`, `createVariableStatement`, `updatePropertySignature`.
- Guards: `isArrayTypeNode`, `isIdentifier`, `isIndexedAccessTypeNode`, `isInterfaceDeclaration`,
  `isLiteralTypeNode`, `isPropertySignature`, `isStringLiteral`, `isTupleTypeNode`,
  `isTypeAliasDeclaration`, `isTypeLiteralNode`, `isTypeNode`, `isTypeReferenceNode`.
- Utilities: `createPrinter(options?)` (returns `printFile` and `printNode`), `createSourceFile`,
  `addSyntheticLeadingComment`, `visitNode`, `visitEachChild`, and `transform`.
- Enums: `SyntaxKind`, `NodeFlags`, `ScriptKind`, `ScriptTarget`, and
  `NewLineKind` (`{ CarriageReturnLineFeed: 0, LineFeed: 1 }`).
- Types: `ts.Node`, `ts.TypeNode`, `ts.TypeElement`, `ts.TypeLiteralNode`,
  `ts.PropertySignature`, `ts.InterfaceDeclaration`, `ts.TypeAliasDeclaration`,
  `ts.EnumDeclaration`, `ts.EnumMember`, `ts.LiteralTypeNode`, `ts.QuestionToken`,
  `ts.Modifier`, `ts.Visitor`, and `ts.PrinterOptions`.

The module also has named exports for `NewLineKind` and the `PrinterOptions` and `Visitor`
types, and type-only re-exports of the AST node types listed above.

The signatures follow the classic `ts.factory` API, such as
`createPropertySignature(modifiers, name, questionToken, type)`, but this is a subset of that
API. Do not assume that a `ts.*` member not listed here exists.

## Options

You can pass these to `typescript.generate(model, options)`, through `pluginOptions` in
`@shipworthy/openapi-generator`, or, for the boolean options, as CLI flags.

| Option                        | Type     | Default | Effect                                                                                                                                                                                     |
| ----------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `additionalProperties`        | boolean  | `false` | Treat every object as if it had `additionalProperties: true`. This adds `& { [key: string]: unknown }`.                                                                                    |
| `alphabetize`                 | boolean  | `false` | Sort object keys alphabetically.                                                                                                                                                           |
| `arrayLength`                 | boolean  | `false` | Generate tuples from `minItems` / `maxItems`.                                                                                                                                              |
| `emptyObjectsUnknown`         | boolean  | `false` | Generate `unknown` instead of `Record<string, never>` for objects with no properties.                                                                                                      |
| `defaultNonNullable`          | boolean  | `true`  | Treat properties that have a `default` as required (`n: number` instead of `n?: number`).                                                                                                  |
| `excludeDeprecated`           | boolean  | `false` | Leave out deprecated operations and fields. For example, a deprecated `get` is printed as `get?: never`.                                                                                   |
| `immutable`                   | boolean  | `false` | Add `readonly` to properties and arrays.                                                                                                                                                   |
| `exportType`                  | boolean  | `false` | Export the top-level roots as `export type X = {...}` instead of `export interface X {...}`.                                                                                               |
| `enum`                        | boolean  | `false` | Export TypeScript `enum`s (for example `export enum PetTag { dog = "dog", cat = "cat" }`) instead of union types.                                                                          |
| `enumValues`                  | boolean  | `false` | Export enum values as arrays.                                                                                                                                                              |
| `conditionalEnums`            | boolean  | `false` | Generate TypeScript enums only when `x-enum-*` metadata is present.                                                                                                                        |
| `dedupeEnums`                 | boolean  | `false` | Remove duplicate enum types when `enum` is set.                                                                                                                                            |
| `pathParamsAsTypes`           | boolean  | `false` | Key `paths` by template literal types, such as ``[path: `/pets/${number}`]``.                                                                                                              |
| `propertiesRequiredByDefault` | boolean  | `false` | Treat every object as if `required` listed all of its properties.                                                                                                                          |
| `rootTypes`                   | boolean  | `false` | Also export root-level aliases, for example `export type SchemaPet = components["schemas"]["Pet"]`, `ResponseNotFound`, and `ParameterLimit`.                                              |
| `rootTypesNoSchemaPrefix`     | boolean  | `false` | Leave out the `Schema` prefix on root schema aliases. Requires `rootTypes`.                                                                                                                |
| `rootTypesKeepCasing`         | boolean  | `false` | Keep the original casing of root type names. Requires `rootTypes`.                                                                                                                         |
| `makePathsEnum`               | boolean  | `false` | Add `export enum ApiPaths`. Each member is named after the `operationId`, or after the method and path when there is no `operationId` (`listPets = "/pets"`, `DeletePets = "/pets/{id}"`). |
| `generatePathParams`          | boolean  | `false` | Add `path` parameters taken from the path template (as `string`) even when the document does not declare them.                                                                             |
| `readWriteMarkers`            | boolean  | `false` | Wrap `readOnly`/`writeOnly` properties in `$Read<T>`/`$Write<T>` and prepend the `$Read`, `$Write`, `Readable`, and `Writable` helper types.                                               |
| `silent`                      | boolean  | `false` | Suppress warnings, such as those for unresolved `$ref`s.                                                                                                                                   |
| `inject`                      | string   | none    | TypeScript source to insert at the top of the output.                                                                                                                                      |
| `transform`                   | function | none    | `(schemaObject, options: TransformNodeOptions) => ts.TypeNode \| TransformObject \| undefined`. Replaces the type generated for a schema. Return `undefined` to keep the default.          |
| `postTransform`               | function | none    | `(type: ts.TypeNode, options: TransformNodeOptions) => ts.TypeNode \| undefined`. Modifies each generated schema type.                                                                     |
| `transformProperty`           | function | none    | `(property: ts.PropertySignature, schemaObject, options: TransformNodeOptions) => ts.PropertySignature \| undefined`. Modifies each object property signature.                             |

To load relative files, pass `cwd` to `generate` from `@shipworthy/openapi-generator`.

### Hook example

```ts
import ts from "@shipworthy/openapi-typescript/compiler";
import { typescript } from "@shipworthy/openapi-typescript";

const nodes = typescript.generate(model, {
  inject: "export type Branded<T, B> = T & { __brand: B };",
  transform(schema) {
    if (schema.format === "date-time") return ts.factory.createTypeReferenceNode("Date");
    if (schema.format === "binary") {
      return { schema: ts.factory.createTypeReferenceNode("Blob"), questionToken: true };
    }
    return undefined; // keep the default type
  },
});
```

This produces:

```ts
export type Branded<T, B> = T & { __brand: B };
// ...
export interface components {
  schemas: {
    Obj: {
      /** Format: date-time */
      when?: Date;
      /** Format: binary */
      file?: Blob;
    };
  };
  // ...
}
```

## Generating from a file, URL, or 3.0 document

`decode` from `@shipworthy/openapi-transformer` takes a 3.1 object with no external references.
The CLI goes through `generate` from `@shipworthy/openapi-generator`, which loads, bundles,
upgrades, and decodes the document, then loads this plugin by name and runs it:

```ts
import { NodeServices } from "@effect/platform-node";
import { generate } from "@shipworthy/openapi-generator";
import { astToString, formatTypeScript } from "@shipworthy/openapi-typescript";
import type ts from "@shipworthy/openapi-typescript/compiler";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

const program = generate({
  specifier: "@shipworthy/openapi-typescript",
  exportName: "typescript",
  source: new URL("./openapi.yaml", import.meta.url), // or a URL string, or a document object
  pluginOptions: { immutable: true },
}).pipe(
  Effect.map((nodes) => (nodes as ts.Node[]).map((node) => astToString([node])).join("\n")),
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
);

const source = await formatTypeScript(await Effect.runPromise(program));
```

This example also needs `@effect/platform-node` (or `@effect/platform-bun` on Bun) and
`@shipworthy/openapi-generator`. `generate` needs `FileSystem`, `Path`, and `HttpClient` services. It fails with `ResolveError`
(load, bundle, or validation), `TransformError` (decoding, or any plugin failure including
`TypegenError`), `MissingPlugin`, or `InvalidPlugin`.

## Generated output

- `paths`: one entry per path. Each entry has `parameters` (`query`, `header`, `path`, `cookie`)
  and all eight methods. Methods the path does not define are `?: never`. Defined methods point
  to `operations["<operationId>"]`, or contain the operation inline when there is no
  `operationId`. A path item that is a `$ref` prints as a reference, such as
  `components["pathItems"]["Health"]`.
- `webhooks`: keyed by webhook name, with the same shape as `paths`.
- `components`: always has `schemas`, `responses`, `parameters`, `requestBodies`, `headers`, and
  `pathItems`. Empty sections are `never`.
- `$defs`: root-level `$defs` from the document.
- `operations`: keyed by `operationId`. Each has `parameters` (path-level parameters merged in),
  `requestBody` (`?: never` when there is none), and `responses`. Each response has `headers`
  (always including `[name: string]: unknown`) and `content` keyed by media type.
- A root with no members is printed as `export type <root> = Record<string, never>`.
- Schema mapping: `allOf` becomes an intersection, and `anyOf` and `oneOf` become unions.
  `const` and `enum` become literal types with an `@enum` JSDoc tag. `prefixItems` becomes a
  tuple. A list of types (`type: ["string", "null"]`) becomes a union. The `false` schema
  becomes `never`. A 3.0 `nullable: true` becomes `| null`. Optional properties use `?`, and
  `description`, `format`, and `example` appear as JSDoc comments.

## Supported OpenAPI versions

- OpenAPI 3.1: supported.
- OpenAPI 3.0: supported when you go through `@shipworthy/openapi-generator` or the CLI, which
  upgrade it to 3.1 first. For example, `nullable: true` becomes `| null`.
- Swagger 2.x and versions outside `>=3 <4` are rejected with errors such as
  `Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.` or
  `Unsupported OpenAPI version: <v>`.

## Limitations and caveats

- The plugin returns AST nodes, not a string. Use `astToString`, and then `formatTypeScript` for
  formatted output.
- `typescript.generate` takes a `ParsedService`, not a raw document. Decode or generate the model
  first.
- `./compiler` is a subset of the compiler API built on `typescript/unstable`. Its behavior can
  change along with TypeScript 7's unstable API.
- Errors from hooks are converted to `TypegenError`. The original stack trace is not kept in the
  error, only the message.

## Troubleshooting

| Symptom                                                      | Cause / fix                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `TypegenError: Expected boolean at ["<option>"]`             | An option has the wrong type. Boolean options must be `true` or `false`.                                                           |
| `Generated types are not up-to-date!` (exit 1)               | `--check` found a difference. Run the command again without `--check` to regenerate.                                               |
| `Install @shipworthy/openapi-typescript to load typescript.` | `@shipworthy/openapi-cli` could not import this package (`MissingPlugin`). Install it next to the CLI.                             |
| `Could not resolve $ref "..."` warning                       | A local `$ref` points to a location that does not exist. The reference is left unresolved. Use `silent: true` to hide the warning. |
| `NotFound: FileSystem.readFile (...)`                        | The CLI input path does not exist.                                                                                                 |
| Errors importing `typescript/unstable/...`                   | `typescript` is older than 7. Install `typescript@^7`.                                                                             |

## Key facts (for AI agents)

- Package: `@shipworthy/openapi-typescript`. ESM only, compiled JavaScript with `.d.ts` in
  `dist/`. Node.js `>=22.19.0` or Bun. Peer dependencies `typescript@^7` and `effect@^4`. Exports
  `.` and `./compiler`.
- Main export: `typescript`, a `Generator` with `id: "typescript"` and
  `generate(model: ParsedService, options) => Effect<ts.Node[], TypegenError>`.
- Other exports from `.`: `astToString`, `formatTypeScript` (async, oxfmt, width 100),
  `resolveRef`, `TypegenError`, and the types `OpenAPITSOptions`, `TransformNodeOptions`, and
  `TransformObject`.
- `./compiler` default export `ts`: a subset of `ts.factory`, guards, the printer, and
  `SyntaxKind`. Use it to build nodes inside hooks.
- CLI: `openapi generate typescript [input] [-o file] [--check] [--<option-kebab>]` from
  `@shipworthy/openapi-cli` (Node.js or Bun). The CLI reads stdin when there is no input and writes to
  stdout when there is no `-o`.
- Output roots: `paths`, `webhooks`, `components`, `$defs`, and `operations`. Use them as
  `components["schemas"]["X"]` and `operations["id"]["responses"][200]["content"]["application/json"]`.
- Every option defaults to `false` except `defaultNonNullable`, which defaults to `true`. Options
  are validated, and invalid values fail with `TypegenError`.
- Raw 3.1 objects: `decode` and then `typescript.generate`. Files, URLs, 3.0 documents, or
  external `$ref`s: `generate` from `@shipworthy/openapi-generator` or the CLI.
- Do not pass a raw OpenAPI document to `typescript.generate`.

## License

MIT. See [LICENSE](./LICENSE).

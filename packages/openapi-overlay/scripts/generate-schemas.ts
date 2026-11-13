import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array,
  Cause,
  Console,
  Effect,
  FileSystem,
  JsonSchema,
  Layer,
  Order,
  Path,
  pipe,
  Predicate,
  Schema,
  SchemaRepresentation,
} from "effect";
import { Command, Flag } from "effect/cli";
import { Digest } from "effect/crypto";
import * as Yaml from "effect/encoding/Yaml";
import { format } from "oxfmt";

class GenerateSchemasError extends Schema.TaggedError<
  GenerateSchemasError,
  { readonly brand: unique symbol }
>()("GenerateSchemasError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const publicNames = new Set(["OverlayInfo", "OverlayAction"]);

// Runs inside SchemaRepresentation's synchronous `onEnter` hook, so it can only report failure by
// throwing. `importSchema` turns the exception into a GenerateSchemasError.
function normalize(
  schema: JsonSchema.JsonSchema,
  definitions: JsonSchema.Definitions,
): JsonSchema.JsonSchema {
  if (schema.unevaluatedProperties === undefined) return schema;

  const reference = schema.$ref;

  const extension =
    typeof reference === "string" && reference.startsWith("#/$defs/")
      ? definitions[reference.slice("#/$defs/".length)]
      : undefined;

  if (
    schema.unevaluatedProperties !== false ||
    schema.type !== "object" ||
    !Predicate.isObject(schema.properties) ||
    !Predicate.isObject(extension) ||
    Object.keys(extension).some((key) => key !== "patternProperties") ||
    !Predicate.isObject(extension.patternProperties) ||
    Object.values(extension.patternProperties).some((value) => value !== true) ||
    schema.patternProperties !== undefined ||
    schema.additionalProperties !== undefined ||
    schema.propertyNames !== undefined ||
    schema.allOf !== undefined ||
    schema.anyOf !== undefined ||
    schema.oneOf !== undefined
  ) {
    throw new GenerateSchemasError({
      message: "Cannot normalize unevaluatedProperties without changing validation semantics",
    });
  }

  // These Overlay objects evaluate declared properties plus unconstrained extension patterns.
  // Preserve that key restriction as propertyNames; Effect can import the resulting open object.
  const { $ref: _, unevaluatedProperties: __, ...rest } = schema;

  return {
    ...rest,
    additionalProperties: true,
    propertyNames: {
      anyOf: [
        { enum: Object.keys(schema.properties) },
        ...Object.keys(extension.patternProperties).map((pattern) => ({ pattern })),
      ],
    },
  };
}

const importSchema = Effect.fnUntraced(function* (source: string) {
  const input = yield* Effect.try({
    try: () => Yaml.parse(source),
    catch: (cause) => new GenerateSchemasError({ message: "Cannot parse schema.yaml", cause }),
  });

  const json = yield* Schema.decodeUnknownEffect(Schema.JsonObject)(input).pipe(
    Effect.mapError(
      (cause) => new GenerateSchemasError({ message: "schema.yaml is not a JSON object", cause }),
    ),
  );

  return yield* Effect.try({
    try: () => {
      const document = JsonSchema.fromSchemaDraft2020_12(json);

      return SchemaRepresentation.fromJsonSchemaDocument(document, {
        patterns: "apply",
        onEnter: (schema) => normalize(schema, document.definitions),
      });
    },
    catch: (cause) =>
      cause instanceof GenerateSchemasError
        ? cause
        : new GenerateSchemasError({ message: "Cannot import the Overlay JSON Schema", cause }),
  });
});

const generate = Effect.fn("generate")(function* (source: string, version: string) {
  const imported = yield* importSchema(source);

  const representation = SchemaRepresentation.toRepresentation(imported.ast, {
    referencePolicy: ({ identifier }) => {
      if (identifier === "info-object") return "OverlayInfo";
      if (identifier === "action-object") return "OverlayAction";
      return identifier;
    },
  });

  const code = SchemaRepresentation.toCodeDocument(
    SchemaRepresentation.toMultiDocument(representation),
  );

  if (Object.keys(code.references.recursives).length !== 0 || code.artifacts.length !== 0) {
    return yield* new GenerateSchemasError({
      message: "Overlay schema generation needs support for recursive references or code artifacts",
    });
  }

  const root = code.codes[0];

  if (root === undefined) {
    return yield* new GenerateSchemasError({ message: "Missing generated Overlay schema" });
  }

  const declarations = Array.map(code.references.nonRecursives, ({ $ref, code: body }) => {
    const prefix = publicNames.has($ref) ? "export " : "";

    return `${prefix}const ${$ref} = ${body.runtime};\n\n${prefix}type ${$ref} = typeof ${$ref}.Type;`;
  });

  const digest = yield* Digest.Digest;
  const hash = yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(source));

  const output = Array.join(
    [
      `// Generated from schemas/v${version}/schema.yaml (sha256: ${hash}).\n// Run bun run generate:schemas to regenerate. Do not edit by hand.`,
      'import { Schema } from "effect";',
      ...declarations,
      `export const Overlay = ${root.runtime};`,
      "export type Overlay = typeof Overlay.Type;",
    ],
    "\n\n",
  );

  const formatted = yield* Effect.tryPromise({
    try: () => format(`${version}.ts`, output, { printWidth: 100 }),
    catch: (cause) => new GenerateSchemasError({ message: "Cannot format generated code", cause }),
  });

  if (formatted.errors.length !== 0) {
    return yield* new GenerateSchemasError({
      message: "Generated code has formatting errors",
      cause: formatted.errors,
    });
  }

  return formatted.code;
});

const run = Effect.fn("generateSchemas")(function* ({ check }: { readonly check: boolean }) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const schemaDirectory = path.join(import.meta.dirname, "../schemas");
  const outputDirectory = path.join(import.meta.dirname, "../src/schemas");

  const versions = pipe(
    yield* fs.readDirectoryEntries(schemaDirectory),
    Array.filter((entry) => entry.type === "Directory" && /^v\d+\.\d+$/.test(entry.name)),
    Array.map((entry) => entry.name.slice(1)),
    Array.sort(Order.String),
  );

  yield* Effect.forEach(
    versions,
    Effect.fnUntraced(function* (version) {
      const source = yield* fs.readFileString(
        path.join(schemaDirectory, `v${version}`, "schema.yaml"),
      );

      const output = path.join(outputDirectory, `${version}.ts`);
      const code = yield* generate(source, version);

      if (!check) {
        yield* fs.makeDirectory(outputDirectory, { recursive: true });
        return yield* fs.writeFileString(output, code);
      }

      const current = (yield* fs.exists(output)) ? yield* fs.readFileString(output) : undefined;

      if (current !== code) {
        return yield* new GenerateSchemasError({
          message: `${output} is out of date. Run bun run generate:schemas.`,
        });
      }
    }),
    { discard: true },
  );
});

Command.make(
  "generate-schemas",
  { check: Flag.Boolean("check").pipe(Flag.withDefault(false)) },
  run,
).pipe(
  Command.run({ version: "0.0.0" }),
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  Effect.provide(Layer.mergeAll(NodeServices.layer, Digest.layerWebCrypto)),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);

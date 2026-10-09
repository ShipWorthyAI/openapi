import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JsonSchema, Predicate, Schema, SchemaRepresentation } from "effect";
import * as Yaml from "effect/encoding/Yaml";
import { format } from "oxfmt";

const schemaDirectory = new URL("../schemas/", import.meta.url);
const outputDirectory = new URL("../src/schemas/", import.meta.url);
const check = process.argv.includes("--check");

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
    throw new Error("Cannot normalize unevaluatedProperties without changing validation semantics");
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

async function generate(source: string, version: string): Promise<string> {
  const input = Yaml.parse(source);

  const document = JsonSchema.fromSchemaDraft2020_12(
    Schema.decodeUnknownSync(Schema.JsonObject)(input),
  );

  const imported = SchemaRepresentation.fromJsonSchemaDocument(document, {
    patterns: "apply",
    onEnter: (schema) => normalize(schema, document.definitions),
  });

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
    throw new Error(
      "Overlay schema generation needs support for recursive references or code artifacts",
    );
  }

  const root = code.codes[0];

  if (root === undefined) throw new Error("Missing generated Overlay schema");
  const publicNames = new Set(["OverlayInfo", "OverlayAction"]);

  const declarations = code.references.nonRecursives.map(({ $ref, code: body }) => {
    const prefix = publicNames.has($ref) ? "export " : "";

    return `${prefix}const ${$ref} = ${body.runtime};\n\n${prefix}type ${$ref} = typeof ${$ref}.Type;`;
  });

  const digest = createHash("sha256").update(source).digest("hex");

  const output = [
    `// Generated from schemas/v${version}/schema.yaml (sha256: ${digest}).\n// Run bun run generate:schemas to regenerate. Do not edit by hand.`,
    "/* oxlint-disable effecttsgo/schema-number -- Effect's JSON Schema importer emits Schema.Number with an isFinite check. */",
    'import { Schema } from "effect";',
    ...declarations,
    `export const Overlay = ${root.runtime};`,
    "export type Overlay = typeof Overlay.Type;",
  ].join("\n\n");

  const formatted = await format(`${version}.ts`, output, { printWidth: 100 });

  if (formatted.errors.length !== 0) throw new Error(JSON.stringify(formatted.errors));
  return formatted.code;
}

const versions = readdirSync(schemaDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^v\d+\.\d+$/.test(entry.name))
  .map((entry) => entry.name.slice(1))
  .sort();

for (const version of versions) {
  const source = readFileSync(new URL(`v${version}/schema.yaml`, schemaDirectory), "utf8");
  const output = new URL(`${version}.ts`, outputDirectory);
  const code = await generate(source, version);

  if (check) {
    if (!existsSync(output) || readFileSync(output, "utf8") !== code) {
      throw new Error(`${fileURLToPath(output)} is out of date. Run bun run generate:schemas.`);
    }
  } else {
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(output, code);
  }
}

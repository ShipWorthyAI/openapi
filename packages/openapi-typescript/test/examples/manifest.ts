import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenAPITSOptions } from "../../src/types.js";

const examplesDirectory = fileURLToPath(new URL("./", import.meta.url));

export interface ExampleVariant {
  readonly id: string;
  readonly flags: readonly string[];
}

export interface Example {
  readonly id: string;
  /** Schema path relative to `examples/`. */
  readonly schema: string;
  readonly variants: readonly ExampleVariant[];
  /** When false, `test:examples` skips this example. */
  readonly typecheck?: boolean;
}

const flagOptions = {
  "additional-properties": "additionalProperties",
  alphabetize: "alphabetize",
  "array-length": "arrayLength",
  "conditional-enums": "conditionalEnums",
  "dedupe-enums": "dedupeEnums",
  "default-non-nullable": "defaultNonNullable",
  "empty-objects-unknown": "emptyObjectsUnknown",
  enum: "enum",
  "enum-values": "enumValues",
  "exclude-deprecated": "excludeDeprecated",
  "export-type": "exportType",
  "generate-path-params": "generatePathParams",
  immutable: "immutable",
  "make-paths-enum": "makePathsEnum",
  "path-params-as-types": "pathParamsAsTypes",
  "properties-required-by-default": "propertiesRequiredByDefault",
  "read-write-markers": "readWriteMarkers",
  "root-types": "rootTypes",
  "root-types-keep-casing": "rootTypesKeepCasing",
  "root-types-no-schema-prefix": "rootTypesNoSchemaPrefix",
} as const satisfies Record<string, keyof OpenAPITSOptions>;

/** Map CLI flags such as `--immutable` onto generator options. */
export function flagsToOptions(flags: readonly string[]): OpenAPITSOptions {
  const options: OpenAPITSOptions = {};

  for (const flag of flags) {
    const [rawName, rawValue] = flag.replace(/^--/, "").split("=", 2);
    const name = rawName ?? "";
    const key = flagOptions[name as keyof typeof flagOptions];

    if (!key) throw new Error(`Unknown example flag: ${flag}`);

    const enabled = rawValue === undefined ? true : rawValue !== "false";
    Object.assign(options, { [key]: enabled });
  }

  return options;
}

export function schemaPath(example: Example): string {
  return path.join(examplesDirectory, example.schema);
}

export function typesPath(example: Example, variant: ExampleVariant): string {
  return path.join(examplesDirectory, example.id, variant.id, "types.ts");
}

export const examples = [
  {
    id: "simple",
    schema: "simple/schema.yaml",
    variants: [{ id: "default", flags: [] }],
  },
  {
    id: "enum-root-types",
    schema: "enum-root-types/schema.yaml",
    variants: [
      {
        id: "root-types-enum",
        flags: ["--root-types", "--root-types-no-schema-prefix", "--enum"],
      },
    ],
  },
  {
    id: "github",
    schema: "github/schema.yaml",
    variants: [
      { id: "default", flags: [] },
      { id: "immutable", flags: ["--immutable"] },
      { id: "immutable-export-type", flags: ["--immutable", "--export-type"] },
      { id: "properties-required-by-default", flags: ["--properties-required-by-default"] },
      { id: "root-types", flags: ["--root-types"] },
    ],
  },
  {
    id: "github-next",
    schema: "github-next/schema.yaml",
    variants: [{ id: "default", flags: [] }],
  },
  {
    id: "stripe",
    schema: "stripe/schema.yaml",
    variants: [{ id: "default", flags: [] }],
  },
  {
    id: "octokit-ghes-3.6",
    schema: "octokit-ghes-3.6/schema.json",
    variants: [{ id: "default", flags: [] }],
  },
  {
    id: "digital-ocean",
    schema: "digital-ocean/schema/DigitalOcean-public.v2.yaml",
    variants: [{ id: "default", flags: [] }],
  },
] as const satisfies readonly Example[];

export const exampleList: readonly Example[] = examples;

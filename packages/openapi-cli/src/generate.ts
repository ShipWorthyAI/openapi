import { performance } from "node:perf_hooks";
import type { Readable } from "node:stream";
import { generate as transform } from "@shipworthy/openapi-transformer";
import { Effect, FileSystem, Option, Path } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { requireClientName, schemaUrl, writeClient, writeGenerated } from "./client-files";
import { pascalCase } from "./prefix-types";
import { fail, userError } from "./user-error";
import { version } from "./version";

const DEPRECATED_FLAGS: readonly (readonly [string, string])[] = [
  ["-ap", 'The -ap alias has been deprecated. Use "--additional-properties" instead.'],
  ["--immutable-types", 'The --immutable-types flag has been renamed to "--immutable".'],
  [
    "--support-array-length",
    'The --support-array-length flag has been renamed to "--array-length".',
  ],
  ["-it", 'The -it alias has been deprecated. Use "--immutable-types" instead.'],
];

export function deprecatedTypescriptFlag(args: readonly string[]): string | undefined {
  if (!args.includes("typescript")) return undefined;

  for (const [flag, message] of DEPRECATED_FLAGS) {
    if (args.includes(flag)) return message;
  }

  return undefined;
}

function flag(name: string, description: string, defaultValue = false) {
  return Flag.Boolean(name).pipe(Flag.withDescription(description), Flag.withDefault(defaultValue));
}

function optionValue<A>(option: Option.Option<A>): A | undefined {
  return Option.match(option, {
    onNone: () => undefined,
    onSome: (value) => value,
  });
}

function formatTime(t: number) {
  if (t < 1000) return `${Math.round(10 * t) / 10}ms`;
  if (t < 60000) return `${Math.round(t / 100) / 10}s`;
  return `${Math.round(t / 6000) / 10}m`;
}

interface TypescriptModule {
  COMMENT_HEADER: string;
  astToString(nodes: readonly unknown[]): string;
  prefixTypes(nodes: readonly unknown[], prefix: string): string;
}

interface ZodSources {
  definitions: string;
  schemas: string;
  operations: string;
}

function typescriptModule() {
  return Effect.tryPromise({
    try: () => import("@shipworthy/openapi-typescript") as Promise<TypescriptModule>,
    catch: (cause) =>
      userError(
        cause,
        "Install @shipworthy/openapi-typescript to run openapi generate typescript.",
      ),
  });
}

function pluginOptions(flags: {
  readonly additionalProperties: boolean;
  readonly alphabetize: boolean;
  readonly arrayLength: boolean;
  readonly conditionalEnums: boolean;
  readonly dedupeEnums: boolean;
  readonly defaultNonNullable: boolean;
  readonly emptyObjectsUnknown: boolean;
  readonly enum: boolean;
  readonly enumValues: boolean;
  readonly excludeDeprecated: boolean;
  readonly exportType: boolean;
  readonly generatePathParams: boolean;
  readonly immutable: boolean;
  readonly makePathsEnum: boolean;
  readonly pathParamsAsTypes: boolean;
  readonly propertiesRequiredByDefault: boolean;
  readonly readWriteMarkers: boolean;
  readonly rootTypes: boolean;
  readonly rootTypesKeepCasing: boolean;
  readonly rootTypesNoSchemaPrefix: boolean;
  readonly silent?: boolean;
}) {
  return {
    additionalProperties: flags.additionalProperties,
    alphabetize: flags.alphabetize,
    arrayLength: flags.arrayLength,
    conditionalEnums: flags.conditionalEnums,
    dedupeEnums: flags.dedupeEnums,
    defaultNonNullable: flags.defaultNonNullable,
    emptyObjectsUnknown: flags.emptyObjectsUnknown,
    enum: flags.enum,
    enumValues: flags.enumValues,
    excludeDeprecated: flags.excludeDeprecated,
    exportType: flags.exportType,
    generatePathParams: flags.generatePathParams,
    immutable: flags.immutable,
    makePathsEnum: flags.makePathsEnum,
    pathParamsAsTypes: flags.pathParamsAsTypes,
    propertiesRequiredByDefault: flags.propertiesRequiredByDefault,
    readWriteMarkers: flags.readWriteMarkers,
    rootTypes: flags.rootTypes,
    rootTypesKeepCasing: flags.rootTypesKeepCasing,
    rootTypesNoSchemaPrefix: flags.rootTypesNoSchemaPrefix,
    silent: flags.silent ?? false,
  };
}

export const generate = Command.make(
  "generate",
  {
    plugin: Argument.String("plugin").pipe(
      Argument.withDescription(
        "Generator to run: typescript, standard-schema, zod, or tanstack-query.",
      ),
    ),
    input: Argument.String("input").pipe(
      Argument.withDescription("OpenAPI schema file or URL. Omit to read stdin for typescript."),
      Argument.optional,
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription(
        "Output file or directory. Writes to stdout when omitted for typescript.",
      ),
      Flag.optional,
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription(
        "Client name. Used as the output directory and the generated type prefix.",
      ),
      Flag.optional,
    ),
    check: flag("check", "Check that the generated types are up-to-date."),
    enum: flag("enum", "Export true TS enums instead of unions."),
    enumValues: flag("enum-values", "Export enum values as arrays."),
    conditionalEnums: flag(
      "conditional-enums",
      "Only generate true TS enums when enum metadata is available.",
    ),
    dedupeEnums: flag("dedupe-enums", "Dedupe enum types when --enum is set."),
    exportType: Flag.Boolean("export-type").pipe(
      Flag.withAlias("t"),
      Flag.withDescription("Export top-level type aliases instead of interfaces."),
      Flag.withDefault(false),
    ),
    immutable: flag("immutable", "Generate readonly types."),
    additionalProperties: flag(
      "additional-properties",
      "Treat schema objects as if additionalProperties: true is set.",
    ),
    emptyObjectsUnknown: flag(
      "empty-objects-unknown",
      "Generate unknown instead of Record<string, never> for empty objects.",
    ),
    defaultNonNullable: flag(
      "default-non-nullable",
      "Set to false to ignore default values when generating non-nullable types.",
      true,
    ),
    propertiesRequiredByDefault: flag(
      "properties-required-by-default",
      "Treat schema objects as if required lists every property.",
    ),
    arrayLength: flag("array-length", "Generate tuples using array minItems / maxItems."),
    pathParamsAsTypes: flag("path-params-as-types", "Convert paths to template literal types."),
    alphabetize: flag("alphabetize", "Sort object keys alphabetically."),
    excludeDeprecated: flag("exclude-deprecated", "Exclude deprecated types."),
    rootTypes: flag("root-types", "Export schema types at the root level."),
    rootTypesNoSchemaPrefix: flag(
      "root-types-no-schema-prefix",
      'Do not add a "Schema" prefix to root types. Requires --root-types.',
    ),
    rootTypesKeepCasing: flag(
      "root-types-keep-casing",
      "Keep the casing of root types. Requires --root-types.",
    ),
    makePathsEnum: flag("make-paths-enum", "Generate an ApiPaths enum for all paths."),
    readWriteMarkers: flag(
      "read-write-markers",
      "Generate $Read/$Write markers for readOnly/writeOnly properties.",
    ),
    generatePathParams: flag(
      "generate-path-params",
      "Generate path params from the path template even when the schema omits them.",
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      if (flags.rootTypesNoSchemaPrefix && !flags.rootTypes) {
        console.warn("--root-types-no-schema-prefix has no effect without --root-types flag");
      }

      if (flags.rootTypesKeepCasing && !flags.rootTypes) {
        console.warn("--root-types-keep-casing has no effect without --root-types flag");
      }

      const output = optionValue(flags.output);
      const input = optionValue(flags.input);
      const name = optionValue(flags.name);
      if (input?.includes("*")) return yield* fail("Globbing is unsupported.");
      const started = performance.now();

      if (flags.plugin === "typescript") {
        yield* generateTypescript(flags, input, output, started);
        return;
      }

      if (!input) return yield* fail("An OpenAPI schema file or URL is required.");
      const source = yield* schemaUrl(input);

      if (flags.plugin === "zod") {
        if (!name) return yield* fail("--name is required.");
        if (!output) return yield* fail("--output is required.");
        yield* requireClientName(name);
        const prefix = pascalCase(name);

        const validators = (yield* transform({
          plugin: "zod",
          source,
          lint: false,
          pluginOptions: { prefix },
        }).pipe(Effect.mapError(userError))) as ZodSources;

        const nodes = yield* transform({
          plugin: "typescript",
          source,
          lint: false,
          pluginOptions: { ...pluginOptions(flags), defaultNonNullable: false },
        }).pipe(Effect.mapError(userError));

        const printed = yield* loadedTypes(nodes, prefix);

        yield* writeGenerated(output, name, {
          "types.ts": printed,
          "definitions.ts": validators.definitions,
          "schemas.ts": validators.schemas,
          "operations.ts": validators.operations,
        });

        return;
      }

      if (flags.plugin === "tanstack-query") {
        if (!name) return yield* fail("--name is required.");
        if (!output) return yield* fail("--output is required.");
        yield* requireClientName(name);
        const prefix = pascalCase(name);

        const generated = (yield* transform({
          plugin: "tanstack-query",
          source,
          lint: true,
          silent: false,
          pluginOptions: { ...pluginOptions(flags), prefix, name, defaultNonNullable: false },
        }).pipe(Effect.mapError(userError))) as { nodes: readonly unknown[]; client: string };

        const types = yield* loadedTypes(generated.nodes, prefix);
        yield* writeClient(output, name, types, generated.client);
        return;
      }

      if (flags.plugin === "standard-schema") {
        const text = yield* transform({ plugin: "standard-schema", source, lint: false }).pipe(
          Effect.mapError(userError),
        );

        if (typeof text !== "string") return yield* fail("standard-schema did not return source.");

        if (!output) {
          process.stdout.write(text);
          return;
        }

        yield* publish(text, yield* resolveOutput(output), false, input, output, started);
        return;
      }

      return yield* fail(`Unknown generator plugin: ${flags.plugin}.`);
    }),
).pipe(
  Command.withDescription("Convert an OpenAPI schema to TypeScript."),
  Command.withShortDescription("Run a generator plugin"),
  Command.withExamples([
    {
      command: "openapi generate typescript ./openapi.yaml -o ./schema.ts",
      description: "Write TypeScript types for a local schema",
    },
    {
      command: "openapi generate zod ./openapi.yaml -o ./src/generated --name hotels",
      description: "Write hotels/types.ts, definitions.ts, schemas.ts, and operations.ts",
    },
    {
      command: "openapi generate tanstack-query ./openapi.yaml -o ./src/generated --name hotels",
      description: "Write hotels/types.ts and hotels/client.ts",
    },
    {
      command: "openapi generate standard-schema ./openapi.yaml -o ./schemas.ts",
      description: "Write Standard Schema validators",
    },
  ]),
);

function generateTypescript(
  flags: Parameters<typeof pluginOptions>[0] & { readonly check: boolean },
  input: string | undefined,
  output: string | undefined,
  started: number,
) {
  return Effect.gen(function* () {
    if (output) console.info(`openapi generate typescript ${version}`);
    const source: string | URL | Readable = input ? yield* schemaUrl(input) : process.stdin;

    const nodes = yield* transform({
      plugin: "typescript",
      source,
      lint: true,
      silent: output === undefined,
      pluginOptions: pluginOptions({ ...flags, silent: output === undefined }),
    }).pipe(Effect.mapError(userError));

    const types = yield* typescriptModule();
    const printed = `${types.COMMENT_HEADER}${types.astToString(nodes as readonly unknown[])}`;

    if (!output) {
      process.stdout.write(printed);
      return;
    }

    yield* publish(
      printed,
      yield* resolveOutput(output),
      flags.check,
      input ?? "stdin",
      output,
      started,
    );
  });
}

function loadedTypes(nodes: unknown, prefix: string) {
  return Effect.gen(function* () {
    const types = yield* typescriptModule();
    return types.prefixTypes(nodes as readonly unknown[], prefix);
  });
}

function resolveOutput(output: string) {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.resolve(output);
  });
}

function publish(
  result: string,
  outputPath: string,
  check: boolean,
  label: string,
  outputLabel: string,
  started: number,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    if (check) {
      const previous = yield* fs.readFileString(outputPath).pipe(Effect.mapError(userError));
      if (previous === result) return;
      console.error("Generated types are not up-to-date!");
      return yield* fail("Generated types are not up-to-date!");
    }

    yield* fs
      .makeDirectory(path.dirname(outputPath), { recursive: true })
      .pipe(Effect.mapError(userError));
    yield* fs.writeFileString(outputPath, result).pipe(Effect.mapError(userError));
    console.log(`${label} → ${outputLabel} [${formatTime(performance.now() - started)}]`);
  });
}

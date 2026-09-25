import { performance } from "node:perf_hooks";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createConfig, findConfig, loadConfig, type Config } from "@shipworthy/openapi-core";
import openapiTS, {
  type OpenAPITSOptions,
  astToString,
  c,
  COMMENT_HEADER,
  error,
  formatTime,
  warn,
} from "@shipworthy/openapi-typescript";
import { Effect, FileSystem, Option, Path } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { version } from "./version";
import { fail, userError } from "./user-error";

const REDOC_CONFIG_KEY = "x-openapi-ts";

const BOOLEAN_OPTIONS = [
  "additionalProperties",
  "alphabetize",
  "arrayLength",
  "conditionalEnums",
  "dedupeEnums",
  "defaultNonNullable",
  "emptyObjectsUnknown",
  "enum",
  "enumValues",
  "excludeDeprecated",
  "exportType",
  "generatePathParams",
  "immutable",
  "makePathsEnum",
  "pathParamsAsTypes",
  "propertiesRequiredByDefault",
  "readWriteMarkers",
  "rootTypes",
  "rootTypesKeepCasing",
  "rootTypesNoSchemaPrefix",
] as const satisfies readonly (keyof OpenAPITSOptions)[];

const DEPRECATED_FLAGS: readonly (readonly [string, string])[] = [
  ["-ap", 'The -ap alias has been deprecated. Use "--additional-properties" instead.'],
  ["--immutable-types", 'The --immutable-types flag has been renamed to "--immutable".'],
  [
    "--support-array-length",
    'The --support-array-length flag has been renamed to "--array-length".',
  ],
  ["-it", 'The -it alias has been deprecated. Use "--immutable-types" instead.'],
  ["--redoc", 'The --redoc config flag has been renamed to "--redocly" (or -c as shorthand).'],
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

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionValue<A>(option: Option.Option<A>): A | undefined {
  return Option.match(option, {
    onNone: () => undefined,
    onSome: (value) => value,
  });
}

function applyBooleanOverrides(options: OpenAPITSOptions, raw: Record<string, unknown>): void {
  for (const name of BOOLEAN_OPTIONS) {
    const direct = raw[name];
    const kebab = raw[kebabCase(name)];
    if (typeof direct === "boolean") options[name] = direct;
    else if (typeof kebab === "boolean") options[name] = kebab;
  }
}

function renderSchema(source: string | URL | Readable, options: OpenAPITSOptions) {
  return Effect.tryPromise({
    try: async () => `${COMMENT_HEADER}${astToString(await openapiTS(source, options))}`,
    catch: (cause) => userError(cause),
  });
}

const cwdUrl = () => new URL(`file://${process.cwd()}/`);

export const typescript = Command.make(
  "typescript",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("OpenAPI schema file or URL. Omit to read stdin."),
      Argument.optional,
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Output file. Writes the generated types to stdout when omitted."),
      Flag.optional,
    ),
    redocly: Flag.String("redocly").pipe(
      Flag.withAlias("c"),
      Flag.withDescription("Path to a Redocly config. Defaults to redocly.yaml."),
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
  (config) =>
    Effect.gen(function* () {
      if (config.rootTypesNoSchemaPrefix && !config.rootTypes) {
        console.warn("--root-types-no-schema-prefix has no effect without --root-types flag");
      }
      if (config.rootTypesKeepCasing && !config.rootTypes) {
        console.warn("--root-types-keep-casing has no effect without --root-types flag");
      }

      const output = optionValue(config.output);
      const input = optionValue(config.input);
      const redoclyFlag = optionValue(config.redocly);
      const started = performance.now();
      if (output) {
        console.info(`✨ ${c.bold(`openapi typescript ${version}`)}`);
      }

      const redocly = yield* loadRedocly(redoclyFlag);
      const apis = isRecord(redocly.apis) ? redocly.apis : {};
      const configFile = typeof redocly.configFile === "string" ? redocly.configFile : undefined;

      if (Object.keys(apis).length > 0) {
        if (input) {
          warn(
            "APIs are specified both in Redocly Config and CLI argument. Only using Redocly config.",
          );
        }
        const path = yield* Path.Path;
        const configRoot = !configFile
          ? cwdUrl()
          : path.isAbsolute(configFile)
            ? new URL(`file://${configFile}`)
            : new URL(configFile, cwdUrl());
        for (const [name, api] of Object.entries(apis)) {
          yield* generateApi(name, api, config, redocly, configRoot, started);
        }
        return;
      }

      const options = generatorOptions(config, redocly, output === undefined);
      if (!input) {
        const result = yield* renderSchema(process.stdin, options);
        if (!output) {
          process.stdout.write(result);
          return;
        }
        yield* publish(
          result,
          yield* resolveOutput(output),
          config.check,
          "stdin",
          output,
          started,
        );
        return;
      }

      if (input.includes("*")) {
        return yield* fail("Globbing has been deprecated in favor of redocly.yaml’s `apis` keys.");
      }
      const result = yield* renderSchema(new URL(input, cwdUrl()), options);
      if (!output) {
        process.stdout.write(result);
        return;
      }
      yield* publish(result, yield* resolveOutput(output), config.check, input, output, started);
    }),
).pipe(
  Command.withDescription("Convert an OpenAPI schema to TypeScript."),
  Command.withShortDescription("Generate TypeScript types"),
  Command.withExamples([
    {
      command: "openapi typescript ./openapi.yaml -o ./schema.ts",
      description: "Write TypeScript types for a local schema",
    },
    {
      command: "openapi typescript --redocly redocly.yaml",
      description: "Generate every API declared in a Redocly config",
    },
  ]),
);

function generatorOptions(
  config: {
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
  },
  redocly: Config,
  silent: boolean,
): OpenAPITSOptions {
  return {
    additionalProperties: config.additionalProperties,
    alphabetize: config.alphabetize,
    arrayLength: config.arrayLength,
    conditionalEnums: config.conditionalEnums,
    dedupeEnums: config.dedupeEnums,
    defaultNonNullable: config.defaultNonNullable,
    emptyObjectsUnknown: config.emptyObjectsUnknown,
    enum: config.enum,
    enumValues: config.enumValues,
    excludeDeprecated: config.excludeDeprecated,
    exportType: config.exportType,
    generatePathParams: config.generatePathParams,
    immutable: config.immutable,
    makePathsEnum: config.makePathsEnum,
    pathParamsAsTypes: config.pathParamsAsTypes,
    propertiesRequiredByDefault: config.propertiesRequiredByDefault,
    readWriteMarkers: config.readWriteMarkers,
    rootTypes: config.rootTypes,
    rootTypesKeepCasing: config.rootTypesKeepCasing,
    rootTypesNoSchemaPrefix: config.rootTypesNoSchemaPrefix,
    redocly,
    silent,
  };
}

function loadRedocly(explicit: string | undefined) {
  return Effect.gen(function* () {
    const located = yield* explicit === undefined
      ? Effect.sync(() => findConfig())
      : locateConfig(explicit);
    if (explicit !== undefined && !located) {
      return yield* fail(`Redocly config not found at: ${explicit}`);
    }
    return yield* Effect.tryPromise({
      try: async () =>
        located ? loadConfig({ configPath: located }) : createConfig({}, { extends: ["minimal"] }),
      catch: (cause) => userError(cause),
    });
  });
}

function locateConfig(explicit: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const explicitPath = path.resolve(explicit);
    if (!(yield* fs.exists(explicitPath).pipe(Effect.mapError(userError)))) return undefined;
    const info = yield* fs.stat(explicitPath).pipe(Effect.mapError(userError));
    if (info.type === "Directory") {
      return yield* Effect.try({
        try: () => findConfig(explicitPath),
        catch: (cause) => userError(cause),
      });
    }
    return explicitPath;
  });
}

function generateApi(
  name: string,
  api: unknown,
  config: Parameters<typeof generatorOptions>[0] & { readonly check: boolean },
  redocly: Config,
  configRoot: URL,
  started: number,
) {
  return Effect.gen(function* () {
    if (!isRecord(api) || typeof api.root !== "string") {
      return yield* fail(`API ${name} is missing a root document.`);
    }
    const extension = api[REDOC_CONFIG_KEY];
    const output = isRecord(extension) ? extension.output : undefined;
    if (typeof output !== "string") {
      return yield* fail(`API ${name} is missing an \`${REDOC_CONFIG_KEY}.output\` key.`);
    }
    const options = generatorOptions(config, redocly, false);
    if (isRecord(extension)) applyBooleanOverrides(options, extension);
    const result = yield* renderSchema(new URL(api.root, configRoot), options);
    yield* publish(
      result,
      fileURLToPath(new URL(output, configRoot)),
      config.check,
      name,
      output,
      started,
    );
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
      error("Generated types are not up-to-date!");
      return yield* fail("Generated types are not up-to-date!");
    }
    yield* fs
      .makeDirectory(path.dirname(outputPath), { recursive: true })
      .pipe(Effect.mapError(userError));
    yield* fs.writeFileString(outputPath, result).pipe(Effect.mapError(userError));
    console.log(
      `🚀 ${c.green(`${label} → ${c.bold(outputLabel)}`)} ${c.dim(`[${formatTime(performance.now() - started)}]`)}`,
    );
  });
}

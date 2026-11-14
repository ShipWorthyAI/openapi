import { Array, Option, Order, pipe, Predicate, Result, Schema, String } from "effect";

const pluginNames = ["standard-schema", "tanstack-query", "typescript", "zod"] as const;

type PluginName = (typeof pluginNames)[number];

export const ClientName = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)*$/, {
      message:
        "--name must start with a letter and contain only letters, numbers, and single hyphen or underscore separators.",
    }),
  ),
);

interface Generator {
  readonly specifier: string;
  readonly exportName: string;
}

interface Plugin {
  readonly generator: Generator;
  /** Whether the plugin's file imports the shared `types.ts`. */
  readonly types: boolean;
}

export const plugins: Readonly<Record<PluginName, Plugin>> = {
  "standard-schema": {
    generator: {
      specifier: "@shipworthy/openapi-standard-schema",
      exportName: "standardSchema",
    },
    types: false,
  },
  "tanstack-query": {
    generator: {
      specifier: "@shipworthy/openapi-tanstack-query/generator",
      exportName: "tanstackQuery",
    },
    types: true,
  },
  typescript: {
    generator: { specifier: "@shipworthy/openapi-typescript", exportName: "typescript" },
    types: true,
  },
  zod: {
    generator: { specifier: "@shipworthy/openapi-zod", exportName: "zod" },
    types: true,
  },
};

/** One file a run writes, with the plugin that renders it. */
export type OutputFile =
  | {
      readonly plugin: "typescript";
      readonly name: "types.ts" | "wire-types.ts";
      readonly camelCase: boolean;
    }
  | { readonly plugin: "zod"; readonly name: "zod-schema.ts"; readonly camelCase: boolean }
  | {
      readonly plugin: "tanstack-query";
      readonly name: "client.ts";
      readonly camelCase: boolean;
      readonly clientName: string;
    }
  | {
      readonly plugin: "standard-schema";
      readonly name: "standard-schema.ts";
      readonly camelCase: boolean;
    };

interface PlanOptions {
  /** Positional plugin names, as typed. */
  readonly plugins: ReadonlyArray<string>;
  /** `--output`, as typed. */
  readonly output: Option.Option<string>;
  /** Basename of the resolved output directory. */
  readonly outputName: Option.Option<string>;
  readonly name: Option.Option<string>;
  readonly camelCase: boolean;
  readonly wireTypes: boolean;
  readonly check: boolean;
}

const isPluginName = Schema.is(Schema.Literals(pluginNames));
const isClientName = Schema.is(ClientName);
const byName = Order.mapInput(Order.String, (file: OutputFile) => file.name);

/** Converts a `ClientName` (single `-` or `_` separators) to PascalCase. */
export function pascalCase(value: string): string {
  return pipe(value, String.split(/[-_]/), Array.map(String.capitalize), Array.join(""));
}

function isFilePath(output: string): boolean {
  return /\.(?:[mc]?ts|[mc]?js|json)$/i.test(output);
}

/**
 * Validates a `generate` invocation and lists the files it writes, sorted by name.
 * Fails with the message shown to the user.
 */
export function planFiles(options: PlanOptions): Result.Result<ReadonlyArray<OutputFile>, string> {
  const unknown = Array.findFirst(options.plugins, Predicate.not(isPluginName));

  if (Option.isSome(unknown)) {
    return Result.fail(
      `Unknown plugin: ${unknown.value}. Available plugins: ${Array.join(pluginNames, ", ")}.`,
    );
  }

  const selected = Array.dedupe(Array.filter(options.plugins, isPluginName));
  const types = Array.some(selected, (plugin) => plugins[plugin].types);

  if (options.wireTypes && !options.camelCase) {
    return Result.fail("--wire-types requires --camel-case.");
  }

  if (options.wireTypes && !types) {
    return Result.fail("--wire-types requires typescript, zod, or tanstack-query.");
  }

  if (options.check && Option.isNone(options.output)) {
    return Result.fail("--check requires --output.");
  }

  const camelCase = options.camelCase;
  const client = Array.contains(selected, "tanstack-query");

  // Every file but client.ts, whose name is resolved only once the other checks pass.
  const files: ReadonlyArray<OutputFile> = [
    ...(types ? [{ plugin: "typescript", name: "types.ts", camelCase } as const] : []),
    ...(options.wireTypes
      ? [{ plugin: "typescript", name: "wire-types.ts", camelCase: false } as const]
      : []),
    ...(Array.contains(selected, "zod")
      ? [{ plugin: "zod", name: "zod-schema.ts", camelCase } as const]
      : []),
    ...(Array.contains(selected, "standard-schema")
      ? [{ plugin: "standard-schema", name: "standard-schema.ts", camelCase } as const]
      : []),
  ];

  if (files.length + (client ? 1 : 0) > 1 && Option.isNone(options.output)) {
    return Result.fail("--output is required when generating more than one file.");
  }

  if (Option.exists(options.output, isFilePath)) {
    return Result.fail("--output must be a directory. Each plugin writes its own file inside it.");
  }

  if (!client) return Result.succeed(Array.sort(files, byName));

  return Result.map(clientName(options), (clientName) =>
    Array.sort(
      [...files, { plugin: "tanstack-query", name: "client.ts", camelCase, clientName } as const],
      byName,
    ),
  );
}

/** `--name`, or the output directory's basename when it is a valid client name. */
function clientName(options: PlanOptions): Result.Result<string, string> {
  if (Option.isSome(options.name)) return Result.succeed(options.name.value);

  return Option.match(Option.filter(options.outputName, isClientName), {
    onSome: Result.succeed,
    onNone: () =>
      Result.fail(
        `Cannot derive a client name from the output directory "${Option.getOrElse(options.outputName, () => "")}". Pass --name.`,
      ),
  });
}

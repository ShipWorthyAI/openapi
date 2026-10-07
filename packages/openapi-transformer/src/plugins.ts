import type { Generator } from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import { MissingPlugin, UnknownPlugin } from "./errors.js";

export const pluginPackages = {
  typescript: "@shipworthy/openapi-typescript",
  "standard-schema": "@shipworthy/openapi-standard-schema",
  zod: "@shipworthy/openapi-zod",
  "tanstack-query": "@shipworthy/openapi-tanstack-query-utils",
} as const;

const pluginSpecifiers: Record<PluginName, string> = {
  typescript: pluginPackages.typescript,
  "standard-schema": pluginPackages["standard-schema"],
  zod: pluginPackages.zod,
  "tanstack-query": "@shipworthy/openapi-tanstack-query-utils/generator",
};

export type PluginName = keyof typeof pluginPackages;

const exportNames: Record<PluginName, string> = {
  typescript: "typescript",
  "standard-schema": "standardSchema",
  zod: "zod",
  "tanstack-query": "tanstackQuery",
};

export type ModuleLoader = (specifier: string) => Promise<unknown>;

export function isPluginName(value: string): value is PluginName {
  return Object.hasOwn(pluginPackages, value);
}

function isGenerator(value: unknown): value is Generator<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "generate" in value &&
    typeof value.generate === "function" &&
    "id" in value
  );
}

export const importPlugin = Effect.fn("openapi-transformer.importPlugin")(function* (
  plugin: string,
  load: ModuleLoader = (specifier) => import(specifier),
) {
  if (!isPluginName(plugin)) {
    return yield* new UnknownPlugin({ text: `Unknown generator plugin: ${plugin}.` });
  }
  const specifier = pluginPackages[plugin];
  const imported = pluginSpecifiers[plugin];
  const loaded = yield* Effect.tryPromise({
    try: () => load(imported),
    catch: () => new MissingPlugin({ plugin, specifier }),
  });
  const value = (loaded as Record<string, unknown>)[exportNames[plugin]];
  if (!isGenerator(value)) return yield* new MissingPlugin({ plugin, specifier });
  return value;
});

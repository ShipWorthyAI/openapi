import { Command } from "effect/cli";
import { standardSchema } from "./plugins/standard-schema/plugin.ts";
import { tanstackQuery } from "./plugins/tanstack-query/plugin.ts";
import { typescript } from "./plugins/typescript/plugin.ts";
import { zod } from "./plugins/zod/plugin.ts";

export const generate = Command.make("generate").pipe(
  Command.withDescription("Convert an OpenAPI schema to TypeScript."),
  Command.withShortDescription("Run a generator plugin"),
  Command.withSubcommands([typescript, zod, tanstackQuery, standardSchema]),
);

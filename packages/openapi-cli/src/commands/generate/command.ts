import { Command } from "effect/cli";
import { standardSchema } from "./plugins/standard-schema/plugin.js";
import { tanstackQuery } from "./plugins/tanstack-query/plugin.js";
import { typescript } from "./plugins/typescript/plugin.js";
import { zod } from "./plugins/zod/plugin.js";

export const generate = Command.make("generate").pipe(
  Command.withDescription("Convert an OpenAPI schema to TypeScript."),
  Command.withShortDescription("Run a generator plugin"),
  Command.withSubcommands([typescript, zod, tanstackQuery, standardSchema]),
);

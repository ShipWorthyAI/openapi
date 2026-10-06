import { Command } from "effect/cli";
import { reactQuery } from "./react-query";
import { tanstackQuery } from "./tanstack-query";
import { typescript } from "./typescript";
import { zod } from "./zod";

export const openapi = Command.make("openapi").pipe(
  Command.withDescription(
    "Generate TypeScript, Zod validators, and typed clients from OpenAPI schemas.",
  ),
  Command.withSubcommands([typescript, zod, reactQuery, tanstackQuery]),
);

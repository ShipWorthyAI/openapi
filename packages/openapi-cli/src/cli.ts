import { Command } from "effect/unstable/cli";
import { reactQuery } from "./react-query";
import { tanstackQuery } from "./tanstack-query";
import { typescript } from "./typescript";

export const openapi = Command.make("openapi").pipe(
  Command.withDescription("Generate TypeScript and typed clients from OpenAPI schemas."),
  Command.withSubcommands([typescript, reactQuery, tanstackQuery]),
);

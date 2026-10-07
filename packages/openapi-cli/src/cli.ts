import { Command } from "effect/cli";
import { generate } from "./generate";

export const openapi = Command.make("openapi").pipe(
  Command.withDescription(
    "Generate TypeScript, Zod validators, and typed clients from OpenAPI schemas.",
  ),
  Command.withSubcommands([generate]),
);

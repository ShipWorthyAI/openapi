import { Command } from "effect/cli";
import { generate } from "./commands/generate/command";
import { lint } from "./commands/lint/command";

export const openapi = Command.make("openapi").pipe(
  Command.withDescription(
    "Lint OpenAPI schemas, and generate TypeScript, Zod validators, and typed clients.",
  ),
  Command.withSubcommands([generate, lint]),
);

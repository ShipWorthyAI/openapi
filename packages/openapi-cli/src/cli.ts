import { Command } from "effect/cli";
import { generate } from "./generate";
import { lint } from "./lint";

export const openapi = Command.make("openapi").pipe(
  Command.withDescription(
    "Lint OpenAPI schemas and generate TypeScript, Zod validators, and typed clients.",
  ),
  Command.withSubcommands([generate, lint]),
);

import { Command } from "effect/cli";
import { bundle } from "./commands/bundle/command.ts";
import { generate } from "./commands/generate/command.ts";
import { lint } from "./commands/lint/command.ts";
import { overlay } from "./commands/overlay/command.ts";

export const openapi = Command.make("openapi").pipe(
  Command.withDescription(
    "Bundle, overlay, and lint OpenAPI schemas, and generate TypeScript, Zod validators, and typed clients.",
  ),
  Command.withSubcommands([bundle, overlay, generate, lint]),
);

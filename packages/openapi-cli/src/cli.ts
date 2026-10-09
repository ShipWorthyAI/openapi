import { Command } from "effect/cli";
import { bundle } from "./commands/bundle/command.js";
import { generate } from "./commands/generate/command.js";
import { lint } from "./commands/lint/command.js";
import { overlay } from "./commands/overlay/command.js";

export const openapi = Command.make("openapi").pipe(
  Command.withDescription(
    "Bundle, overlay, and lint OpenAPI schemas, and generate TypeScript, Zod validators, and typed clients.",
  ),
  Command.withSubcommands([bundle, overlay, generate, lint]),
);

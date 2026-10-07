#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command } from "effect/cli";
import { openapi } from "./cli";
import { deprecatedTypescriptFlag } from "./generate";
import { version } from "./version";

const deprecated = deprecatedTypescriptFlag(process.argv.slice(2));
if (deprecated) {
  console.error(deprecated);
  process.exit(1);
}

openapi.pipe(Command.run({ version }), Effect.provide(BunServices.layer), BunRuntime.runMain);

#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { error } from "@shipworthy/openapi-typescript";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { openapi } from "./cli";
import { deprecatedTypescriptFlag } from "./typescript";
import { version } from "./version";

const deprecated = deprecatedTypescriptFlag(process.argv.slice(2));
if (deprecated) {
  error(deprecated);
  process.exit(1);
}

openapi.pipe(Command.run({ version }), Effect.provide(BunServices.layer), BunRuntime.runMain);

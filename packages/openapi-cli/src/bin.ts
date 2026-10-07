#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { ModuleLoader } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import { openapi } from "./cli";
import { version } from "./version";

openapi.pipe(
  Command.run({ version }),
  Effect.provideService(ModuleLoader, { load: (specifier) => import(specifier) }),
  Effect.provide(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer)),
  BunRuntime.runMain,
);

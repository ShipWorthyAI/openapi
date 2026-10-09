#!/usr/bin/env bun
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { ModuleLoader } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import { openapi } from "./cli.ts";
import { version } from "./version.ts";

version.pipe(
  Effect.flatMap((version) => openapi.pipe(Command.run({ version }))),
  Effect.provideService(ModuleLoader, { load: (specifier) => import(specifier) }),
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  NodeRuntime.runMain,
);

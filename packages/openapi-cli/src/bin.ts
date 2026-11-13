#!/usr/bin/env bun
// Import modules directly: the package index also loads NodeRedis, which requires `redis`.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ModuleLoader } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { Digest } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import { openapi } from "./cli.ts";
import { version } from "./version.ts";

version.pipe(
  Effect.flatMap((version) => openapi.pipe(Command.run({ version }))),
  Effect.provideService(ModuleLoader, { load: (specifier) => import(specifier) }),
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, Digest.layerWebCrypto)),
  NodeRuntime.runMain,
);

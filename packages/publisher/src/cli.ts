#!/usr/bin/env bun
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Layer, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Digest } from "effect/crypto";
import { packRelease, verifyRelease } from "./release.ts";

const pack = Command.make(
  "pack",
  {
    outDir: Flag.String("out-dir").pipe(Flag.withDefault(".release")),
    plan: Flag.String("from-publish-plan").pipe(Flag.optional),
  },
  ({ outDir, plan }) => packRelease({ outDir, plan: Option.getOrUndefined(plan) }),
);

const verify = Command.make(
  "verify",
  {
    directory: Argument.String("directory").pipe(Argument.withDefault(".release")),
    integrityOnly: Flag.Boolean("integrity-only").pipe(Flag.withDefault(false)),
  },
  verifyRelease,
);

Command.make("release-artifacts").pipe(
  Command.withSubcommands([pack, verify]),
  Command.run({ version: "0.0.0" }),
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  Effect.provide(Layer.mergeAll(NodeServices.layer, Digest.layerWebCrypto)),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);

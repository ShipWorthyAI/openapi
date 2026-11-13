import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(NodeServices.layer, Digest.layerWebCrypto),
);

export const execute = Effect.fnUntraced(function* (command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);

  return yield* Effect.all(
    {
      status: child.exitCode,
      stdout: child.stdout.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (text, chunk) => text + chunk,
        ),
      ),
      stderr: child.stderr.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (text, chunk) => text + chunk,
        ),
      ),
    },
    { concurrency: "unbounded" },
  );
}, Effect.scoped);

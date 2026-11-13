import { Console as NodeConsole } from "node:console";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { NodeServices } from "@effect/platform-node";
import { ModuleLoader } from "@shipworthy/openapi-generator";
import {
  Cause,
  Console,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Path,
  Sink,
  Stdio,
  Stream,
} from "effect";
import { Command } from "effect/cli";
import { Digest } from "effect/crypto";
import { FetchHttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { afterAll, type TestContext } from "vitest";
import { openapi } from "../src/cli.ts";
import { version } from "../src/version.ts";

const bin = new URL("../src/bin.ts", import.meta.url).pathname;

const runtime = ManagedRuntime.make(
  Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, Digest.layerWebCrypto),
);

const decoder = new TextDecoder();
afterAll(() => runtime.dispose());

interface CliResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

function capture() {
  let text = "";

  const append = (chunk: string | Uint8Array) => {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk);
  };

  return {
    stream: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        append(chunk);
        callback();
      },
    }),
    sink: Sink.forEach((chunk: string | Uint8Array) => Effect.sync(() => append(chunk))),
    text: () => text,
  };
}

interface RunOptions {
  readonly stdin?: string;
}

const encode = (text: string) => Stream.make(new TextEncoder().encode(text));

/**
 * Runs the `openapi` command in-process, as `bin.ts` would, with relative paths resolved
 * against `cwd` so concurrent tests never depend on the process working directory.
 */
async function runInProcess(
  cwd: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
): Promise<CliResult> {
  const stdout = capture();
  const stderr = capture();

  const program = Effect.gen(function* () {
    const path = yield* Path.Path;

    yield* Command.runWith(openapi, { version: yield* version })(args).pipe(
      Effect.provideService(ModuleLoader, { load: (specifier) => import(specifier) }),
      Effect.provideService(Path.Path, {
        ...path,
        resolve: (...segments) => path.resolve(cwd, ...segments),
      }),
      Effect.provideService(
        Stdio.Stdio,
        Stdio.make({
          args: Effect.succeed(args),
          stdout: () => stdout.sink,
          stderr: () => stderr.sink,
          stdin: options.stdin === undefined ? Stream.empty : encode(options.stdin),
        }),
      ),
      Effect.provideService(Console.Console, new NodeConsole(stdout.stream, stderr.stream)),
    );
  });

  const exit = await runtime.runPromiseExit(program);

  return {
    success: Exit.isSuccess(exit),
    stdout: stdout.text(),
    stderr: Exit.isFailure(exit) ? `${stderr.text()}\n${Cause.pretty(exit.cause)}` : stderr.text(),
  };
}

/** Runs `bin.ts` in a child process, exercising the real entry point and Node runtime. */
async function runProcess(
  cwd: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
): Promise<CliResult> {
  const program = Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const child = yield* spawner.spawn(
      ChildProcess.make("bun", [bin, ...args], {
        cwd,
        stdin: options.stdin === undefined ? "ignore" : encode(options.stdin),
      }),
    );

    const text = (stream: typeof child.stdout) => stream.pipe(Stream.decodeText(), Stream.mkString);

    return yield* Effect.all(
      { exitCode: child.exitCode, stdout: text(child.stdout), stderr: text(child.stderr) },
      { concurrency: "unbounded" },
    );
  }).pipe(Effect.scoped);

  const { exitCode, stdout, stderr } = await runtime.runPromise(program);
  return { success: exitCode === 0, stdout, stderr };
}

/**
 * A temporary working directory, removed when the test finishes, with CLI runners bound to it.
 *
 * Commands run in-process by default. Pass `{ spawn: true }` to run `bin.ts` in a child process.
 */
export function workspace(
  { onTestFinished }: Pick<TestContext, "onTestFinished">,
  { spawn = false }: { readonly spawn?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "openapi-cli-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  const run = (args: ReadonlyArray<string>, options?: RunOptions) =>
    (spawn ? runProcess : runInProcess)(dir, args, options);

  return {
    dir,
    run,
    /** Runs the command, failing the test with its stderr unless it succeeds; returns stdout. */
    ok: async (...args: ReadonlyArray<string>) => {
      const result = await run(args);
      if (!result.success) throw new Error(`openapi ${args.join(" ")} failed:\n${result.stderr}`);
      return result.stdout;
    },
    /** Runs the command, failing the test unless it fails; returns stderr. */
    fails: async (...args: ReadonlyArray<string>) => {
      const result = await run(args);
      if (result.success) throw new Error(`openapi ${args.join(" ")} succeeded:\n${result.stdout}`);
      return result.stderr;
    },
  };
}

/** Serves `handler` on a local port until the test finishes; returns the server's base URL. */
export async function serve(
  { onTestFinished }: Pick<TestContext, "onTestFinished">,
  handler: RequestListener,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a server address");
  return `http://127.0.0.1:${address.port}`;
}

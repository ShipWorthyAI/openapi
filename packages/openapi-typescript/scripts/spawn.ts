declare const Bun: {
  spawn(
    command: string[],
    options: {
      cwd?: string;
      stdin: "ignore" | Uint8Array;
      stdout: "pipe";
      stderr: "pipe";
    },
  ): {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  };
};

export type SpawnOptions = {
  cwd?: string;
  input?: Uint8Array;
  /** When false, keep a single trailing newline from the command output. */
  stripFinalNewline?: boolean;
};

export type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/** Run a command and capture its output. Rejects when the exit code is non-zero. */
export async function spawn(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdin: options.input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const output = [stdout, stderr].filter((part) => part.length > 0).join("");
    throw new Error(output.trim() || `Command failed with exit code ${exitCode}`);
  }

  return {
    stdout: options.stripFinalNewline === false ? stdout : stdout.replace(/\r?\n$/, ""),
    stderr,
    exitCode,
  };
}

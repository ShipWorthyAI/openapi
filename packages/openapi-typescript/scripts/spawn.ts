import { spawn as spawnProcess } from "node:child_process";

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
export function spawn(command: string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const [file, ...args] = command;
  if (!file) return Promise.reject(new Error("Command failed with exit code 1"));

  const child = spawnProcess(file, args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (options.input) child.stdin.end(options.input);
  else child.stdin.end();

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

  return new Promise((resolve, reject) => {
    child.on("error", reject);

    child.on("close", (code) => {
      const exitCode = code ?? 1;
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");

      if (exitCode !== 0) {
        const output = [out, err].filter((part) => part.length > 0).join("");
        reject(new Error(output.trim() || `Command failed with exit code ${exitCode}`));
        return;
      }

      resolve({
        stdout: options.stripFinalNewline === false ? out : out.replace(/\r?\n$/, ""),
        stderr: err,
        exitCode,
      });
    });
  });
}

import { readFile } from "node:fs/promises";
import { Effect, FileSystem, PlatformError } from "effect";

export function nodeFileSystem(): FileSystem.FileSystem {
  return FileSystem.makeNoop({
    readFile(filePath) {
      return Effect.tryPromise({
        try: () => readFile(filePath),
        catch: (cause) =>
          PlatformError.systemError({
            _tag: systemTag(cause),
            module: "FileSystem",
            method: "readFile",
            pathOrDescriptor: filePath,
            cause,
          }),
      }).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
    },
  });
}

function systemTag(cause: unknown): "NotFound" | "PermissionDenied" | "Unknown" {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
  if (code === "ENOENT") return "NotFound";
  if (code === "EACCES" || code === "EPERM") return "PermissionDenied";
  return "Unknown";
}

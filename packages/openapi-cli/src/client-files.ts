import { Console, Effect, FileSystem, Path } from "effect";
import { Argument, Flag } from "effect/unstable/cli";
import { fail, userError } from "./user-error";

const namePattern = /^[a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)*$/;

export function clientFlags() {
  return {
    schema: Argument.String("schema").pipe(
      Argument.withDescription("OpenAPI schema URL or local file."),
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Directory that will contain <name>/types.ts and <name>/client.ts."),
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription(
        "Client name. Used as the output directory and the generated type prefix.",
      ),
    ),
  };
}

export function schemaUrl(input: string) {
  return Effect.gen(function* () {
    if (/^(https?:|file:)/i.test(input)) {
      return new URL(input);
    }
    const path = yield* Path.Path;
    return yield* path.toFileUrl(path.resolve(input)).pipe(Effect.mapError(userError));
  });
}

export function requireClientName(name: string) {
  return Effect.gen(function* () {
    if (!namePattern.test(name)) {
      return yield* fail(
        "--name must start with a letter and contain only letters, numbers, and single hyphen or underscore separators.",
      );
    }
  });
}

export function writeClient(directory: string, name: string, types: string, client: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const output = path.resolve(directory, name);
    yield* fs.makeDirectory(output, { recursive: true }).pipe(Effect.mapError(userError));
    yield* fs
      .writeFileString(path.join(output, "types.ts"), types)
      .pipe(Effect.mapError(userError));
    yield* fs
      .writeFileString(path.join(output, "client.ts"), client)
      .pipe(Effect.mapError(userError));
    yield* Console.log(`Generated ${output}/types.ts and ${output}/client.ts`);
  });
}

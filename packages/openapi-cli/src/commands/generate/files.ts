import { Console, Effect, FileSystem, Path, Schema } from "effect";

export function pascalCase(value: string): string {
  return value.replace(/(?:^|[-_])([a-zA-Z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

export const ClientName = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)*$/, {
      message:
        "--name must start with a letter and contain only letters, numbers, and single hyphen or underscore separators.",
    }),
  ),
);

export const writeGenerated = Effect.fn("writeGenerated")(function* (
  directory: string,
  name: string,
  files: Record<string, string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const output = path.resolve(directory, name);
  yield* fs.makeDirectory(output, { recursive: true });

  yield* Effect.forEach(
    Object.entries(files),
    ([file, contents]) => fs.writeFileString(path.join(output, file), contents),
    { discard: true },
  );

  const written = Object.keys(files).map((file) => `${output}/${file}`);
  yield* Console.log(`Generated ${written.join(", ")}`);
});

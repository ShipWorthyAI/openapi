import { Result, Schema } from "effect";
import { InvalidSchema } from "../../errors.js";
import { child } from "./pointer.js";
import { readEntries } from "./read.js";
import { ParsedSchema } from "../../model/index.js";

const decodeSchema = Schema.decodeUnknownResult(ParsedSchema);

/**
 * The schema at `at`, or `undefined` when there is none. Bundling has already upgraded it to
 * JSON Schema Draft 2020-12. Throws `InvalidSchema` when it is not an object or a boolean.
 */
export function parseSchema(value: unknown, at: string) {
  if (value === undefined || value === null) return undefined;

  return decodeSchema(value).pipe(
    Result.getOrThrowWith((issue) => new InvalidSchema({ message: `${at}: ${issue.message}` })),
  );
}

export function parseSchemaMap(value: unknown, at: string) {
  return Object.fromEntries(
    readEntries(value).flatMap(([key, entry]) => {
      const schema = parseSchema(entry, child(at, key));
      return schema === undefined ? [] : [[key, schema] as const];
    }),
  );
}

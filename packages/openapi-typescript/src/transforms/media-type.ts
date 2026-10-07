import type { ParsedMediaType } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import type ts from "#compiler";
import type { TypegenContext } from "../context.js";
import type { TypegenError } from "../errors.js";
import { refType, UNKNOWN } from "../lib/ts.js";
import { transformSchema } from "./schema.js";

/**
 * Transform a Media Type Object (4.8.14) into the type of its schema.
 * @see https://spec.openapis.org/oas/v3.1.0#media-type-object
 */
export const transformMediaType = Effect.fnUntraced(function* (
  media: ParsedMediaType,
  path: string,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  if (media.schema !== undefined) return yield* transformSchema(media.schema, path);
  // A `$ref` straight to a schema, written in place of the Media Type Object, still names the type.
  if (media.reference) return yield* refType(media.reference.$ref);
  return UNKNOWN;
});

import type { ParsedParameter } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import type ts from "#compiler";
import type { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import { STRING } from "../lib/ts.ts";
import { transformSchema } from "./schema.ts";

/**
 * Transform a Parameter Object (4.8.12) into the type of its value.
 * @see https://spec.openapis.org/oas/v3.1.0#parameter-object
 */
export const transformParameter = Effect.fnUntraced(function* (
  parameter: ParsedParameter,
  path: string,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  // a parameter without a schema is a string, not unknown
  return parameter.schema === undefined ? STRING : yield* transformSchema(parameter.schema, path);
});

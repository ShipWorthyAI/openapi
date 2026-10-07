import type { ParsedOperationResponse } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.js";
import type { TypegenError } from "../errors.js";
import {
  addJSDocComment,
  annotationsOf,
  NEVER,
  refType,
  tsModifiers,
  tsPropertyIndex,
} from "../lib/ts.js";
import { createRef, getEntries } from "../lib/utils.js";
import { transformResponse } from "./response.js";

/**
 * Transform a Responses Object (4.8.16) into a type keyed by status code.
 * @see https://spec.openapis.org/oas/v3.1.0#responses-object
 */
export const transformResponses = Effect.fnUntraced(function* (
  responses: readonly ParsedOperationResponse[],
  path: string,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;
  const type: ts.TypeElement[] = [];
  const byCode = Object.fromEntries(responses.map((response) => [response.code, response]));

  for (const [code, response] of getEntries(byCode, ctx)) {
    const property = ts.factory.createPropertySignature(
      /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
      /* name          */ tsPropertyIndex(code),
      /* questionToken */ undefined,
      /* type          */ response.reference
        ? yield* refType(response.reference.$ref)
        : yield* transformResponse(response, createRef([path, "responses", code])),
    );

    addJSDocComment(annotationsOf(response), property);
    type.push(property);
  }

  return type.length ? ts.factory.createTypeLiteralNode(type) : NEVER;
});

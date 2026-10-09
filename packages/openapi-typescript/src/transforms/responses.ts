import type { ParsedOperationResponse } from "@shipworthy/openapi-transformer";
import { Effect, Record } from "effect";
import ts from "#compiler";
import type { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import { addJSDocComment, annotationsOf, NEVER, refType, tsPropertyIndex } from "../lib/ts.ts";
import { createRef } from "../lib/utils.ts";
import { transformResponse } from "./response.ts";

/**
 * Transform a Responses Object (4.8.16) into a type keyed by status code.
 * @see https://spec.openapis.org/oas/v3.1.0#responses-object
 */
export const transformResponses = Effect.fnUntraced(function* (
  responses: readonly ParsedOperationResponse[],
  path: string,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const byCode = Object.fromEntries(responses.map((response) => [response.code, response]));

  const type = yield* Effect.forEach(
    Record.toEntries(byCode),
    Effect.fnUntraced(function* ([code, response]) {
      const property = ts.factory.createPropertySignature(
        /* modifiers     */ undefined,
        /* name          */ tsPropertyIndex(code),
        /* questionToken */ undefined,
        /* type          */ response.reference
          ? yield* refType(response.reference.$ref)
          : yield* transformResponse(response, createRef([path, "responses", code])),
      );

      addJSDocComment(annotationsOf(response), property);
      return property;
    }),
  );

  return type.length ? ts.factory.createTypeLiteralNode(type) : NEVER;
});

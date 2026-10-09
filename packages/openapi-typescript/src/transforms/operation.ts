import type { ParsedOperation } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import {
  addJSDocComment,
  annotationsOf,
  NEVER,
  QUESTION_TOKEN,
  refType,
  tsModifiers,
  tsPropertyIndex,
} from "../lib/ts.ts";
import { createRef } from "../lib/utils.ts";
import { transformParameters } from "./parameters.ts";
import { transformRequestBody } from "./request-body.ts";
import { transformResponses } from "./responses.ts";

/**
 * Transform an Operation Object (4.8.10) into its `parameters`, `requestBody`, and `responses`.
 * @see https://spec.openapis.org/oas/v3.1.0#operation-object
 */
export const transformOperation = Effect.fnUntraced(function* (
  operation: ParsedOperation,
  path: string,
): Effect.fn.Return<ts.TypeElement[], TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;
  const { request } = operation;

  const parameters = yield* transformParameters(
    [...request.query, ...request.headers, ...request.path, ...request.cookie],
    path,
    operation.path,
  );

  let requestBody: ts.PropertySignature;

  if (request.body) {
    requestBody = ts.factory.createPropertySignature(
      /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
      /* name          */ tsPropertyIndex("requestBody"),
      /* questionToken */ request.body.required ? undefined : QUESTION_TOKEN,
      /* type          */ request.body.reference
        ? yield* refType(request.body.reference.$ref)
        : yield* transformRequestBody(request.body, createRef([path, "requestBody"])),
    );

    addJSDocComment(annotationsOf(request.body), requestBody);
  } else {
    requestBody = ts.factory.createPropertySignature(
      /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
      /* name          */ tsPropertyIndex("requestBody"),
      /* questionToken */ QUESTION_TOKEN,
      /* type          */ NEVER,
    );
  }

  const responses = ts.factory.createPropertySignature(
    /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
    /* name          */ tsPropertyIndex("responses"),
    /* questionToken */ undefined,
    /* type          */ yield* transformResponses(operation.responses, path),
  );

  return [parameters, requestBody, responses];
});

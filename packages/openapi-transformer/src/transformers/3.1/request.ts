import {
  OpenApiRequestBody,
  type OpenApiComponents,
  type OpenApiOperation,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser/schemas/3.1";
import { Array, Effect, Record } from "effect";
import { child, resolve } from "./pointer.ts";
import { readExtensions } from "./extensions.ts";
import type { ParsedRequestBody } from "../../model/index.ts";
import { transformBodyContent } from "./content.ts";

export const transformRequestBody = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiOperation["requestBody"],
  at: string,
) {
  if (value === undefined) return undefined;
  const { value: body, id, reference } = yield* resolve(document, OpenApiRequestBody, value, at);

  return {
    id,
    reference,
    description: reference?.description ?? body.description,
    required: body.required === true,
    contents: yield* transformBodyContent(document, body.content, child(id, "content")),
    extensions: readExtensions(body),
  } satisfies typeof ParsedRequestBody.Encoded;
});

export const transformRequestBodyMap = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiComponents["requestBodies"],
  at: string,
) {
  const entries = yield* Effect.forEach(
    Record.toEntries(value ?? {}),
    Effect.fnUntraced(function* ([key, entry]) {
      const body = yield* transformRequestBody(document, entry, child(at, key));
      return body === undefined ? [] : [[key, body] as const];
    }),
  );

  return Record.fromEntries(Array.flatten(entries));
});

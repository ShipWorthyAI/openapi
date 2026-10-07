import {
  OpenApiLink,
  OpenApiResponse,
  type OpenApiComponents,
  type OpenApiOperation,
  type OpenApiReference,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import { child, resolve } from "./pointer.js";
import { readExtensions } from "./read.js";
import type { ParsedLink, ParsedOperationResponse, ParsedResponse } from "../../model/index.js";
import { transformBodyContent } from "./content.js";
import { transformHeaderList } from "./headers.js";

export const transformLink = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  key: string,
  value: OpenApiLink | OpenApiReference,
  at: string,
) {
  const { value: link, id, reference } = yield* resolve(document, OpenApiLink, value, at);

  return {
    id,
    key,
    reference,
    operationRef: link.operationRef,
    operationId: link.operationId,
    parameters: link.parameters,
    ...("requestBody" in link ? { requestBody: link.requestBody } : {}),
    description: reference?.description ?? link.description,
    extensions: readExtensions(link),
  } satisfies typeof ParsedLink.Encoded;
});

export const transformLinkMap = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiComponents["links"],
  at: string,
) {
  return Object.fromEntries(
    yield* Effect.forEach(
      Object.entries(value ?? {}),
      Effect.fnUntraced(function* ([key, entry]) {
        return [key, yield* transformLink(document, key, entry, child(at, key))] as const;
      }),
    ),
  );
});

export const transformResponse = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiResponse | OpenApiReference,
  at: string,
) {
  const { value: response, id, reference } = yield* resolve(document, OpenApiResponse, value, at);

  return {
    id,
    reference,
    description: reference?.description ?? response.description,
    headers: yield* transformHeaderList(document, response.headers, child(id, "headers")),
    contents: yield* transformBodyContent(document, response.content, child(id, "content")),
    links: Object.values(yield* transformLinkMap(document, response.links, child(id, "links"))),
    extensions: readExtensions(response),
  } satisfies typeof ParsedResponse.Encoded;
});

export const transformResponseMap = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiComponents["responses"],
  at: string,
) {
  return Object.fromEntries(
    yield* Effect.forEach(
      Object.entries(value ?? {}),
      Effect.fnUntraced(function* ([key, entry]) {
        return [key, yield* transformResponse(document, entry, child(at, key))] as const;
      }),
    ),
  );
});

export const transformOperationResponses = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiOperation["responses"],
  at: string,
) {
  const entries = Object.entries(value ?? {}).filter(([code]) => !code.startsWith("x-"));

  return yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* ([code, entry]) {
      const fields = yield* transformResponse(document, entry, child(at, code));
      return { ...fields, code } satisfies typeof ParsedOperationResponse.Encoded;
    }),
  );
});

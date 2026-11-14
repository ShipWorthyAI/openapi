import {
  OpenApiLink,
  OpenApiResponse,
  type OpenApiComponents,
  type OpenApiOperation,
  type OpenApiReference,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser/schemas/3.1";
import { Array, Effect, Record, String } from "effect";
import { child, resolve } from "./pointer.ts";
import { readExtensions } from "./extensions.ts";
import type { ParsedLink, ParsedOperationResponse, ParsedResponse } from "../../model/index.ts";
import { transformBodyContent } from "./content.ts";
import { transformHeaderList } from "./headers.ts";

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
  return Record.fromEntries(
    yield* Effect.forEach(
      Record.toEntries(value ?? {}),
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
    links: Record.values(yield* transformLinkMap(document, response.links, child(id, "links"))),
    extensions: readExtensions(response),
  } satisfies typeof ParsedResponse.Encoded;
});

export const transformResponseMap = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiComponents["responses"],
  at: string,
) {
  return Record.fromEntries(
    yield* Effect.forEach(
      Record.toEntries(value ?? {}),
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
  const entries = Array.filter(
    Record.toEntries(value ?? {}),
    ([code]) => !String.startsWith("x-")(code),
  );

  return yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* ([code, entry]) {
      const fields = yield* transformResponse(document, entry, child(at, code));
      return { ...fields, code } satisfies typeof ParsedOperationResponse.Encoded;
    }),
  );
});

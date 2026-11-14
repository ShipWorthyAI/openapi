import type {
  OpenApiEncoding,
  OpenApiMediaType,
  OpenApiResponse,
  ParsedOpenApi,
} from "@shipworthy/openapi-parser/schemas/3.1";
import { Effect, Record } from "effect";
import { child } from "./pointer.ts";
import { readExtensions } from "./extensions.ts";
import type { ParsedBodyMediaType, ParsedEncoding, ParsedMediaType } from "../../model/index.ts";
import { transformExampleList } from "./examples.ts";
import { transformHeaderList } from "./headers.ts";

const transformEncoding = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  property: string,
  value: OpenApiEncoding,
  at: string,
) {
  return {
    property,
    mediaType: value.contentType,
    style: value.style ?? "form",
    explode: value.explode,
    allowReserved: value.allowReserved,
    headers: yield* transformHeaderList(document, value.headers, child(at, "headers")),
    extensions: readExtensions(value),
  } satisfies typeof ParsedEncoding.Encoded;
});

export const transformMediaType = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  mediaType: string,
  value: OpenApiMediaType,
  at: string,
) {
  return {
    id: at,
    mediaType,
    schema: value.schema,
    examples: yield* transformExampleList(document, value, at),
    extensions: readExtensions(value),
  } satisfies typeof ParsedMediaType.Encoded;
});

export const transformBodyMediaType = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  mediaType: string,
  value: OpenApiMediaType,
  at: string,
) {
  const fields = yield* transformMediaType(document, mediaType, value, at);

  const encodings = yield* Effect.forEach(
    Record.toEntries(value.encoding ?? {}),
    ([property, entry]) =>
      transformEncoding(document, property, entry, child(at, "encoding", property)),
  );

  return { ...fields, encodings } satisfies typeof ParsedBodyMediaType.Encoded;
});

export const transformContent = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiResponse["content"],
  at: string,
) {
  return yield* Effect.forEach(Record.toEntries(value ?? {}), ([mediaType, entry]) =>
    transformMediaType(document, mediaType, entry, child(at, mediaType)),
  );
});

export const transformBodyContent = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiResponse["content"],
  at: string,
) {
  return yield* Effect.forEach(Record.toEntries(value ?? {}), ([mediaType, entry]) =>
    transformBodyMediaType(document, mediaType, entry, child(at, mediaType)),
  );
});

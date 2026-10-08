import {
  OpenApiHeader,
  type OpenApiComponents,
  type OpenApiReference,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser";
import { Effect, type SchemaIssue } from "effect";
import { child, resolve } from "./pointer.js";
import { readExtensions } from "./extensions.js";
import type { ParsedHeader } from "../../model/index.js";
import { transformContent } from "./content.js";
import { transformExampleList } from "./examples.js";

export const transformHeader = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  name: string,
  value: OpenApiHeader | OpenApiReference,
  at: string,
): Effect.fn.Return<typeof ParsedHeader.Encoded, SchemaIssue.Issue> {
  const { value: header, id, reference } = yield* resolve(document, OpenApiHeader, value, at);

  return {
    id,
    name,
    reference,
    style: "simple",
    explode: header.explode,
    required: header.required === true,
    deprecated: header.deprecated === true,
    description: reference?.description ?? header.description,
    schema: header.schema,
    contents: yield* transformContent(document, header.content, child(id, "content")),
    examples: yield* transformExampleList(document, header, id),
    extensions: readExtensions(header),
  } satisfies typeof ParsedHeader.Encoded;
});

export const transformHeaderList = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiComponents["headers"],
  at: string,
) {
  return yield* Effect.forEach(Object.entries(value ?? {}), ([name, entry]) =>
    transformHeader(document, name, entry, child(at, name)),
  );
});

export const transformHeaderMap = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiComponents["headers"],
  at: string,
) {
  const headers = yield* transformHeaderList(document, value, at);
  return Object.fromEntries(headers.map((header) => [header.name, header]));
});

import { Predicate, Schema } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { child, resolve } from "./pointer.js";
import { readEntries, readExtensions, readString } from "./read.js";
import { ParsedRequestBody } from "../../model/index.js";
import { parseBodyContent } from "./content.js";

export function parseRequestBody(document: OpenAPIDocument, value: unknown, at: string) {
  if (value === undefined) return undefined;
  const { value: body, id, reference } = resolve(document, value, at);

  if (!Predicate.isObject(body)) {
    if (reference === undefined) return undefined;

    return Schema.decodeSync(ParsedRequestBody)({
      id,
      reference,
      required: false,
      contents: [],
      extensions: {},
    });
  }

  return Schema.decodeSync(ParsedRequestBody)({
    id,
    reference,
    description: readString(body.description),
    required: body.required === true,
    contents: parseBodyContent(document, body.content, child(id, "content")),
    extensions: readExtensions(body),
  });
}

export function parseRequestBodyMap(document: OpenAPIDocument, value: unknown, at: string) {
  return Object.fromEntries(
    readEntries(value).flatMap(([key, entry]) => {
      const body = parseRequestBody(document, entry, child(at, key));
      return body ? [[key, body] as const] : [];
    }),
  );
}

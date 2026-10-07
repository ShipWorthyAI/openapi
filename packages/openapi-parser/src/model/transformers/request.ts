import { Predicate } from "effect";
import type { OpenAPIDocument } from "../../document.js";
import { resolveLocal } from "../pointer.js";
import { asReference, extensionsOf, text } from "../read.js";
import type { ParsedRequestBody, ParsedRequestBodyValue } from "../types.js";
import { contentsOf } from "./content.js";

export function requestBody(document: OpenAPIDocument, value: unknown): ParsedRequestBody | undefined {
  if (value === undefined) return undefined;
  const body = resolveLocal(document, value);
  if (!Predicate.isObject(body)) return undefined;
  const description = text(body.description);

  return {
    ...(description !== undefined ? { description } : {}),
    required: body.required === true,
    contents: contentsOf(document, body.content),
    extensions: extensionsOf(body),
  };
}

export function requestBodyValue(
  document: OpenAPIDocument,
  value: unknown,
): ParsedRequestBodyValue | undefined {
  const ref = asReference(value);
  if (ref) return ref;
  return requestBody(document, value);
}

export function requestBodyMap(
  document: OpenAPIDocument,
  value: unknown,
): Readonly<Record<string, ParsedRequestBodyValue>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedRequestBodyValue> = {};

  for (const [name, entry] of Object.entries(value)) {
    const body = requestBodyValue(document, entry);
    if (body) record[name] = body;
  }

  return record;
}

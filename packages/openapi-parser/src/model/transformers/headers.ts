import { Predicate } from "effect";
import type { OpenAPIDocument } from "../../document.js";
import { resolveLocal } from "../pointer.js";
import { asReference, extensionsOf, flag, text } from "../read.js";
import type { ParsedHeaderValue } from "../types.js";
import { contentsOf } from "./content.js";
import { examplesOf } from "./examples.js";
import { schemaNode } from "./schemas.js";

export function headerOf(document: OpenAPIDocument, value: unknown): ParsedHeaderValue | undefined {
  const ref = asReference(value);
  if (ref && Predicate.isObject(value) && typeof value.name !== "string") return ref;

  const header = resolveLocal(document, value);
  if (!Predicate.isObject(header)) return undefined;
  const description = text(header.description);
  const style = text(header.style);
  const explode = flag(header.explode);
  const schema = schemaNode(header.schema);
  const example = "example" in header ? header.example : undefined;

  return {
    required: header.required === true,
    deprecated: header.deprecated === true,
    ...(description !== undefined ? { description } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(explode !== undefined ? { explode } : {}),
    ...(schema !== undefined ? { schema } : {}),
    contents: contentsOf(document, header.content),
    ...(example !== undefined ? { example } : {}),
    examples: examplesOf(header),
    extensions: extensionsOf(header),
  };
}

export function headerMap(
  document: OpenAPIDocument,
  value: unknown,
): Readonly<Record<string, ParsedHeaderValue>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedHeaderValue> = {};

  for (const [name, entry] of Object.entries(value)) {
    const header = headerOf(document, entry);
    if (header) record[name] = header;
  }

  return record;
}

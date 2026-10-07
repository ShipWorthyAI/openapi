import { Predicate, Schema } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { child, resolve } from "./pointer.js";
import { readBoolean, readEntries, readExtensions, readString } from "./read.js";
import { ParsedHeader } from "../../model/index.js";
import { parseContent } from "./content.js";
import { parseExampleList } from "./examples.js";
import { parseSchema } from "./schemas.js";

export function parseHeader(document: OpenAPIDocument, name: string, value: unknown, at: string) {
  const { value: header, id, reference } = resolve(document, value, at);

  if (!Predicate.isObject(header)) {
    return Schema.decodeSync(ParsedHeader)({
      id,
      name,
      reference,
      style: "simple",
      required: false,
      deprecated: false,
      contents: [],
      examples: [],
      extensions: {},
    });
  }

  return Schema.decodeSync(ParsedHeader)({
    id,
    name,
    reference,
    style: "simple",
    explode: readBoolean(header.explode),
    required: header.required === true,
    deprecated: header.deprecated === true,
    description: readString(header.description),
    schema: parseSchema(header.schema, child(id, "schema")),
    contents: parseContent(document, header.content, child(id, "content")),
    examples: parseExampleList(document, header, id),
    extensions: readExtensions(header),
  });
}

export function parseHeaderList(document: OpenAPIDocument, value: unknown, at: string) {
  return readEntries(value).map(([name, entry]) =>
    parseHeader(document, name, entry, child(at, name)),
  );
}

export function parseHeaderMap(document: OpenAPIDocument, value: unknown, at: string) {
  return Object.fromEntries(
    parseHeaderList(document, value, at).map((header) => [header.name, header]),
  );
}

import { Predicate } from "effect";
import type { OpenAPIDocument } from "../../document.js";
import { resolveLocal } from "../pointer.js";
import { asReference, extensionsOf, flag, text } from "../read.js";
import type { ParsedEncoding, ParsedMediaType } from "../types.js";
import { examplesOf } from "./examples.js";
import { headerMap } from "./headers.js";
import { schemaNode } from "./schemas.js";

function encodingOf(
  document: OpenAPIDocument,
  property: string,
  value: unknown,
): ParsedEncoding | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const contentType = text(value.contentType);
  const style = text(value.style);
  const explode = flag(value.explode);
  const allowReserved = flag(value.allowReserved);

  return {
    property,
    ...(contentType !== undefined ? { contentType } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(explode !== undefined ? { explode } : {}),
    ...(allowReserved !== undefined ? { allowReserved } : {}),
    headers: headerMap(document, value.headers),
    extensions: extensionsOf(value),
  };
}

export function mediaTypeOf(
  document: OpenAPIDocument,
  mediaType: string,
  value: unknown,
): ParsedMediaType | undefined {
  const ref = asReference(value);
  const media = resolveLocal(document, value);
  if (!Predicate.isObject(media)) return undefined;
  const schema = schemaNode(media.schema);
  const encodings: ParsedEncoding[] = [];

  if (Predicate.isObject(media.encoding)) {
    for (const [property, entry] of Object.entries(media.encoding)) {
      const encoding = encodingOf(document, property, entry);
      if (encoding) encodings.push(encoding);
    }
  }

  return {
    mediaType,
    ...(schema !== undefined ? { schema } : {}),
    ...("example" in media ? { example: media.example } : {}),
    examples: examplesOf(media),
    encodings,
    extensions: extensionsOf(media),
    ...(ref ? { $ref: ref.$ref } : {}),
  };
}

export function contentsOf(document: OpenAPIDocument, value: unknown): readonly ParsedMediaType[] {
  if (!Predicate.isObject(value)) return [];
  const contents: ParsedMediaType[] = [];

  for (const [mediaType, entry] of Object.entries(value)) {
    const media = mediaTypeOf(document, mediaType, entry);
    if (media) contents.push(media);
  }

  return contents;
}

import { Predicate, Schema } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { child, resolve } from "./pointer.js";
import { readBoolean, readEntries, readExtensions, readString } from "./read.js";
import {
  ParamStyle,
  ParsedBodyMediaType,
  ParsedEncoding,
  ParsedMediaType,
} from "../../model/index.js";
import { parseExampleList } from "./examples.js";
import { parseHeaderList } from "./headers.js";
import { parseSchema } from "./schemas.js";

const isParamStyle = Schema.is(ParamStyle);

export function readStyle(value: unknown, fallback: ParamStyle): ParamStyle {
  return isParamStyle(value) ? value : fallback;
}

function parseEncoding(document: OpenAPIDocument, property: string, value: unknown, at: string) {
  if (!Predicate.isObject(value)) return undefined;

  return Schema.decodeSync(ParsedEncoding)({
    property,
    mediaType: readString(value.contentType),
    style: readStyle(value.style, "form"),
    explode: readBoolean(value.explode),
    allowReserved: readBoolean(value.allowReserved),
    headers: parseHeaderList(document, value.headers, child(at, "headers")),
    extensions: readExtensions(value),
  });
}

/** The fields every media type has, with the Media Type Object they came from. */
function mediaTypeFields(document: OpenAPIDocument, mediaType: string, value: unknown, at: string) {
  const { value: media, id, reference } = resolve(document, value, at);
  const source = Predicate.isObject(media) ? media : {};

  return {
    source,
    fields: {
      id,
      mediaType,
      reference,
      schema: parseSchema(source.schema, child(id, "schema")),
      examples: parseExampleList(document, source, id),
      extensions: readExtensions(source),
    },
  };
}

/** A media type of a parameter's or header's `content`. */
export function parseMediaType(
  document: OpenAPIDocument,
  mediaType: string,
  value: unknown,
  at: string,
) {
  return Schema.decodeSync(ParsedMediaType)(mediaTypeFields(document, mediaType, value, at).fields);
}

/** A media type of a request or response body, with its encodings. */
export function parseBodyMediaType(
  document: OpenAPIDocument,
  mediaType: string,
  value: unknown,
  at: string,
) {
  const { source, fields } = mediaTypeFields(document, mediaType, value, at);

  return Schema.decodeSync(ParsedBodyMediaType)({
    ...fields,
    encodings: readEntries(source.encoding).flatMap(([property, entry]) => {
      const encoding = parseEncoding(
        document,
        property,
        entry,
        child(fields.id, "encoding", property),
      );

      return encoding ? [encoding] : [];
    }),
  });
}

/** The `content` of a parameter or header. */
export function parseContent(document: OpenAPIDocument, value: unknown, at: string) {
  return readEntries(value).map(([mediaType, entry]) =>
    parseMediaType(document, mediaType, entry, child(at, mediaType)),
  );
}

/** The `content` of a request or response body. */
export function parseBodyContent(document: OpenAPIDocument, value: unknown, at: string) {
  return readEntries(value).map(([mediaType, entry]) =>
    parseBodyMediaType(document, mediaType, entry, child(at, mediaType)),
  );
}

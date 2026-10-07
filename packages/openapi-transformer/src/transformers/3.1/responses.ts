import { Predicate, Schema } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { child, resolve } from "./pointer.js";
import { readEntries, readExtensions, readString } from "./read.js";
import { ParsedLink, ParsedOperationResponse, ParsedResponse } from "../../model/index.js";
import { parseBodyContent } from "./content.js";
import { parseHeaderList } from "./headers.js";

export function parseLink(document: OpenAPIDocument, key: string, value: unknown, at: string) {
  const { value: link, id, reference } = resolve(document, value, at);

  if (!Predicate.isObject(link)) {
    return Schema.decodeSync(ParsedLink)({ id, key, reference, extensions: {} });
  }

  return Schema.decodeSync(ParsedLink)({
    id,
    key,
    reference,
    operationRef: readString(link.operationRef),
    operationId: readString(link.operationId),
    parameters: Predicate.isObject(link.parameters) ? link.parameters : undefined,
    ...("requestBody" in link ? { requestBody: link.requestBody } : {}),
    description: readString(link.description),
    extensions: readExtensions(link),
  });
}

export function parseLinkMap(document: OpenAPIDocument, value: unknown, at: string) {
  return Object.fromEntries(
    readEntries(value).map(([key, entry]) => [
      key,
      parseLink(document, key, entry, child(at, key)),
    ]),
  );
}

/** The fields of a response, or `undefined` when it is neither a Response Object nor a `$ref`. */
function responseFields(document: OpenAPIDocument, value: unknown, at: string) {
  const { value: response, id, reference } = resolve(document, value, at);

  if (!Predicate.isObject(response)) {
    if (reference === undefined) return undefined;
    return { id, reference, headers: [], contents: [], links: [], extensions: {} };
  }

  return {
    id,
    reference,
    description: readString(response.description),
    headers: parseHeaderList(document, response.headers, child(id, "headers")),
    contents: parseBodyContent(document, response.content, child(id, "content")),
    links: Object.values(parseLinkMap(document, response.links, child(id, "links"))),
    extensions: readExtensions(response),
  };
}

export function parseResponse(document: OpenAPIDocument, value: unknown, at: string) {
  const fields = responseFields(document, value, at);
  return fields && Schema.decodeSync(ParsedResponse)(fields);
}

export function parseResponseMap(document: OpenAPIDocument, value: unknown, at: string) {
  return Object.fromEntries(
    readEntries(value).flatMap(([key, entry]) => {
      const response = parseResponse(document, entry, child(at, key));
      return response ? [[key, response] as const] : [];
    }),
  );
}

/** An operation's responses in key order, `default` included. */
export function parseOperationResponses(document: OpenAPIDocument, value: unknown, at: string) {
  return readEntries(value).flatMap(([code, entry]) => {
    if (code.startsWith("x-")) return [];
    const fields = responseFields(document, entry, child(at, code));
    return fields ? [Schema.decodeSync(ParsedOperationResponse)({ ...fields, code })] : [];
  });
}

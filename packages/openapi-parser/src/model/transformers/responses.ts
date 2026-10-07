import { Predicate } from "effect";
import type { OpenAPIDocument } from "../../document.js";
import { resolveLocal } from "../pointer.js";
import { asReference, extensionsOf, text } from "../read.js";
import type { ParsedLinkValue, ParsedOperationResponse, ParsedRef, ParsedResponse } from "../types.js";
import { contentsOf } from "./content.js";
import { headerMap } from "./headers.js";

function linkOf(value: unknown): ParsedLinkValue | undefined {
  const ref = asReference(value);
  if (ref) return ref;
  if (!Predicate.isObject(value)) return undefined;
  const operationRef = text(value.operationRef);
  const operationId = text(value.operationId);
  const description = text(value.description);

  return {
    ...(operationRef !== undefined ? { operationRef } : {}),
    ...(operationId !== undefined ? { operationId } : {}),
    ...(Predicate.isObject(value.parameters) ? { parameters: value.parameters } : {}),
    ...("requestBody" in value ? { requestBody: value.requestBody } : {}),
    ...(description !== undefined ? { description } : {}),
    extensions: extensionsOf(value),
  };
}

function linksOf(value: unknown): Readonly<Record<string, ParsedLinkValue>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedLinkValue> = {};

  for (const [name, entry] of Object.entries(value)) {
    const link = linkOf(entry);
    if (link) record[name] = link;
  }

  return record;
}

export function responseOf(document: OpenAPIDocument, value: unknown): ParsedResponse | undefined {
  const response = resolveLocal(document, value);
  if (!Predicate.isObject(response)) return undefined;
  const description = text(response.description);

  return {
    ...(description !== undefined ? { description } : {}),
    headers: headerMap(document, response.headers),
    contents: contentsOf(document, response.content),
    links: linksOf(response.links),
    extensions: extensionsOf(response),
  };
}

export function responseMap(
  document: OpenAPIDocument,
  value: unknown,
): Readonly<Record<string, ParsedResponse | ParsedRef>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedResponse | ParsedRef> = {};

  for (const [name, entry] of Object.entries(value)) {
    const ref = asReference(entry);

    if (ref) {
      record[name] = ref;
      continue;
    }

    const response = responseOf(document, entry);
    if (response) record[name] = response;
  }

  return record;
}

export function operationResponses(
  document: OpenAPIDocument,
  value: unknown,
): { responses: ParsedOperationResponse[]; defaultResponse?: ParsedResponse } {
  if (!Predicate.isObject(value)) return { responses: [] };
  const responses: ParsedOperationResponse[] = [];
  let defaultResponse: ParsedResponse | undefined;

  for (const [status, entry] of Object.entries(value)) {
    if (status.startsWith("x-")) continue;
    const response = responseOf(document, entry);
    if (!response) continue;

    if (status === "default") {
      defaultResponse = response;
      continue;
    }

    responses.push({ status, ...response });
  }

  return defaultResponse === undefined ? { responses } : { responses, defaultResponse };
}

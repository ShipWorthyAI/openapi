import { Predicate, Schema } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { child, resolve } from "./pointer.js";
import { parseRef, readBoolean, readEntries, readExtensions, readString } from "./read.js";
import {
  ParameterLocation,
  type ParamStyle,
  ParsedParameter,
  ParsedParameters,
  type ParsedRef,
} from "../../model/index.js";
import { parseContent, readStyle } from "./content.js";
import { parseExampleList } from "./examples.js";
import { parseSchema } from "./schemas.js";

const isParameterLocation = Schema.is(ParameterLocation);

const defaultStyles: Record<ParameterLocation, ParamStyle> = {
  path: "simple",
  query: "form",
  header: "simple",
  cookie: "form",
};

/** A parameter, or `undefined` when it has no name or location, such as a `$ref` that points at nothing. */
export function parseParameter(document: OpenAPIDocument, value: unknown, at: string) {
  const { value: parameter, id, reference } = resolve(document, value, at);
  if (!Predicate.isObject(parameter)) return undefined;
  const name = readString(parameter.name);
  const location = parameter.in;
  if (name === undefined || !isParameterLocation(location)) return undefined;

  return Schema.decodeSync(ParsedParameter)({
    id,
    reference,
    name,
    in: location,
    style: readStyle(parameter.style, defaultStyles[location]),
    explode: readBoolean(parameter.explode),
    required: parameter.required === true || location === "path",
    deprecated: parameter.deprecated === true,
    description: readString(parameter.description),
    allowEmptyValue: readBoolean(parameter.allowEmptyValue),
    allowReserved: readBoolean(parameter.allowReserved),
    schema: parseSchema(parameter.schema, child(id, "schema")),
    contents: parseContent(document, parameter.content, child(id, "content")),
    examples: parseExampleList(document, parameter, id),
    extensions: readExtensions(parameter),
  });
}

/** The parameters of an array, in order. Unresolvable entries are left out. */
export function parseParameterList(document: OpenAPIDocument, value: unknown, at: string) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index) => {
    const parameter = parseParameter(document, entry, child(at, index));
    return parameter ? [parameter] : [];
  });
}

export function parseParameterMap(document: OpenAPIDocument, value: unknown, at: string) {
  return Object.fromEntries(
    readEntries(value).flatMap(([key, entry]) => {
      const parameter = parseParameter(document, entry, child(at, key));
      return parameter ? [[key, parameter] as const] : [];
    }),
  );
}

const groups = { path: "path", query: "query", header: "headers", cookie: "cookie" } as const;

/** Merge path-level and operation-level parameters. A later parameter with the same name and location replaces an earlier one in place. */
export function parseParameters(
  document: OpenAPIDocument,
  sources: readonly (readonly [value: unknown, at: string])[],
) {
  const grouped: Record<(typeof groups)[ParameterLocation], ParsedParameter[]> = {
    path: [],
    query: [],
    headers: [],
    cookie: [],
  };

  const unknown: ParsedRef[] = [];

  for (const [source, at] of sources) {
    if (!Array.isArray(source)) continue;

    source.forEach((entry, index) => {
      const parsed = parseParameter(document, entry, child(at, index));

      if (!parsed) {
        const ref = parseRef(entry);
        if (ref && !unknown.some((item) => item.$ref === ref.$ref)) unknown.push(ref);
        return;
      }

      const list = grouped[groups[parsed.in]];
      const existing = list.findIndex((item) => item.name === parsed.name);
      if (existing >= 0) list[existing] = parsed;
      else list.push(parsed);
    });
  }

  return Schema.decodeSync(ParsedParameters)({ ...grouped, unknown });
}

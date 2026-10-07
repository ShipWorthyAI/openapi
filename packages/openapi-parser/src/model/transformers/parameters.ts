import { Predicate } from "effect";
import type { OpenAPIDocument } from "../../document.js";
import { resolveLocal } from "../pointer.js";
import { asReference, extensionsOf, flag, text } from "../read.js";
import { parameterLocations, type ParameterLocation, type ParsedParameter, type ParsedParameterValue } from "../types.js";
import { contentsOf } from "./content.js";
import { examplesOf } from "./examples.js";
import { schemaNode } from "./schemas.js";

function locationOf(value: unknown): ParameterLocation | undefined {
  return parameterLocations.find((location) => location === value);
}

export function parameterOf(document: OpenAPIDocument, value: unknown): ParsedParameter | undefined {
  const parameter = resolveLocal(document, value);
  if (!Predicate.isObject(parameter)) return undefined;
  const name = text(parameter.name);
  const location = locationOf(parameter.in);
  if (name === undefined || location === undefined) return undefined;
  const description = text(parameter.description);
  const style = text(parameter.style);
  const explode = flag(parameter.explode);
  const allowEmptyValue = flag(parameter.allowEmptyValue);
  const allowReserved = flag(parameter.allowReserved);
  const schema = schemaNode(parameter.schema);

  return {
    name,
    in: location,
    required: parameter.required === true || location === "path",
    deprecated: parameter.deprecated === true,
    ...(description !== undefined ? { description } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(explode !== undefined ? { explode } : {}),
    ...(allowEmptyValue !== undefined ? { allowEmptyValue } : {}),
    ...(allowReserved !== undefined ? { allowReserved } : {}),
    ...(schema !== undefined ? { schema } : {}),
    contents: contentsOf(document, parameter.content),
    ...("example" in parameter ? { example: parameter.example } : {}),
    examples: examplesOf(parameter),
    extensions: extensionsOf(parameter),
  };
}

export function parameterValue(
  document: OpenAPIDocument,
  value: unknown,
): ParsedParameterValue | undefined {
  const ref = asReference(value);
  if (ref) return ref;
  return parameterOf(document, value);
}

export function parameterMap(
  document: OpenAPIDocument,
  value: unknown,
): Readonly<Record<string, ParsedParameterValue>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedParameterValue> = {};

  for (const [name, entry] of Object.entries(value)) {
    const parameter = parameterValue(document, entry);
    if (parameter) record[name] = parameter;
  }

  return record;
}

export function groupParameters(document: OpenAPIDocument, pathLevel: unknown, operationLevel: unknown) {
  const grouped: Record<ParameterLocation, ParsedParameter[]> = {
    path: [],
    query: [],
    header: [],
    cookie: [],
  };

  for (const source of [pathLevel, operationLevel]) {
    if (!Array.isArray(source)) continue;

    for (const entry of source) {
      const parsed = parameterOf(document, entry);
      if (!parsed) continue;
      const list = grouped[parsed.in];
      const index = list.findIndex((item) => item.name === parsed.name);
      if (index >= 0) list[index] = parsed;
      else list.push(parsed);
    }
  }

  return grouped;
}

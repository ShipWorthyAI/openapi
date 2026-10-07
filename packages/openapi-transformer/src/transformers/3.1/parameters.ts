import {
  OpenApiParameter,
  type OpenApiComponents,
  type OpenApiOperation,
  type OpenApiReference,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import { child, resolve } from "./pointer.js";
import { readExtensions } from "./read.js";
import type {
  ParameterLocation,
  ParamStyle,
  ParsedParameter,
  ParsedParameters,
} from "../../model/index.js";
import { transformContent } from "./content.js";
import { transformExampleList } from "./examples.js";

const defaultStyles: Record<ParameterLocation, ParamStyle> = {
  path: "simple",
  query: "form",
  header: "simple",
  cookie: "form",
};

export const transformParameter = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiParameter | OpenApiReference,
  at: string,
) {
  const { value: parameter, id, reference } = yield* resolve(document, OpenApiParameter, value, at);

  return {
    id,
    reference,
    name: parameter.name,
    in: parameter.in,
    style: parameter.style ?? defaultStyles[parameter.in],
    explode: parameter.explode,
    required: parameter.required === true || parameter.in === "path",
    deprecated: parameter.deprecated === true,
    description: reference?.description ?? parameter.description,
    allowEmptyValue: parameter.allowEmptyValue,
    allowReserved: parameter.allowReserved,
    schema: parameter.schema,
    contents: yield* transformContent(document, parameter.content, child(id, "content")),
    examples: yield* transformExampleList(document, parameter, id),
    extensions: readExtensions(parameter),
  } satisfies typeof ParsedParameter.Encoded;
});

export const transformParameterList = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiOperation["parameters"],
  at: string,
) {
  return yield* Effect.forEach(value ?? [], (entry, index) =>
    transformParameter(document, entry, child(at, index)),
  );
});

export const transformParameterMap = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiComponents["parameters"],
  at: string,
) {
  return Object.fromEntries(
    yield* Effect.forEach(
      Object.entries(value ?? {}),
      Effect.fnUntraced(function* ([key, entry]) {
        return [key, yield* transformParameter(document, entry, child(at, key))] as const;
      }),
    ),
  );
});

const groups = { path: "path", query: "query", header: "headers", cookie: "cookie" } as const;

/** Operation parameters replace matching path-item parameters without reordering the group. */
export const transformParameters = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  sources: readonly (readonly [value: OpenApiOperation["parameters"], at: string])[],
) {
  const grouped: Record<(typeof groups)[ParameterLocation], (typeof ParsedParameter.Encoded)[]> = {
    path: [],
    query: [],
    headers: [],
    cookie: [],
  };

  for (const [source, at] of sources) {
    const parameters = yield* transformParameterList(document, source, at);

    for (const parsed of parameters) {
      const list = grouped[groups[parsed.in]];
      const existing = list.findIndex((item) => item.name === parsed.name);
      if (existing >= 0) list[existing] = parsed;
      else list.push(parsed);
    }
  }

  return { ...grouped, unknown: [] } satisfies typeof ParsedParameters.Encoded;
});

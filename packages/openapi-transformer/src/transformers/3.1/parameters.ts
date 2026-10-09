import {
  OpenApiParameter,
  type OpenApiComponents,
  type OpenApiOperation,
  type OpenApiReference,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser/schemas/3.1";
import { Effect } from "effect";
import { child, resolve } from "./pointer.ts";
import { readExtensions } from "./extensions.ts";
import type { ParameterLocation, ParamStyle, ParsedParameter } from "../../model/index.ts";
import { transformContent } from "./content.ts";
import { transformExampleList } from "./examples.ts";

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

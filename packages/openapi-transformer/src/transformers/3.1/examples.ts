import {
  OpenApiExample,
  type OpenApiComponents,
  type OpenApiHeader,
  type OpenApiMediaType,
  type OpenApiParameter,
  type OpenApiReference,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import { child, resolve } from "./pointer.js";
import { readExtensions } from "./extensions.js";
import type { ParsedExample } from "../../model/index.js";

export const transformExample = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  key: string,
  value: OpenApiExample | OpenApiReference,
  at: string,
) {
  const { value: example, id, reference } = yield* resolve(document, OpenApiExample, value, at);

  return {
    id,
    key,
    reference,
    summary: reference?.summary ?? example.summary,
    description: reference?.description ?? example.description,
    ...("value" in example ? { value: example.value } : {}),
    externalValue: example.externalValue,
    extensions: readExtensions(example),
  } satisfies typeof ParsedExample.Encoded;
});

/** The singular example is a value; entries in examples are Example Objects or references. */
export const transformExampleList = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiHeader | OpenApiMediaType | OpenApiParameter,
  at: string,
) {
  const examples: (typeof ParsedExample.Encoded)[] = [];

  if (Object.hasOwn(value, "example")) {
    examples.push({
      id: child(at, "example"),
      key: "default",
      value: value.example,
      extensions: {},
    });
  }

  for (const [key, entry] of Object.entries(value.examples ?? {})) {
    examples.push(yield* transformExample(document, key, entry, child(at, "examples", key)));
  }

  return examples;
});

export const transformExampleMap = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiComponents["examples"],
  at: string,
) {
  return Object.fromEntries(
    yield* Effect.forEach(
      Object.entries(value ?? {}),
      Effect.fnUntraced(function* ([key, entry]) {
        return [key, yield* transformExample(document, key, entry, child(at, key))] as const;
      }),
    ),
  );
});

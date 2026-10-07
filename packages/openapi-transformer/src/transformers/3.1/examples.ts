import { Predicate, Schema } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { child, resolve } from "./pointer.js";
import { readEntries, readExtensions, readString } from "./read.js";
import { ParsedExample } from "../../model/index.js";

export function parseExample(document: OpenAPIDocument, key: string, value: unknown, at: string) {
  const { value: example, id, reference } = resolve(document, value, at);

  if (!Predicate.isObject(example)) {
    return Schema.decodeSync(ParsedExample)({
      id,
      key,
      reference,
      // an example that is not an Example Object is its own value
      ...(reference === undefined ? { value: example } : {}),
      extensions: {},
    });
  }

  return Schema.decodeSync(ParsedExample)({
    id,
    key,
    reference,
    summary: readString(example.summary),
    description: readString(example.description),
    ...("value" in example ? { value: example.value } : {}),
    externalValue: readString(example.externalValue),
    extensions: readExtensions(example),
  });
}

/** The `example` and `examples` of a parameter, header, or media type. `example` is keyed `default`. */
export function parseExampleList(
  document: OpenAPIDocument,
  value: Record<string, unknown>,
  at: string,
) {
  const examples: ParsedExample[] = [];

  if ("example" in value) {
    examples.push(
      Schema.decodeSync(ParsedExample)({
        id: child(at, "example"),
        key: "default",
        value: value.example,
        extensions: {},
      }),
    );
  }

  for (const [key, entry] of readEntries(value.examples)) {
    examples.push(parseExample(document, key, entry, child(at, "examples", key)));
  }

  return examples;
}

export function parseExampleMap(document: OpenAPIDocument, value: unknown, at: string) {
  return Object.fromEntries(
    readEntries(value).map(([key, entry]) => [
      key,
      parseExample(document, key, entry, child(at, key)),
    ]),
  );
}

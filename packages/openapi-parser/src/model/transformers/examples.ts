import { Predicate } from "effect";
import { asReference, extensionsOf, text } from "../read.js";
import type { ParsedExample } from "../types.js";

export function exampleOf(name: string | undefined, value: unknown): ParsedExample {
  const ref = asReference(value);

  if (ref) {
    return {
      ...(name !== undefined ? { name } : {}),
      $ref: ref.$ref,
      ...(ref.summary !== undefined ? { summary: ref.summary } : {}),
      ...(ref.description !== undefined ? { description: ref.description } : {}),
      extensions: Predicate.isObject(value) ? extensionsOf(value) : {},
    };
  }

  if (!Predicate.isObject(value) || (!("value" in value) && !("externalValue" in value))) {
    return {
      ...(name !== undefined ? { name } : {}),
      value,
      extensions: {},
    };
  }

  const summary = text(value.summary);
  const description = text(value.description);
  const externalValue = text(value.externalValue);

  return {
    ...(name !== undefined ? { name } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(description !== undefined ? { description } : {}),
    ...("value" in value ? { value: value.value } : {}),
    ...(externalValue !== undefined ? { externalValue } : {}),
    extensions: extensionsOf(value),
  };
}

export function examplesOf(value: Record<string, unknown>): readonly ParsedExample[] {
  const examples: ParsedExample[] = [];

  if ("example" in value) examples.push(exampleOf("default", value.example));

  if (Predicate.isObject(value.examples)) {
    for (const [name, entry] of Object.entries(value.examples)) {
      examples.push(exampleOf(name, entry));
    }
  }

  return examples;
}

export function exampleMap(value: unknown): Readonly<Record<string, ParsedExample>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedExample> = {};

  for (const [name, entry] of Object.entries(value)) {
    record[name] = exampleOf(name, entry);
  }

  return record;
}

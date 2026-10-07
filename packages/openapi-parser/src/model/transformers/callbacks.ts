import { Predicate } from "effect";
import { pathItem } from "../pointer.js";
import { extensionsOf } from "../read.js";
import type { ParsedCallback } from "../types.js";

export function callbackOf(value: unknown): ParsedCallback | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const expressions: Record<string, ReturnType<typeof pathItem>> = {};

  for (const [expression, entry] of Object.entries(value)) {
    if (expression.startsWith("x-")) continue;
    if (Predicate.isObject(entry)) expressions[expression] = pathItem(entry);
  }

  return { expressions, extensions: extensionsOf(value) };
}

export function callbackMap(value: unknown): Readonly<Record<string, ParsedCallback>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedCallback> = {};

  for (const [name, entry] of Object.entries(value)) {
    const callback = callbackOf(entry);
    if (callback && Object.keys(callback.expressions).length > 0) record[name] = callback;
  }

  return record;
}

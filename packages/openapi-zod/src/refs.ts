import type { ParsedService } from "@shipworthy/openapi-transformer";
import { resolveRef } from "@shipworthy/openapi-typescript";
import { Predicate } from "effect";
import { ZodGenerationError } from "./errors";

/** Follow an internal `$ref` on a parsed document. Boolean `false` is a real schema. */
export function resolveDocumentRef(model: ParsedService, ref: string): unknown {
  const resolved = resolveRef<unknown>(model, ref, { silent: true });

  if (resolved === undefined) {
    throw new ZodGenerationError({ message: `${ref}: Unresolved reference` });
  }

  return resolved;
}

export function resolveObject(model: ParsedService, value: unknown): Record<string, unknown> {
  if (!Predicate.isObject(value)) {
    throw new ZodGenerationError({ message: "Expected an object" });
  }

  if (!Predicate.isString(value.$ref)) return value;
  const resolved = resolveDocumentRef(model, value.$ref);

  if (!Predicate.isObject(resolved)) {
    throw new ZodGenerationError({ message: `${value.$ref}: Unresolved reference` });
  }

  return resolved;
}

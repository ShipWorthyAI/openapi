import { JsonPointer } from "effect";
import { InvalidPointerError, MissingPointerError } from "./errors.js";

const unsafeTokens = new Set(["__proto__", "constructor", "prototype"]);

export function parsePointer(pointer: string, source = pointer): string[] {
  const hash = pointer.includes("#") ? pointer.slice(pointer.indexOf("#")) : pointer;
  if (hash === "" || hash === "#") return [];
  const fragment = hash.startsWith("#") ? hash : `#${hash}`;
  const tokens = JsonPointer.parseUriFragment(fragment);
  if (tokens === undefined) throw new InvalidPointerError(fragment, source);
  return [...tokens];
}

/** Join pointer tokens without percent-encoding, so `$` stays literal. */
export function joinPointer(base: string, tokens: string | readonly string[]): string {
  const parts = typeof tokens === "string" ? [tokens] : tokens;
  let pointer = base.includes("#") ? base : `${base}#`;
  for (const token of parts) pointer += `/${JsonPointer.escapeToken(token)}`;
  return pointer;
}

export function getAt(root: unknown, pointer: string, source = pointer): unknown {
  const tokens = parsePointer(pointer, source);
  let current = root;
  for (const token of tokens) {
    if (current === null || typeof current !== "object") {
      throw new MissingPointerError(token, source, pointer);
    }
    if (!Object.hasOwn(current, token)) throw new MissingPointerError(token, source, pointer);
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

export function setAt(root: object, pointer: string, value: unknown): void {
  const tokens = parsePointer(pointer, pointer);
  if (tokens.length === 0 || tokens.some((token) => unsafeTokens.has(token))) return;
  let current = root as Record<string, unknown>;
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index]!;
    const next = current[token];
    if (next === null || typeof next !== "object" || Array.isArray(next)) current[token] = {};
    current = current[token] as Record<string, unknown>;
  }
  current[tokens[tokens.length - 1]!] = value;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Copy enumerable data, including cycles, and drop non-enumerable parser symbols. */
export function cloneData(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (typeof value !== "object" || value === null) return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneData(item, seen));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = cloneData((value as Record<string, unknown>)[key], seen);
  return copy;
}

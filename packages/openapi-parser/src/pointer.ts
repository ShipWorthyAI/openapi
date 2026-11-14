import {
  Array as Arr,
  JsonPointer,
  Option,
  pipe,
  Predicate,
  Record as Rec,
  String as Str,
} from "effect";
import { invalidPointerFailure, missingPointerFailure } from "./errors.ts";

const unsafeTokens = new Set(["__proto__", "constructor", "prototype"]);

export function parsePointer(pointer: string, source = pointer): string[] {
  const hash = pipe(
    pointer,
    Str.indexOf("#"),
    Option.match({ onNone: () => pointer, onSome: (index) => Str.slice(index)(pointer) }),
  );

  if (hash === "" || hash === "#") return [];
  const fragment = Str.startsWith("#")(hash) ? hash : `#${hash}`;
  const tokens = JsonPointer.parseUriFragment(fragment) ?? splitPointer(fragment);
  if (tokens === undefined) throw invalidPointerFailure(fragment, source);
  return [...tokens];
}

/** Effect's URI-fragment parser rejects spaces. JSON Pointer tokens may contain them. */
function splitPointer(fragment: string): string[] | undefined {
  const body = Str.startsWith("#")(fragment) ? Str.slice(1)(fragment) : fragment;
  if (body === "") return [];
  if (!Str.startsWith("/")(body)) return undefined;

  return pipe(
    body,
    Str.slice(1),
    Str.split("/"),
    Arr.map((token) => pipe(token, Str.replace(/~1/g, "/"), Str.replace(/~0/g, "~"))),
  );
}

/** Join pointer tokens without percent-encoding, so `$` stays literal. */
export function joinPointer(base: string, tokens: string | readonly string[]): string {
  const parts = typeof tokens === "string" ? [tokens] : tokens;
  let pointer = Str.includes("#")(base) ? base : `${base}#`;
  for (const token of parts) pointer += `/${JsonPointer.escapeToken(token)}`;
  return pointer;
}

const arrayIndex = /^(?:0|[1-9]\d*)$/;

/** Reads the member or array element that a JSON Pointer token names (RFC 6901). */
export function childAt(value: unknown, token: string): Option.Option<unknown> {
  if (Arr.isArray(value)) {
    return arrayIndex.test(token) ? Arr.get(value, Number(token)) : Option.none();
  }

  return Predicate.isObject(value) ? Rec.get(value, token) : Option.none();
}

export function getAt(root: unknown, pointer: string, source = pointer): unknown {
  const tokens = parsePointer(pointer, source);
  let current = root;

  for (const token of tokens) {
    const child = childAt(current, token);
    if (Option.isNone(child)) throw missingPointerFailure(token, source, pointer);
    current = child.value;
  }

  return current;
}

export function setAt(root: object, pointer: string, value: unknown): void {
  const tokens = parsePointer(pointer, pointer);
  if (tokens.length === 0 || Arr.some(tokens, (token) => unsafeTokens.has(token))) return;
  let current = root as Record<string, unknown>;

  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index]!;
    const next = current[token];
    if (!Predicate.isObject(next)) current[token] = {};
    current = current[token] as Record<string, unknown>;
  }

  current[tokens[tokens.length - 1]!] = value;
}

/** Copy enumerable data, including cycles, and drop non-enumerable parser symbols. */
export function cloneData(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (!Predicate.isObjectOrArray(value)) return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;

  if (Arr.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneData(item, seen));
    return copy;
  }

  const source: Record<string, unknown> = value;
  const copy: Record<string, unknown> = {};
  seen.set(source, copy);
  for (const key of Rec.keys(source)) copy[key] = cloneData(source[key], seen);
  return copy;
}

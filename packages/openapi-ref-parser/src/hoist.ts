import { MissingPointerError } from "./errors.js";
import type { BundleHooks } from "./plugins.js";
import { asRecord, cloneData, getAt, joinPointer, parsePointer, setAt } from "./pointer.js";
import { getHash, isFileSystemPath, isHttp, stripHash } from "./url.js";

const MAX_ATTEMPTS = 1000;

type NameBucket = { taken: Set<string>; generated: Map<string, string | null> };

export interface ExternalRef {
  parent: Record<string, unknown>;
  key: string;
  ref: string;
  pointer: string;
}

export function findExternalRef(
  root: unknown,
  keep: (ref: string) => boolean,
  abandoned: ReadonlySet<string> = new Set(),
): ExternalRef | undefined {
  const stack: Array<{ node: unknown; pointer: string; parent?: Record<string, unknown>; key?: string }> = [
    { node: root, pointer: "#" },
  ];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (typeof current.node !== "object" || current.node === null) continue;
    if (seen.has(current.node)) continue;
    seen.add(current.node);
    if (Array.isArray(current.node)) {
      for (let index = current.node.length - 1; index >= 0; index--) {
        stack.push({
          node: current.node[index],
          pointer: joinPointer(current.pointer, String(index)),
          parent: current.node as unknown as Record<string, unknown>,
          key: String(index),
        });
      }
      continue;
    }
    const record = current.node as Record<string, unknown>;
    if (
      current.parent &&
      current.key &&
      typeof record.$ref === "string" &&
      !record.$ref.startsWith("#") &&
      !keep(record.$ref) &&
      !abandoned.has(current.pointer)
    ) {
      return { parent: current.parent, key: current.key, ref: record.$ref, pointer: current.pointer };
    }
    const keys = Object.keys(record);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!;
      stack.push({
        node: record[key],
        pointer: joinPointer(current.pointer, key),
        parent: record,
        key,
      });
    }
  }
  return undefined;
}

export function hoistExternalRefs(
  root: Record<string, unknown>,
  readValue: (ref: string) => unknown,
  hooks: BundleHooks | undefined,
  keep: (ref: string) => boolean,
): Map<string, string> {
  const placed = new Map<string, string>();
  const buckets = new Map<string, NameBucket>();
  const abandoned = new Set<string>();
  for (let pass = 0; pass < MAX_ATTEMPTS; pass++) {
    const found = findExternalRef(root, keep, abandoned);
    if (!found) {
      collapseRefChains(root);
      return placed;
    }
    const url = stripHash(found.ref);
    const hash = getHash(found.ref);
    const placeKey = `${url}${hash}`;
    if (readValue(url) === undefined) {
      abandoned.add(found.pointer);
      continue;
    }
    const existing = placed.get(placeKey) ?? placedPrefix(placed, url, hash);
    if (existing) {
      rewriteRef(found, existing, hooks);
      continue;
    }
    const value = cloneData(valueAt(readValue(url), hash, found.ref));
    rebaseInternalRefs(value, url);
    const target = generateKey(root, url, hash, found.pointer, buckets);
    if (target) {
      setAt(root, target, value);
      placed.set(placeKey, target);
      rewriteRef(found, target, hooks);
    } else {
      inlineRef(found, value, hooks);
      placed.set(placeKey, found.pointer);
    }
  }
  throw new Error("Could not finish bundling external references.");
}

function placedPrefix(placed: Map<string, string>, url: string, hash: string): string | undefined {
  let best = "";
  let pointer: string | undefined;
  for (const [key, value] of placed) {
    if (!key.startsWith(url)) continue;
    const candidate = key.slice(url.length);
    const isPrefix = candidate === "#" ? hash.startsWith("#/") : hash.startsWith(`${candidate}/`);
    if (!isPrefix || candidate.length < best.length) continue;
    best = candidate;
    const suffix = candidate === "#" ? hash : `#${hash.slice(candidate.length)}`;
    pointer = joinPointer(value, parsePointer(suffix));
  }
  return pointer;
}

function valueAt(document: unknown, hash: string, ref: string): unknown {
  if (hash === "#") return document;
  return getAt(document, hash, ref);
}

function rebaseInternalRefs(value: unknown, fileUrl: string, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) rebaseInternalRefs(item, fileUrl, seen);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.$ref === "string" && record.$ref.startsWith("#")) record.$ref = `${fileUrl}${record.$ref}`;
  for (const child of Object.values(record)) rebaseInternalRefs(child, fileUrl, seen);
}

function collapseRefChains(root: Record<string, unknown>): void {
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    const visit = (value: unknown, seen = new Set<object>()) => {
      if (typeof value !== "object" || value === null || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const item of value) visit(item, seen);
        return;
      }
      const record = value as Record<string, unknown>;
      if (typeof record.$ref === "string" && record.$ref.startsWith("#") && Object.keys(record).length === 1) {
        try {
          const target = asRecord(getAt(root, record.$ref, record.$ref));
          if (target && typeof target.$ref === "string" && Object.keys(target).length === 1 && target.$ref !== record.$ref) {
            record.$ref = target.$ref;
            changed = true;
          }
        } catch (error) {
          if (!(error instanceof MissingPointerError)) throw error;
        }
      }
      for (const child of Object.values(record)) visit(child, seen);
    };
    visit(root);
    if (!changed) return;
  }
}

function rewriteRef(found: ExternalRef, pointer: string, hooks: BundleHooks | undefined): void {
  const current = found.parent[found.key];
  const record = asRecord(current);
  if (!record) return;
  record.$ref = pointer;
  hooks?.onBundle?.(pointer, record, found.parent, found.key);
}

function inlineRef(found: ExternalRef, value: unknown, hooks: BundleHooks | undefined): void {
  const current = asRecord(found.parent[found.key]);
  const siblings = { ...(current ?? {}) };
  delete siblings.$ref;
  if (Object.keys(siblings).length === 0) {
    found.parent[found.key] = value;
  } else if (oas3DefaultRoot(found.pointer) === "#/components/schemas" || found.pointer.includes("/schema")) {
    found.parent[found.key] = { allOf: [value, siblings] };
  } else if (asRecord(value)) {
    found.parent[found.key] = { ...asRecord(value), ...siblings };
  } else {
    found.parent[found.key] = value;
  }
  hooks?.onBundle?.(found.ref, found.parent[found.key], found.parent, found.key);
}

function generateKey(
  schema: object,
  file: string,
  hash: string,
  pathFromRoot: string,
  buckets: Map<string, NameBucket>,
): string | null {
  if (!isOpenApiDocument(schema)) return null;
  const root = oas3DefaultRoot(pathFromRoot);
  if (!root) return null;
  if (!isFileSystemPath(file) && !isHttp(file) && !file.includes("://")) return null;
  if (hash === "#" && isUnderDirectRoot(pathFromRoot, root)) return null;
  if (hash !== "#") {
    if (isUnderDirectRoot(hash, root) || !isInRoot(hash, root)) {
      const token = pointerTokens(hash).at(-1);
      if (!token) return null;
      return register(schema, root, `${file}${hash}`, suggest(bucket(schema, root, buckets).taken, token), buckets);
    }
    const filePointer = keyForFile(schema, file, root, buckets);
    if (filePointer == null) return null;
    return keyForPointer(schema, filePointer + hash.slice(1), root, buckets);
  }
  return keyForFile(schema, file, root, buckets);
}

function isOpenApiDocument(schema: object): boolean {
  return typeof (schema as { openapi?: unknown }).openapi === "string";
}

export function oas3DefaultRoot(pathFromRoot: string): string | null {
  const path = pathFromRoot.split("/");
  if (canReferenceParameter(path)) return "#/components/parameters";
  if (canReferenceResponse(path)) return "#/components/responses";
  if (canReferenceRequestBody(path)) return "#/components/requestBodies";
  if (canReferenceHeader(path)) return "#/components/headers";
  if (canReferenceExample(path)) return "#/components/examples";
  if (canReferenceSecurityScheme(path)) return "#/components/securitySchemes";
  if (canReferenceLink(path)) return "#/components/links";
  if (canReferenceCallback(path)) return "#/components/callbacks";
  if (canReferenceSchema(path)) return "#/components/schemas";
  return null;
}

function canReferenceSchema(path: string[]): boolean {
  return (
    (path.length > 3 && path[1] === "paths" && path.includes("schema")) ||
    (path[1] === "components" && path[2] === "schemas")
  );
}

function canReferenceParameter(path: string[]): boolean {
  return (
    (path.length === 5 && path[1] === "paths" && path[3] === "parameters") ||
    (path.length === 6 && path[1] === "paths" && path[4] === "parameters")
  );
}

function canReferenceResponse(path: string[]): boolean {
  return path.length === 6 && path[1] === "paths" && path[4] === "responses";
}

function canReferenceRequestBody(path: string[]): boolean {
  return path.length === 5 && path[1] === "paths" && path[4] === "requestBody";
}

function canReferenceHeader(path: string[]): boolean {
  return path.length === 8 && path[1] === "paths" && path[4] === "responses" && path[6] === "headers";
}

function canReferenceExample(path: string[]): boolean {
  return (path[1] === "components" && path[2] === "examples") || (path[1] === "paths" && path.includes("examples"));
}

function canReferenceSecurityScheme(path: string[]): boolean {
  return path[1] === "components" && path[2] === "securitySchemes";
}

function canReferenceLink(path: string[]): boolean {
  return (path[1] === "components" && path[2] === "links") || (path[1] === "paths" && path.includes("links"));
}

function canReferenceCallback(path: string[]): boolean {
  return (path[1] === "components" && path[2] === "callbacks") || (path[1] === "paths" && path.includes("callbacks"));
}

function isUnderDirectRoot(pathFromRoot: string, root: string): boolean {
  const pointer = pointerTokens(pathFromRoot);
  const rootTokens = pointerTokens(root);
  return pointer.length === rootTokens.length + 1 && rootTokens.every((token, index) => pointer[index] === token);
}

function isInRoot(pointer: string, root: string): boolean {
  const pointerTokens_ = pointerTokens(pointer);
  const rootTokens = pointerTokens(root);
  return pointerTokens_.length > rootTokens.length && rootTokens.every((token, index) => pointerTokens_[index] === token);
}

function pointerTokens(pointer: string): string[] {
  if (!pointer.startsWith("#")) return [];
  try {
    return parsePointer(pointer);
  } catch {
    return [];
  }
}

function keyForFile(schema: object, file: string, root: string, buckets: Map<string, NameBucket>): string | null {
  const names = bucket(schema, root, buckets);
  if (names.generated.has(file)) return names.generated.get(file) ?? null;
  const base = prettify(fileBaseName(file));
  if (!base) return register(schema, root, file, null, buckets);
  return register(schema, root, file, suggest(names.taken, base), buckets);
}

function keyForPointer(schema: object, pointer: string, root: string, buckets: Map<string, NameBucket>): string | null {
  const names = bucket(schema, root, buckets);
  if (names.generated.has(pointer)) return names.generated.get(pointer) ?? null;
  const fragment = `${root.slice(1)}/`;
  const actualPath = pointer.split(fragment).slice(1);
  const base = prettify(actualPath.join("/"));
  if (!base) return register(schema, root, pointer, null, buckets);
  return register(schema, root, pointer, suggest(names.taken, base), buckets);
}

function register(
  schema: object,
  root: string,
  id: string,
  key: string | null,
  buckets: Map<string, NameBucket>,
): string | null {
  const names = bucket(schema, root, buckets);
  if (key === null) {
    names.generated.set(id, null);
    return null;
  }
  names.taken.add(key);
  const pointer = joinPointer(root, key);
  names.generated.set(id, pointer);
  return pointer;
}

function bucket(schema: object, root: string, buckets: Map<string, NameBucket>): NameBucket {
  const id = `${root}`;
  const existing = buckets.get(id);
  if (existing) return existing;
  const taken = new Set<string>();
  const value = valueAtSafe(schema, root);
  if (asRecord(value)) {
    for (const key of Object.keys(value as object)) taken.add(key);
  }
  const created = { taken, generated: new Map<string, string | null>() };
  buckets.set(id, created);
  return created;
}

function valueAtSafe(root: object, pointer: string): unknown {
  try {
    return getAt(root, pointer);
  } catch (error) {
    if (error instanceof MissingPointerError) return undefined;
    throw error;
  }
}

function suggest(taken: Set<string>, key: string): string {
  if (!taken.has(key)) return key;
  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = `${key}_${attempt}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not generate a unique component name for ${key}.`);
}

function prettify(key: string): string {
  const pretty = key.replace(/(?:\.|[\\/]+)([a-z])?/g, (_match, letter: string | undefined, index: number) => {
    if (letter === undefined) return index === 0 ? "" : "_";
    return `_${letter.toUpperCase()}`;
  });
  if (!pretty) return pretty;
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

function fileBaseName(file: string): string {
  let pathname = file;
  if (file.includes("://")) {
    try {
      pathname = decodeURIComponent(new URL(file).pathname);
    } catch {
      pathname = file;
    }
  }
  const slash = Math.max(pathname.lastIndexOf("/"), pathname.lastIndexOf("\\"));
  const base = slash >= 0 ? pathname.slice(slash + 1) : pathname;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

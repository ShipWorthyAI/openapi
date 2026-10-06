import { Cache, Effect } from "effect";
import {
  GroupFailure,
  JSONParserError,
  MissingPointerError,
  toPublicError,
  type TaggedFailure,
} from "./errors.js";
import { hoistExternalRefs } from "./hoist.js";
import { loadDocument, makeContext, provideFileSystem } from "./loader.js";
import { normalizeArguments, type Options } from "./plugins.js";
import { asRecord, cloneData, joinPointer, parsePointer } from "./pointer.js";
import { inlineRemaining, runSchemaPipeline } from "./pipeline.js";
import { isOpenApi3, upgradeOpenApi3_0 } from "./upgraders/openapi-3_0.js";
import { getHash, isHttp, normalizeRef, resolveAgainst, stripHash } from "./url.js";

export interface RunResult {
  schema: unknown;
  documents: Map<string, unknown>;
}

export async function run(mode: "parse" | "resolve" | "bundle" | "dereference", args: unknown[]): Promise<unknown> {
  const errors: JSONParserError[] = [];
  const program = execute(mode, normalizeArguments(args), errors).pipe(
    Effect.mapError((error) => toPublicError(error, errors)),
  );
  return Effect.runPromise(provideFileSystem(program)).then((result) => result.schema);
}

export async function runDetailed(
  mode: "parse" | "resolve" | "bundle" | "dereference",
  args: unknown[],
): Promise<RunResult> {
  const errors: JSONParserError[] = [];
  const program = execute(mode, normalizeArguments(args), errors).pipe(
    Effect.mapError((error) => toPublicError(error, errors)),
  );
  return Effect.runPromise(provideFileSystem(program));
}

const execute = Effect.fnUntraced(function* (
  mode: "parse" | "resolve" | "bundle" | "dereference",
  args: { path: string; schema: unknown; options: Options },
  errors: JSONParserError[],
) {
  const options = args.options;
  const rootUrl = normalizeRef(args.path);
  const context = makeContext(rootUrl, options);
  const cache = yield* Cache.make({
    capacity: 10_000,
    lookup: (url: string) =>
      loadDocument(url, context).pipe(Effect.withSpan("openapi-ref-parser.load", { attributes: { url } })),
  });
  const documents = new Map<string, unknown>();
  const rootKey = stripHash(rootUrl);
  const root =
    args.schema === undefined
      ? yield* loadCaught(cache, rootKey, options, errors)
      : cloneSchema(args.schema);
  if (root === undefined) {
    return yield* failCollected(rootUrl, errors);
  }
  documents.set(rootKey, root);
  if (mode === "parse") return { schema: root, documents };

  const kept = new Set<string>();
  const ids = new Map<string, object>();
  const keep = (ref: string) => Boolean(options.keepUrlRefs && isHttp(ref));
  if (typeof root === "object" && root !== null) absolutize(root, rootUrl, ids, keep, kept);
  yield* loadClosure(root, cache, documents, ids, keep, kept, options, errors);
  if (errors.length > 0 && options.continueOnError) return yield* failCollected(rootUrl, errors);
  if (mode === "resolve") return { schema: root, documents };
  if (typeof root !== "object" || root === null || Array.isArray(root)) return { schema: root, documents };

  const record = root as Record<string, unknown>;
  const placed = hoistExternalRefs(
    record,
    (url) => documents.get(stripHash(url)),
    options.bundle,
    (ref) => kept.has(ref) || ids.has(stripHash(ref)),
  );
  rewriteIdRefs(record, ids);
  rewriteMappings(record, placed, ids);
  if (isOpenApi3(record)) {
    upgradeOpenApi3_0(record);
    runSchemaPipeline(record, mode === "dereference" ? "dereference" : "bundle", options.dereference);
  } else if (mode === "dereference") {
    inlineRemaining(record, new Set(), options.dereference);
  }
  yield* inlineExternalValues(record, cache, rootUrl, keep, kept, options, errors);
  if (errors.length > 0) return yield* failCollected(rootUrl, errors);
  return { schema: root, documents };
});

function failCollected(source: string, errors: JSONParserError[]): Effect.Effect<never, GroupFailure> {
  return Effect.fail(new GroupFailure({ source, messages: errors.map((error) => error.message).join("\n") }));
}

function cloneSchema(schema: unknown): unknown {
  return cloneData(schema);
}

const loadCaught = Effect.fnUntraced(function* (
  cache: Cache.Cache<string, unknown, TaggedFailure>,
  url: string,
  options: Options,
  errors: JSONParserError[],
) {
  return yield* Cache.get(cache, url).pipe(
    Effect.catch((error: TaggedFailure) => {
      const publicError = toPublicError(error);
      if (!options.continueOnError) return Effect.fail(error);
      if (publicError instanceof JSONParserError) errors.push(publicError);
      return Effect.succeed(undefined);
    }),
  );
});

const loadClosure = Effect.fnUntraced(function* (
  root: unknown,
  cache: Cache.Cache<string, unknown, TaggedFailure>,
  documents: Map<string, unknown>,
  ids: Map<string, object>,
  keep: (ref: string) => boolean,
  kept: Set<string>,
  options: Options,
  errors: JSONParserError[],
) {
  const pending = new Set<string>();
  for (let pass = 0; pass < 1000; pass++) {
    pending.clear();
    for (const ref of externalRefs(root, kept)) {
      const url = stripHash(ref);
      if (ids.has(url) || documents.has(url) || kept.has(ref)) continue;
      pending.add(url);
    }
    for (const document of documents.values()) {
      for (const ref of externalRefs(document, kept)) {
        const url = stripHash(ref);
        if (ids.has(url) || documents.has(url) || kept.has(ref)) continue;
        pending.add(url);
      }
    }
    if (pending.size === 0) return;
    for (const url of pending) {
      const loaded = yield* loadCaught(cache, url, options, errors);
      if (loaded === undefined) continue;
      absolutize(loaded, url, ids, keep, kept);
      documents.set(url, loaded);
    }
    if (errors.length > 0 && !options.continueOnError) return;
  }
});

function* externalRefs(node: unknown, kept: Set<string>): Generator<string> {
  const seen = new Set<object>();
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (typeof record.$ref === "string" && !record.$ref.startsWith("#") && !kept.has(record.$ref)) yield record.$ref;
    if (typeof record.externalValue === "string" && !kept.has(record.externalValue)) yield record.externalValue;
    stack.push(...Object.values(record));
  }
}

function absolutize(
  node: unknown,
  base: string,
  ids: Map<string, object>,
  keep: (ref: string) => boolean,
  kept: Set<string>,
  seen = new Set<object>(),
): void {
  if (typeof node !== "object" || node === null || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) absolutize(item, base, ids, keep, kept, seen);
    return;
  }
  const record = node as Record<string, unknown>;
  let next = base;
  if (typeof record.$id === "string") {
    next = resolveAgainst(base, record.$id);
    ids.set(stripHash(next), record);
  }
  if (typeof record.$ref === "string" && !record.$ref.startsWith("#")) {
    if (keep(record.$ref)) kept.add(record.$ref);
    else record.$ref = resolveAgainst(base, record.$ref);
  }
  const mapping = asRecord(asRecord(record.discriminator)?.mapping);
  if (mapping) {
    for (const [key, value] of Object.entries(mapping)) {
      if (typeof value !== "string" || value.startsWith("#")) continue;
      if (keep(value)) kept.add(value);
      else mapping[key] = resolveAgainst(base, value);
    }
  }
  if (typeof record.externalValue === "string") {
    if (keep(record.externalValue)) kept.add(record.externalValue);
    else record.externalValue = resolveAgainst(base, record.externalValue);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "$ref" || key === "$id") continue;
    absolutize(value, next, ids, keep, kept, seen);
  }
}

function rewriteIdRefs(root: Record<string, unknown>, ids: Map<string, object>): void {
  const pointers = new Map<string, string>();
  for (const [url, node] of ids) {
    const pointer = findPointer(root, node);
    if (pointer) pointers.set(url, pointer);
  }
  walkRecords(root, (record) => {
    if (typeof record.$ref !== "string" || record.$ref.startsWith("#")) return;
    const url = stripHash(record.$ref);
    const pointer = pointers.get(url);
    if (!pointer) return;
    const hash = getHash(record.$ref);
    if (hash === "#") {
      record.$ref = pointer;
      return;
    }
    const tokens = parsePointer(hash, record.$ref);
    if (tokens[0] === "$defs" && tokens.length === 2) record.$ref = joinPointer("#/$defs", tokens[1]!);
    else record.$ref = joinPointer(pointer, tokens);
  });
}

function rewriteMappings(root: Record<string, unknown>, placed: Map<string, string>, ids: Map<string, object>): void {
  const idPointers = new Map<string, string>();
  for (const [url, node] of ids) {
    const pointer = findPointer(root, node);
    if (pointer) idPointers.set(url, pointer);
  }
  walkRecords(root, (record) => {
    const mapping = asRecord(asRecord(record.discriminator)?.mapping);
    if (!mapping) return;
    for (const [key, value] of Object.entries(mapping)) {
      if (typeof value !== "string" || value.startsWith("#")) continue;
      const url = stripHash(value);
      const hash = getHash(value);
      const target = placed.get(`${url}${hash}`) ?? idPointers.get(url);
      if (target) mapping[key] = hash === "#" || placed.has(`${url}${hash}`) ? target : joinPointer(target, parsePointer(hash));
    }
  });
}

function findPointer(root: unknown, target: object, pointer = "#", seen = new Set<object>()): string | undefined {
  if (root === target) return pointer;
  if (typeof root !== "object" || root === null || seen.has(root)) return undefined;
  seen.add(root);
  if (Array.isArray(root)) {
    for (let index = 0; index < root.length; index++) {
      const found = findPointer(root[index], target, joinPointer(pointer, String(index)), seen);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(root)) {
    const found = findPointer(value, target, joinPointer(pointer, key), seen);
    if (found) return found;
  }
  return undefined;
}

function walkRecords(node: unknown, visit: (record: Record<string, unknown>) => void, seen = new Set<object>()): void {
  if (typeof node !== "object" || node === null || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) walkRecords(item, visit, seen);
    return;
  }
  const record = node as Record<string, unknown>;
  visit(record);
  for (const value of Object.values(record)) walkRecords(value, visit, seen);
}

const inlineExternalValues = Effect.fnUntraced(function* (
  root: Record<string, unknown>,
  cache: Cache.Cache<string, unknown, TaggedFailure>,
  rootUrl: string,
  keep: (ref: string) => boolean,
  kept: Set<string>,
  options: Options,
  errors: JSONParserError[],
) {
  const pending: Record<string, unknown>[] = [];
  walkRecords(root, (record) => {
    if (typeof record.externalValue === "string" && record.value === undefined) pending.push(record);
  });
  for (const record of pending) {
    const externalValue = record.externalValue;
    if (typeof externalValue !== "string") continue;
    if (kept.has(externalValue) || keep(externalValue)) continue;
    const loaded = yield* loadCaught(cache, stripHash(externalValue), options, errors);
    if (loaded === undefined) continue;
    const hash = getHash(externalValue);
    try {
      record.value = hash === "#" ? loaded : valueAt(loaded, hash);
    } catch (error) {
      if (error instanceof MissingPointerError) {
        if (!options.continueOnError) throw error;
        errors.push(error);
        continue;
      }
      throw error;
    }
    delete record.externalValue;
  }
});

function valueAt(document: unknown, hash: string): unknown {
  const tokens = parsePointer(hash);
  let current = document;
  for (const token of tokens) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, token)) {
      throw new MissingPointerError(token, hash);
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

import { Array, Cache, Effect, FileSystem, Predicate, Ref, Schema } from "effect";
import type { HttpClient } from "effect/http";
import {
  ParserFailure,
  groupFailure,
  isLeafFailure,
  missingPointerFailure,
  syncFailure,
  type LeafFailure,
  type TaggedFailure,
} from "./errors.ts";
import { hoistExternalRefs } from "./hoist.ts";
import { loadDocument, makeContext } from "./loader.ts";
import { Options } from "./plugins.ts";
import { cloneData, joinPointer, parsePointer } from "./pointer.ts";
import { inlineRemaining, runSchemaPipeline } from "./pipeline.ts";
import { isOpenApi3, upgradeOpenApi3_0 } from "./upgraders/3.0-to-3.1.ts";
import { getHash, isHttp, normalizeRef, resolveAgainst, stripHash } from "./url.ts";

interface RunResult {
  schema: unknown;
  documents: Map<string, unknown>;
}

const loadConcurrency = 8;

type RunMode = "parse" | "bundle" | "dereference";

interface RunRequest {
  readonly path: string;
  readonly schema?: unknown;
  readonly options?: Options;
  readonly mode?: RunMode;
}

export const runEffect = Effect.fn("openapi-parser.run")(function* (
  args: RunRequest,
): Effect.fn.Return<RunResult, TaggedFailure, FileSystem.FileSystem | HttpClient.HttpClient> {
  const mode = args.mode ?? "bundle";

  const options = yield* Schema.decodeEffect(Options)(args.options ?? {}).pipe(
    Effect.mapError(
      (cause) => new ParserFailure({ message: cause.message, source: args.path, cause }),
    ),
  );

  const rootUrl = yield* normalizeRef(args.path);
  const context = makeContext(rootUrl, options);
  const failures = yield* Ref.make<Array<LeafFailure>>([]);
  const recorded = new Set<string>();

  const cache = yield* Cache.make({
    capacity: 10_000,
    lookup: (url: string) =>
      loadDocument(url, context).pipe(
        Effect.withSpan("openapi-parser.load", { attributes: { url } }),
      ),
  });

  const documents = new Map<string, unknown>();
  const rootKey = stripHash(rootUrl);

  const root =
    args.schema === undefined
      ? yield* loadCaught(cache, rootKey, options, failures, recorded)
      : cloneData(args.schema);

  if (root === undefined) return yield* failCollected(rootUrl, failures);

  documents.set(rootKey, root);
  if (mode === "parse") return { schema: root, documents };

  const kept = new Set<string>();
  const ids = new Map<string, object>();
  const keep = (ref: string) => Boolean(options.keepUrlRefs && isHttp(ref));
  if (typeof root === "object" && root !== null) absolutize(root, rootUrl, ids, keep, kept);
  yield* loadClosure(root, cache, documents, ids, keep, kept, options, failures, recorded);

  const collected = yield* Ref.get(failures);
  if (collected.length > 0 && options.continueOnError)
    return yield* failCollected(rootUrl, failures);
  if (typeof root !== "object" || root === null || Array.isArray(root))
    return { schema: root, documents };

  const record = root as Record<string, unknown>;

  yield* Effect.try({
    try: () => {
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

        runSchemaPipeline(
          record,
          mode === "dereference" ? "dereference" : "bundle",
          options.dereference,
        );
      } else if (mode === "dereference") {
        inlineRemaining(record, new Set(), options.dereference);
      }
    },
    catch: syncFailure,
  });

  yield* inlineExternalValues(record, cache, keep, kept, options, failures, recorded);
  if ((yield* Ref.get(failures)).length > 0) return yield* failCollected(rootUrl, failures);
  return { schema: root, documents };
});

const failCollected = Effect.fnUntraced(function* (
  source: string,
  failures: Ref.Ref<Array<LeafFailure>>,
) {
  return yield* Ref.get(failures).pipe(
    Effect.flatMap((errors) => Effect.fail(groupFailure(source, errors))),
  );
});

const loadCaught = Effect.fnUntraced(function* (
  cache: Cache.Cache<string, unknown, TaggedFailure>,
  url: string,
  options: Options,
  failures: Ref.Ref<Array<LeafFailure>>,
  recorded: Set<string>,
) {
  return yield* Cache.get(cache, url).pipe(
    Effect.catch((error: TaggedFailure) => {
      if (!options.continueOnError || !isLeafFailure(error)) return Effect.fail(error);
      if (recorded.has(url)) return Effect.void;
      recorded.add(url);
      return Ref.update(failures, (list) => [...list, error]).pipe(Effect.asVoid);
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
  failures: Ref.Ref<Array<LeafFailure>>,
  recorded: Set<string>,
) {
  const pending = new Set<string>();

  let pass = 0;
  let remaining = true;

  yield* Effect.whileLoop({
    while: () => pass < 1000 && remaining,
    body: () =>
      Effect.gen(function* () {
        pending.clear();

        Array.forEach([root, ...documents.values()], (document) => {
          Array.forEach(Array.fromIterable(externalRefs(document, kept)), (ref) => {
            const url = stripHash(ref);
            if (!ids.has(url) && !documents.has(url) && !kept.has(ref) && !recorded.has(url))
              pending.add(url);
          });
        });

        if (pending.size === 0) return false;

        yield* Effect.forEach(
          pending,
          Effect.fnUntraced(function* (url) {
            const loaded = yield* loadCaught(cache, url, options, failures, recorded);
            if (loaded === undefined) return;
            absolutize(loaded, url, ids, keep, kept);
            documents.set(url, loaded);
          }),
          { concurrency: loadConcurrency, discard: true },
        );

        return true;
      }),
    step: (more) => {
      remaining = more;
      pass++;
    },
  });
});

const referenceKeys = new Set(["$ref", "summary", "description"]);

/** HTTP `$ref` fields inside example payloads are data, not OpenAPI references. */
function isBundledRef(record: Record<string, unknown>): boolean {
  const ref = record.$ref;
  if (typeof ref !== "string" || !isHttp(ref)) return true;
  return Object.keys(record).every((key) => referenceKeys.has(key));
}

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

    if (
      typeof record.$ref === "string" &&
      !record.$ref.startsWith("#") &&
      !kept.has(record.$ref) &&
      isBundledRef(record)
    ) {
      yield record.$ref;
    }

    if (typeof record.externalValue === "string" && !kept.has(record.externalValue))
      yield record.externalValue;
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

  const discriminator = record.discriminator;

  const mapping =
    Predicate.isObject(discriminator) && Predicate.isObject(discriminator.mapping)
      ? discriminator.mapping
      : undefined;

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
    if (tokens[0] === "$defs" && tokens.length === 2)
      record.$ref = joinPointer("#/$defs", tokens[1]!);
    else record.$ref = joinPointer(pointer, tokens);
  });
}

function rewriteMappings(
  root: Record<string, unknown>,
  placed: Map<string, string>,
  ids: Map<string, object>,
): void {
  const idPointers = new Map<string, string>();

  for (const [url, node] of ids) {
    const pointer = findPointer(root, node);
    if (pointer) idPointers.set(url, pointer);
  }

  walkRecords(root, (record) => {
    const discriminator = record.discriminator;

    const mapping =
      Predicate.isObject(discriminator) && Predicate.isObject(discriminator.mapping)
        ? discriminator.mapping
        : undefined;

    if (!mapping) return;

    for (const [key, value] of Object.entries(mapping)) {
      if (typeof value !== "string" || value.startsWith("#")) continue;
      const url = stripHash(value);
      const hash = getHash(value);
      const target = placed.get(`${url}${hash}`) ?? idPointers.get(url);
      if (target)
        mapping[key] =
          hash === "#" || placed.has(`${url}${hash}`)
            ? target
            : joinPointer(target, parsePointer(hash));
    }
  });
}

function findPointer(
  root: unknown,
  target: object,
  pointer = "#",
  seen = new Set<object>(),
): string | undefined {
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

function walkRecords(
  node: unknown,
  visit: (record: Record<string, unknown>) => void,
  seen = new Set<object>(),
): void {
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
  keep: (ref: string) => boolean,
  kept: Set<string>,
  options: Options,
  failures: Ref.Ref<Array<LeafFailure>>,
  recorded: Set<string>,
) {
  const pending: Record<string, unknown>[] = [];

  walkRecords(root, (record) => {
    if (typeof record.externalValue === "string" && record.value === undefined)
      pending.push(record);
  });

  yield* Effect.forEach(
    pending,
    (record) =>
      Effect.gen(function* () {
        const externalValue = record.externalValue;
        if (typeof externalValue !== "string") return;
        if (kept.has(externalValue) || keep(externalValue)) return;

        const loaded = yield* loadCaught(
          cache,
          stripHash(externalValue),
          options,
          failures,
          recorded,
        );

        if (loaded === undefined) return;
        const hash = getHash(externalValue);

        const resolved = yield* Effect.try({
          try: () => ({ value: hash === "#" ? loaded : valueAt(loaded, hash) }),
          catch: syncFailure,
        }).pipe(
          Effect.catchIf(
            (error): error is LeafFailure =>
              options.continueOnError === true && isLeafFailure(error),
            (error) => Ref.update(failures, (list) => [...list, error]).pipe(Effect.asVoid),
          ),
        );

        if (!resolved) return;
        record.value = resolved.value;
        delete record.externalValue;
      }),
    { concurrency: loadConcurrency, discard: true },
  );
});

function valueAt(document: unknown, hash: string): unknown {
  const tokens = parsePointer(hash);
  let current = document;

  for (const token of tokens) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, token)) {
      throw missingPointerFailure(token, hash);
    }

    current = (current as Record<string, unknown>)[token];
  }

  return current;
}

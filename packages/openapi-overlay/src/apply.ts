import { Effect, Predicate, Schema } from "effect";
import * as Yaml from "effect/encoding/Yaml";
import { exec, type Path } from "jsonpath-rfc9535";
import { OverlayError } from "./errors.ts";
import { Overlay, type OverlayAction } from "./schemas.ts";

const parseInput = Effect.fnUntraced(function* (input: unknown, label: string) {
  if (typeof input !== "string") return input;

  return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(input).pipe(
    Effect.catch(() =>
      Effect.try({
        try: () => Yaml.parse(input),
        catch: (cause) =>
          new OverlayError({ message: `Invalid ${label}: ${String(cause)}`, cause }),
      }),
    ),
  );
});

function cloneObject(value: Schema.JsonObject): Schema.MutableJsonObject {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function clone(value: Schema.Json): Schema.MutableJson {
  if (Array.isArray(value)) return value.map(clone);
  if (Predicate.isObject(value)) return cloneObject(value as Schema.JsonObject);
  return value as Schema.MutableJson;
}

function kind(value: Schema.Json): "array" | "object" | "primitive" {
  if (Array.isArray(value)) return "array";
  return Predicate.isObject(value) ? "object" : "primitive";
}

function merge(
  target: Schema.MutableJson,
  update: Schema.Json,
  append = false,
): Schema.MutableJson {
  if (Array.isArray(target)) {
    if (!Array.isArray(update) && !append) throw new TypeError("Incompatible array property");
    const items = Array.isArray(update) ? update : [update];

    for (const item of items) target.push(clone(item));
    return target;
  }

  if (Predicate.isObject(target)) {
    if (kind(update) !== "object")
      throw new TypeError("An object target requires an object update");
    const object = target as Schema.MutableJsonObject;

    for (const [key, value] of Object.entries(update as Schema.JsonObject)) {
      const next = Object.hasOwn(object, key) ? merge(object[key]!, value) : clone(value);

      Object.defineProperty(target, key, {
        value: next,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    return target;
  }

  if (kind(update) !== "primitive")
    throw new TypeError("A primitive target requires a primitive update");
  return clone(update);
}

interface Node {
  readonly value: Schema.MutableJson;
  readonly path: Path;
  readonly parent: Schema.MutableJsonObject | Schema.MutableJsonArray | undefined;
  readonly key: string | number | undefined;
}

function select(document: Schema.MutableJsonObject, expression: string): Node[] {
  const nodes: Node[] = [];

  exec(document, expression, (value, path) => {
    let parent: Schema.MutableJson = document;

    for (const key of path.slice(0, -1)) {
      parent = Array.isArray(parent)
        ? parent[Number(key)]!
        : (parent as Schema.MutableJsonObject)[key]!;
    }

    nodes.push({
      value,
      path: [...path],
      parent: path.length === 0 ? undefined : (parent as Node["parent"]),
      key: path.at(-1),
    });
  });

  return nodes;
}

function uniqueNodes(nodes: Node[]): Node[] {
  return [...new Map(nodes.map((node) => [JSON.stringify(node.path), node])).values()];
}

function remove(nodes: Node[]): void {
  if (nodes.some((node) => node.parent === undefined)) {
    throw new TypeError("Cannot remove the document root, which has no containing map or array");
  }

  // Descendants first; descending array indexes preserve the original selection.
  const ordered = uniqueNodes(nodes).sort(
    (left, right) =>
      right.path.length - left.path.length ||
      (typeof left.key === "number" && typeof right.key === "number"
        ? right.key - left.key
        : typeof left.key === "number"
          ? -1
          : typeof right.key === "number"
            ? 1
            : 0),
  );

  for (const { parent, key } of ordered) {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else if (parent !== undefined && key !== undefined) delete parent[key];
  }
}

function applyAction(
  document: Schema.MutableJsonObject,
  action: OverlayAction,
  version: string,
): void {
  if (version !== "1.0" && version !== "1.1") {
    throw new TypeError(`Overlay ${version} action behavior is not implemented`);
  }

  const nodes = select(document, action.target);

  if (nodes.length === 0) return;

  if (version === "1.0" && nodes.some((node) => kind(node.value) === "primitive")) {
    throw new TypeError("Overlay 1.0 targets must select objects or arrays, not primitives");
  }

  if (action.remove === true) {
    remove(nodes);
    return;
  }

  const hasUpdate = Object.hasOwn(action, "update");
  const copy = version === "1.1" && typeof action.copy === "string" ? action.copy : undefined;

  if (hasUpdate && copy !== undefined) {
    throw new TypeError("An action cannot contain both update and copy");
  }

  if (!hasUpdate && copy === undefined) return;

  if (version === "1.1" && new Set(nodes.map((node) => kind(node.value))).size > 1) {
    throw new TypeError(
      "All selected nodes must be objects, arrays, or primitives of the same category",
    );
  }

  let update = action.update;

  if (copy !== undefined) {
    const sources = select(document, copy);

    if (sources.length !== 1) throw new TypeError("copy must select exactly one source node");
    update = clone(sources[0]!.value);
  }

  for (const node of uniqueNodes(nodes)) {
    if (version === "1.0" && Array.isArray(node.value)) {
      node.value.push(clone(update!));
      continue;
    }

    const value = merge(node.value, update!, true);

    if (Array.isArray(node.parent)) node.parent[Number(node.key)] = value;
    else if (node.parent !== undefined && node.key !== undefined) {
      Object.defineProperty(node.parent, node.key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
}

/** Apply version-specific Overlay actions to a JSON/YAML document or object without mutating inputs. */
export const applyOverlay = Effect.fn("applyOverlay")(function* (
  document: unknown,
  overlay: unknown,
): Effect.fn.Return<Schema.MutableJsonObject, OverlayError> {
  const source = yield* Schema.decodeUnknownEffect(Schema.JsonObject)(
    yield* parseInput(document, "document"),
  ).pipe(
    Effect.mapError(
      (cause) => new OverlayError({ message: `Invalid document: ${cause.message}`, cause }),
    ),
  );

  const parsed = yield* Schema.decodeUnknownEffect(Overlay)(yield* parseInput(overlay, "overlay"), {
    onExcessProperty: "error",
  }).pipe(
    Effect.mapError(
      (cause) => new OverlayError({ message: `Invalid overlay: ${cause.message}`, cause }),
    ),
  );

  const result = cloneObject(source);
  const version = parsed.overlay.split(".").slice(0, 2).join(".");

  yield* Effect.forEach(
    parsed.actions,
    (action, index) =>
      Effect.try({
        try: () => applyAction(result, action, version),
        catch: (cause) =>
          new OverlayError({
            message: `Overlay action ${index + 1} (${action.target}): ${String(cause)}`,
            action: index + 1,
            target: action.target,
            cause,
          }),
      }),
    { discard: true },
  );

  return result;
});

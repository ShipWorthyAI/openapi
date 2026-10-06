import type { BundleOptions } from "../options.js";
import Pointer from "../pointer.js";
import { isFileSystemPath, isHttp } from "../util/url.js";

const MAX_ATTEMPTS = 1000;

type NameBucket = {
  taken: Set<string>;
  generated: Map<string, string | null>;
};

const bucketsBySchema = new WeakMap<object, Map<string, NameBucket>>();

/**
 * Bundle options that hoist external OpenAPI 3 references into `#/components/*`.
 * Generic `bundle()` is unchanged unless the caller passes these options.
 */
export function oas3BundleOptions(): Pick<BundleOptions, "defaultRoot" | "generateKey"> {
  return {
    defaultRoot: oas3DefaultRoot,
    generateKey(schema, file, hash, pathFromRoot) {
      const root = oas3DefaultRoot(pathFromRoot);
      if (!root) return null;
      if (!isFileSystemPath(file) && !isHttp(file)) return null;
      // A component slot that references an entire external file already has its name.
      if (hash === "#" && isUnderDirectRoot(pathFromRoot, root)) return null;

      if (hash !== "#") {
        if (isUnderDirectRoot(hash, root) || !isInRoot(hash, root)) {
          const token = pointerTokensOf(hash).at(-1);
          if (!token) return null;
          return register(schema, root, `${file}${hash}`, suggest(bucketFor(schema, root).taken, token));
        }
        const filePointer = keyForFile(schema, file, root);
        if (filePointer == null) return null;
        return keyForPointer(schema, filePointer + hash.slice(1), root);
      }

      return keyForFile(schema, file, root);
    },
  };
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
  const pointerTokens = pointerTokensOf(pathFromRoot);
  const rootTokens = pointerTokensOf(root);
  return pointerTokens.length === rootTokens.length + 1 && startsWith(pointerTokens, rootTokens);
}

function isInRoot(pointer: string, root: string): boolean {
  const pointerTokens = pointerTokensOf(pointer);
  const rootTokens = pointerTokensOf(root);
  return pointerTokens.length > rootTokens.length && startsWith(pointerTokens, rootTokens);
}

function startsWith(value: string[], prefix: string[]): boolean {
  return prefix.every((token, index) => value[index] === token);
}

function pointerTokensOf(pointer: string): string[] {
  if (!pointer.startsWith("#")) return [];
  try {
    return Pointer.parse(pointer);
  } catch {
    return [];
  }
}

function keyForFile(schema: object, file: string, root: string): string | null {
  const bucket = bucketFor(schema, root);
  if (bucket.generated.has(file)) return bucket.generated.get(file) ?? null;
  const base = prettify(fileBaseName(file));
  if (!base) return register(schema, root, file, null);
  return register(schema, root, file, suggest(bucket.taken, base));
}

function keyForPointer(schema: object, pointer: string, root: string): string | null {
  const bucket = bucketFor(schema, root);
  if (bucket.generated.has(pointer)) return bucket.generated.get(pointer) ?? null;
  const fragment = `${root.slice(1)}/`;
  const actualPath = pointer.split(fragment).slice(1);
  const base = prettify(actualPath.join("/"));
  if (!base) return register(schema, root, pointer, null);
  return register(schema, root, pointer, suggest(bucket.taken, base));
}

function register(schema: object, root: string, id: string, key: string | null): string | null {
  const bucket = bucketFor(schema, root);
  if (key === null) {
    bucket.generated.set(id, null);
    return null;
  }
  bucket.taken.add(key);
  const pointer = Pointer.join(root, key);
  bucket.generated.set(id, pointer);
  return pointer;
}

function bucketFor(schema: object, root: string): NameBucket {
  let roots = bucketsBySchema.get(schema);
  if (!roots) {
    roots = new Map();
    bucketsBySchema.set(schema, roots);
  }
  let bucket = roots.get(root);
  if (!bucket) {
    const taken = new Set<string>();
    const existing = valueAt(schema, root);
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      for (const key of Object.keys(existing)) taken.add(key);
    }
    bucket = { taken, generated: new Map() };
    roots.set(root, bucket);
  }
  return bucket;
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

function valueAt(root: object, pointer: string): unknown {
  let current: unknown = root;
  for (const token of pointerTokensOf(pointer)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

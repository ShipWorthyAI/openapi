import path from "node:path";
import { fileURLToPath } from "node:url";
import { $RefParser, oas3BundleOptions, type BundleOptions } from "@shipworthy/json-schema-ref-parser";

const MAPPING_REFS = "x-shipworthy-mapping-refs";

export interface BundleProblem {
  message: string;
  severity: "error" | "warn";
}

export interface BundleResult {
  bundle: { parsed: unknown };
  problems: BundleProblem[];
}

export interface BundleInput {
  ref?: string;
  doc?: { parsed: unknown; source?: { absoluteRef?: string } };
  dereference?: boolean;
  keepUrlRefs?: boolean;
  base?: string | null;
}

export function makeDocumentFromString(source: string, absoluteRef: string) {
  return {
    source: { absoluteRef },
    parsed: JSON.parse(source) as unknown,
  };
}

export async function bundle(opts: BundleInput): Promise<BundleResult> {
  const absoluteRef = opts.ref ?? opts.doc?.source?.absoluteRef ?? opts.base ?? "/";
  const parsed = opts.doc?.parsed;
  if (!opts.ref && parsed === undefined) {
    throw new Error("Document or reference is required.\n");
  }

  try {
    const options = parserOptions(Boolean(opts.keepUrlRefs), absoluteRef);
    const source = parsed === undefined ? await $RefParser.parse(absoluteRef, options) : parsed;
    const input = source && typeof source === "object" ? structuredClone(source) : source;
    if (input && typeof input === "object" && !opts.dereference) attachDiscriminatorRefs(input);
    const bundled = opts.dereference
      ? await $RefParser.dereference(absoluteRef, input, options)
      : await $RefParser.bundle(absoluteRef, input, options);

    if (bundled && typeof bundled === "object") {
      if (!opts.dereference) restoreDiscriminatorMappings(bundled);
      await inlineExternalValues(bundled, absoluteRef, Boolean(opts.keepUrlRefs));
    }

    return { bundle: { parsed: bundled }, problems: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { bundle: { parsed: undefined }, problems: [{ message, severity: "error" }] };
  }
}

export async function bundleFromString(opts: {
  source: string;
  absoluteRef?: string;
  dereference?: boolean;
  keepUrlRefs?: boolean;
}): Promise<BundleResult> {
  return bundle({
    doc: makeDocumentFromString(opts.source, opts.absoluteRef || "/"),
    dereference: opts.dereference,
    keepUrlRefs: opts.keepUrlRefs,
  });
}

export async function bundleDocument(opts: BundleInput): Promise<BundleResult> {
  return bundle(opts);
}

function parserOptions(keepUrlRefs: boolean, absoluteRef: string) {
  const bundleOptions: BundleOptions = { ...oas3BundleOptions() };
  if (keepUrlRefs) {
    bundleOptions.excludedPathMatcher = (_pointer, value) => {
      if (!value || typeof value !== "object" || !("$ref" in value)) return false;
      const ref = (value as { $ref?: unknown }).$ref;
      return typeof ref === "string" && /^https?:\/\//.test(ref);
    };
  }
  const origin = httpOrigin(absoluteRef);
  return {
    bundle: bundleOptions,
    ...(origin ? { resolve: { http: { allowedOrigins: [origin] } } } : {}),
  };
}

function httpOrigin(absoluteRef: string): string | undefined {
  try {
    const parsed = new URL(absoluteRef);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function attachDiscriminatorRefs(node: unknown, seen = new Set<object>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) attachDiscriminatorRefs(item, seen);
    return;
  }
  const record = node as Record<string, unknown>;
  const discriminator = record.discriminator;
  if (discriminator && typeof discriminator === "object" && !Array.isArray(discriminator)) {
    const mapping = (discriminator as { mapping?: unknown }).mapping;
    if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
      const refs: Record<string, { $ref: string }> = {};
      for (const [name, value] of Object.entries(mapping)) {
        if (typeof value === "string") refs[name] = { $ref: value };
      }
      record[MAPPING_REFS] = refs;
    }
  }
  for (const value of Object.values(record)) attachDiscriminatorRefs(value, seen);
}

function restoreDiscriminatorMappings(node: unknown, seen = new Set<object>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) restoreDiscriminatorMappings(item, seen);
    return;
  }
  const record = node as Record<string, unknown>;
  const refs = record[MAPPING_REFS];
  const discriminator = record.discriminator;
  if (
    refs &&
    typeof refs === "object" &&
    !Array.isArray(refs) &&
    discriminator &&
    typeof discriminator === "object" &&
    !Array.isArray(discriminator)
  ) {
    const mapping = ((discriminator as { mapping?: Record<string, string> }).mapping ??= {});
    for (const [name, value] of Object.entries(refs)) {
      if (value && typeof value === "object" && typeof (value as { $ref?: unknown }).$ref === "string") {
        mapping[name] = (value as { $ref: string }).$ref;
      }
    }
    delete record[MAPPING_REFS];
  }
  for (const value of Object.values(record)) {
    if (value !== refs) restoreDiscriminatorMappings(value, seen);
  }
}

async function inlineExternalValues(root: unknown, base: string, keepUrlRefs: boolean) {
  const pending: Record<string, unknown>[] = [];
  collectExternalValues(root, pending, new Set());
  for (const node of pending) {
    const externalValue = node.externalValue;
    if (typeof externalValue !== "string" || node.value !== undefined) continue;
    if (keepUrlRefs && /^https?:\/\//.test(externalValue)) continue;
    node.value = await $RefParser.parse(resolveAgainst(base, externalValue));
    delete node.externalValue;
  }
}

function collectExternalValues(node: unknown, pending: Record<string, unknown>[], seen: Set<object>) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) collectExternalValues(item, pending, seen);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.externalValue === "string") pending.push(record);
  for (const value of Object.values(record)) collectExternalValues(value, pending, seen);
}

function resolveAgainst(base: string, ref: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref;
  if (/^https?:\/\//.test(base)) return new URL(ref, base).href;
  const file = base.startsWith("file:") ? fileURLToPath(base) : base;
  return path.resolve(path.dirname(file), ref);
}

import { bundle as bundleRefs, dereference as dereferenceRefs } from "@shipworthy/openapi-ref-parser";

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
    const options = { keepUrlRefs: Boolean(opts.keepUrlRefs) };
    const bundled = opts.dereference
      ? await dereferenceRefs(absoluteRef, parsed, options)
      : await bundleRefs(absoluteRef, parsed, options);
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

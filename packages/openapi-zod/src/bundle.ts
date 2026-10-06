import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundle, makeDocumentFromString } from "@shipworthy/openapi-core";
import type { OpenAPI3 } from "@shipworthy/openapi-typescript";

/**
 * Bundle external `$ref`s into one document without dereferencing them.
 * Zod generation keeps component `$ref`s so each validator can include only the
 * definitions it uses. Pass a file or http(s) URL when the document references
 * other files; an in-memory document is parsed as JSON.
 */
export async function bundleOpenApi(source: URL | OpenAPI3): Promise<OpenAPI3> {
  const result = await bundle({
    dereference: false,
    ...(source instanceof URL
      ? { ref: source.protocol === "file:" ? fileURLToPath(source.href) : source.href }
      : {
          doc: makeDocumentFromString(
            JSON.stringify(source),
            pathToFileURL(resolve("openapi.json")).href,
          ),
        }),
  });
  const problem = result.problems.find((entry) => entry.severity === "error");
  if (problem) throw new Error(problem.message);
  const parsed = result.bundle.parsed;
  if (!parsed || typeof parsed !== "object") throw new Error("Bundled schema is empty");
  return parsed as OpenAPI3;
}

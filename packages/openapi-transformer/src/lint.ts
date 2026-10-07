import { Document, Spectral, type RulesetDefinition } from "@stoplight/spectral-core";
import { oas3 } from "@stoplight/spectral-formats";
import { Json, Yaml } from "@stoplight/spectral-parsers";
import { oas } from "@stoplight/spectral-rulesets";
import type { LoadedDocument } from "@shipworthy/openapi-parser";
import c from "ansi-colors";
import { Effect } from "effect";
import supportsColor from "supports-color";
import { LintError } from "./errors.js";

if (!supportsColor.stdout || supportsColor.stdout.hasBasic === false) c.enabled = false;

const spectral = new Spectral();
spectral.setRuleset({
  extends: [oas as unknown as RulesetDefinition],
  formats: [oas3],
  parserOptions: {
    // OpenAPI status codes are YAML numbers (`200:`). Spectral's parser can flag that.
    incompatibleValues: "off",
  },
  rules: spectralRules(),
});

function spectralRules(): Record<string, "off" | "warn" | "error"> {
  const rules: Record<string, "off" | "warn" | "error"> = {
    // Partial documents and versions such as "3.1" are valid generator input.
    "oas3-schema": "off",
  };
  for (const [id, rule] of Object.entries(oas.rules ?? {})) {
    if (id === "operation-operationId-unique") continue;
    if (rule && typeof rule === "object" && "severity" in rule && rule.severity === 0) {
      rules[id] = "warn";
    }
  }
  return rules;
}

export function error(message: string) {
  console.error(c.red(` ✘  ${message}`));
}

export function warn(message: string, silent = false) {
  if (!silent) console.warn(c.yellow(` ⚠  ${message}`));
}

function isExampleRefRead(result: { code: unknown; message: string; path: readonly unknown[] }): boolean {
  return result.code === "invalid-ref" && result.message.startsWith("ReadError:") && result.path.includes("examples");
}

function spectralTarget(document: LoadedDocument) {
  if (!document.sourceText) return document.document as unknown as Record<string, unknown>;
  if (document.sourceText.trimStart().startsWith("{")) {
    return new Document(document.sourceText, Json, document.absoluteRef);
  }
  return new Document(document.sourceText, Yaml, document.absoluteRef);
}

export const lintDocument = Effect.fn("openapi-transformer.lintDocument")(function* (
  document: LoadedDocument,
  silent = false,
) {
  const results = yield* Effect.tryPromise({
    try: () => spectral.run(spectralTarget(document)),
    catch: (cause) => new LintError({ text: cause instanceof Error ? cause.message : String(cause) }),
  });
  let failure: string | undefined;
  for (const result of results) {
    const location = result.path.length ? ` at #/${result.path.join("/")}` : "";
    const message = `${result.message}${location}`;
    // Spectral's parser rejects merge tags this repo accepts, and example payloads
    // use `$ref` as data. Those diagnostics are not document errors.
    if (result.severity === 0 && result.code !== "parser" && !isExampleRefRead(result)) {
      failure = message;
      error(message);
    } else warn(message, silent);
  }
  if (failure) return yield* new LintError({ text: failure });
});

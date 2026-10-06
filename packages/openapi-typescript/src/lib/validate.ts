import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Document, Spectral, type RulesetDefinition } from "@stoplight/spectral-core";
import { oas3 } from "@stoplight/spectral-formats";
import { Json, parseYaml, Yaml } from "@stoplight/spectral-parsers";
import { oas } from "@stoplight/spectral-rulesets";
import { $RefParser, oas3BundleOptions } from "@shipworthy/json-schema-ref-parser";
import parseJson from "parse-json";
import type { OpenAPI3 } from "../types.js";
import { debug, error, warn } from "./utils.js";

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

export interface ValidateAndBundleOptions {
  silent: boolean;
  cwd?: URL;
}

interface ParsedSchema {
  parsed: OpenAPI3;
  absoluteRef: string;
  sourceText?: string;
}

export async function parseSchema(schema: unknown, absoluteRef: string): Promise<ParsedSchema> {
  if (!schema) {
    throw new Error("Can’t parse empty schema");
  }
  if (schema instanceof URL) {
    const ref = schema.protocol === "file:" ? fileURLToPath(schema) : schema.href;
    const sourceText =
      schema.protocol === "file:" ? await readFile(ref, "utf8") : await (await fetch(ref)).text();
    return { parsed: (await $RefParser.parse(ref)) as OpenAPI3, absoluteRef: ref, sourceText };
  }
  if (schema instanceof Readable) {
    const contents = await new Promise<string>((resolve) => {
      schema.resume();
      schema.setEncoding("utf8");
      let content = "";
      schema.on("data", (chunk: string) => {
        content += chunk;
      });
      schema.on("end", () => {
        resolve(content.trim());
      });
    });
    return parseSchema(contents, absoluteRef);
  }
  if (schema instanceof Buffer) {
    return parseSchema(schema.toString("utf8"), absoluteRef);
  }
  if (typeof schema === "string") {
    if (
      schema.startsWith("http://") ||
      schema.startsWith("https://") ||
      schema.startsWith("file://")
    ) {
      return parseSchema(new URL(schema), absoluteRef);
    }
    if (schema[0] === "{") {
      return { parsed: parseJson(schema) as unknown as OpenAPI3, absoluteRef, sourceText: schema };
    }
    return {
      parsed: parseYaml(schema).data as unknown as OpenAPI3,
      absoluteRef,
      sourceText: schema,
    };
  }
  if (typeof schema === "object" && !Array.isArray(schema)) {
    return { parsed: schema as OpenAPI3, absoluteRef };
  }
  throw new Error(
    `Expected string, object, or Buffer. Got ${Array.isArray(schema) ? "Array" : typeof schema}`,
  );
}

function spectralTarget(document: ParsedSchema) {
  if (!document.sourceText) return document.parsed as unknown as Record<string, unknown>;
  if (document.sourceText.trimStart().startsWith("{")) {
    return new Document(document.sourceText, Json, document.absoluteRef);
  }
  return new Document(document.sourceText, Yaml, document.absoluteRef);
}

/**
 * Validate an OpenAPI schema and flatten external refs into component maps.
 */
export async function validateAndBundle(
  source: string | URL | OpenAPI3 | Readable | Buffer,
  options: ValidateAndBundleOptions,
) {
  const parseT = performance.now();
  let absoluteRef = fileURLToPath(new URL(options?.cwd ?? `file://${process.cwd()}/`));
  if (source instanceof URL) {
    absoluteRef = source.protocol === "file:" ? fileURLToPath(source) : source.href;
  }
  const document = await parseSchema(source, absoluteRef);
  debug("Parsed schema", "config", performance.now() - parseT);

  const parsed = document.parsed as OpenAPI3 & { swagger?: unknown };
  const openapiVersion = Number.parseFloat(parsed.openapi);
  if (
    parsed.swagger ||
    !parsed.openapi ||
    Number.isNaN(openapiVersion) ||
    openapiVersion < 3 ||
    openapiVersion >= 4
  ) {
    if (parsed.swagger) {
      throw new Error("Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.");
    }
    if (parsed.openapi || openapiVersion < 3 || openapiVersion >= 4) {
      throw new Error(`Unsupported OpenAPI version: ${parsed.openapi}`);
    }
    throw new Error("Unsupported schema format, expected `openapi: 3.x`");
  }

  const lintT = performance.now();
  const results = await spectral.run(spectralTarget(document));
  let errorMessage: string | undefined;
  for (const result of results) {
    const location = result.path.length ? ` at #/${result.path.join("/")}` : "";
    const message = `${result.message}${location}`;
    if (result.severity === 0) {
      errorMessage = message;
      error(message);
    } else {
      warn(message, options.silent);
    }
  }
  if (errorMessage) throw new Error(errorMessage);
  debug("Linted schema", "lint", performance.now() - lintT);

  const bundleT = performance.now();
  const bundled = await $RefParser.bundle<OpenAPI3>(
    document.absoluteRef,
    document.parsed,
    openApiBundleOptions(document.absoluteRef),
  );
  if (bundled && typeof bundled === "object" && !Array.isArray(bundled) && !("components" in bundled)) {
    (bundled as OpenAPI3).components = {};
  }
  debug("Bundled schema", "bundle", performance.now() - bundleT);
  return bundled;
}

function openApiBundleOptions(absoluteRef: string) {
  const origin = requestedHttpOrigin(absoluteRef);
  return {
    bundle: oas3BundleOptions(),
    ...(origin ? { resolve: { http: { allowedOrigins: [origin] } } } : {}),
  };
}

function requestedHttpOrigin(absoluteRef: string): string | undefined {
  try {
    const parsed = new URL(absoluteRef);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

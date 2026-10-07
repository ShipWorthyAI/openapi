import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import { parse as parseYaml } from "effect/encoding/Yaml";
import type { OpenAPITSOptions } from "../src/types.js";
import { render } from "./render.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const casesRoot = path.join(packageRoot, "test/cases");
const fixturesRoot = path.join(packageRoot, "test/fixtures");

const defaults: Record<string, boolean> = {
  additionalProperties: false,
  alphabetize: false,
  arrayLength: false,
  conditionalEnums: false,
  dedupeEnums: false,
  defaultNonNullable: true,
  emptyObjectsUnknown: false,
  enum: false,
  enumValues: false,
  excludeDeprecated: false,
  exportType: false,
  generatePathParams: false,
  immutable: false,
  makePathsEnum: false,
  pathParamsAsTypes: false,
  propertiesRequiredByDefault: false,
  readWriteMarkers: false,
  rootTypes: false,
  rootTypesKeepCasing: false,
  rootTypesNoSchemaPrefix: false,
};

const optionKeys = new Set([...Object.keys(defaults), "inject"]);
const hookKeys = ["transform", "postTransform", "transformProperty"] as const;

interface SourceFile {
  readonly file: string;
  readonly group: string;
  readonly wrap: Wrap;
  readonly extra?: OpenAPITSOptions;
  readonly skip?: (name: string) => boolean;
}

type Wrap =
  | "document"
  | "schema"
  | "components"
  | "paths"
  | "webhooks"
  | "operation"
  | "path-item"
  | "request-body"
  | "response"
  | "header"
  | "paths-enum";

const sources: SourceFile[] = [
  {
    file: "test/index.test.ts",
    group: "document",
    wrap: "document",
  },
  {
    file: "test/node-api.test.ts",
    group: "node-api",
    wrap: "document",
    skip: (name) => name.startsWith("snapshot >") || name.startsWith("input >"),
  },
  { file: "test/discriminators.test.ts", group: "discriminators", wrap: "document" },
  {
    file: "test/transform/schema-object/string.test.ts",
    group: "schema-object/string",
    wrap: "schema",
  },
  {
    file: "test/transform/schema-object/number.test.ts",
    group: "schema-object/number",
    wrap: "schema",
  },
  {
    file: "test/transform/schema-object/boolean.test.ts",
    group: "schema-object/boolean",
    wrap: "schema",
  },
  {
    file: "test/transform/schema-object/array.test.ts",
    group: "schema-object/array",
    wrap: "schema",
  },
  {
    file: "test/transform/schema-object/object.test.ts",
    group: "schema-object/object",
    wrap: "schema",
  },
  {
    file: "test/transform/schema-object/empty.test.ts",
    group: "schema-object/empty",
    wrap: "schema",
  },
  {
    file: "test/transform/schema-object/composition.test.ts",
    group: "schema-object/composition",
    wrap: "schema",
  },
  {
    file: "test/transform/schema-object/enum.test.ts",
    group: "schema-object/enum",
    wrap: "document",
  },
  { file: "test/transform/components-object.test.ts", group: "components", wrap: "components" },
  { file: "test/transform/paths-object.test.ts", group: "paths", wrap: "paths" },
  { file: "test/transform/webhooks-object.test.ts", group: "webhooks", wrap: "webhooks" },
  { file: "test/transform/operation-object.test.ts", group: "operation", wrap: "operation" },
  { file: "test/transform/path-item-object.test.ts", group: "path-item", wrap: "path-item" },
  {
    file: "test/transform/request-body-object.test.ts",
    group: "request-body",
    wrap: "request-body",
  },
  { file: "test/transform/response-object.test.ts", group: "response", wrap: "response" },
  { file: "test/transform/header-object.test.ts", group: "header", wrap: "header" },
  {
    file: "test/transform/paths-enum.test.ts",
    group: "paths-enum",
    wrap: "paths-enum",
    extra: { makePathsEnum: true },
  },
];

interface CaseRecord {
  given: unknown;
  options?: unknown;
}

const globalCases = globalThis as typeof globalThis & { __tests?: [string, CaseRecord][] };

function installStubs() {
  const test = Object.assign(() => undefined, {
    skipIf: () => () => undefined,
    each: () => () => undefined,
  });

  const describe = Object.assign(
    (_name: string, fn?: () => void) => {
      fn?.();
    },
    {
      each: () => () => undefined,
      skip: (_name: string, fn?: () => void) => {
        fn?.();
      },
      skipIf: () => () => undefined,
    },
  );

  Object.assign(globalThis, {
    test,
    describe,
    beforeAll: () => undefined,
    afterAll: () => undefined,
    expect: () => ({}),
    vi: { spyOn: () => ({ mockImplementation: () => ({}) }) },
    assert: (value: unknown) => {
      if (!value) throw new Error("assert");
    },
  });
}

function patchSource(source: string) {
  const withoutVitest = source.replace(/import\s*\{[^}]*\}\s*from\s*"vitest";\n/, "");

  const assigned = withoutVitest.replace(
    /const tests\s*(?::[^=]+)?=/,
    "const tests = globalThis.__tests =",
  );

  const header =
    "const { describe, test, beforeAll, afterAll, expect, vi, assert } = globalThis;\n";

  const imports = [...assigned.matchAll(/^import\b[\s\S]*?from\s*["'][^"']+["'];?[ \t]*\n/gm)];
  const last = imports.at(-1);

  if (!last) return header + assigned;

  const index = (last.index ?? 0) + last[0].length;
  return assigned.slice(0, index) + header + assigned.slice(index);
}

async function loadCases(file: string) {
  const absolute = path.join(packageRoot, file);
  const patched = absolute.replace(/\.test\.ts$/, ".cases.ts");
  fs.writeFileSync(patched, patchSource(fs.readFileSync(absolute, "utf8")));
  globalCases.__tests = undefined;

  try {
    await import(`${pathToFileURL(patched).href}?migrate=1`);
  } finally {
    fs.rmSync(patched, { force: true });
  }

  return globalCases.__tests ?? [];
}

function slug(value: string) {
  const text = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return (text || "case").slice(0, 80);
}

function groupFor(source: SourceFile, name: string) {
  if (!source.file.endsWith("index.test.ts")) return { group: source.group, title: name };

  const [head, ...rest] = name.split(">");

  if (!head || rest.length === 0) return { group: "document", title: name };

  return { group: slug(head), title: rest.join(">") };
}

function decodePointer(ref: string) {
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function pointerGet(root: unknown, ref: string): unknown {
  let node = root;

  for (const part of decodePointer(ref)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

function pointerSet(root: Record<string, unknown>, ref: string, value: unknown) {
  const parts = decodePointer(ref);
  let node = root;

  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index] ?? "";
    const next = node[part];

    if (!next || typeof next !== "object" || Array.isArray(next)) node[part] = {};

    node = node[part] as Record<string, unknown>;
  }

  const last = parts.at(-1);

  if (last && node[last] === undefined) node[last] = value;
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.$ref === "string") refs.push(record.$ref);

    for (const child of Object.values(record)) collectRefs(child, refs);
  }

  return refs;
}

function inlineRefs(root: Record<string, unknown>, resolve?: (ref: string) => unknown) {
  const seen = new Set<string>();

  for (let pass = 0; pass < 8; pass++) {
    let added = false;

    for (const ref of collectRefs(root)) {
      if (!ref.startsWith("#/") || seen.has(ref) || pointerGet(root, ref) !== undefined) {
        seen.add(ref);
        continue;
      }

      seen.add(ref);
      let resolved: unknown;

      if (resolve) {
        try {
          resolved = resolve(ref);
        } catch {
          resolved = undefined;
        }
      }

      pointerSet(
        root,
        ref,
        resolved === undefined ? { type: "object" } : structuredClone(resolved),
      );

      added = true;
    }

    if (!added) break;
  }
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function extractOptions(raw: unknown, extra: OpenAPITSOptions = {}) {
  const record = recordOf(raw) ?? {};
  const nested = recordOf(record.ctx);
  const source = nested ? { ...nested, ...record } : record;

  const resolve =
    typeof source.resolve === "function" ? (source.resolve as (ref: string) => unknown) : undefined;

  const data: Record<string, unknown> = { ...extra };
  const hooks: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (
      key === "ctx" ||
      key === "path" ||
      key === "resolve" ||
      key === "discriminators" ||
      key === "injectFooter" ||
      key === "silent"
    ) {
      continue;
    }

    if (typeof value === "function") {
      if (hookKeys.includes(key as (typeof hookKeys)[number])) hooks[key] = value;
      continue;
    }

    if (!optionKeys.has(key) || value === undefined) continue;
    if (typeof value === "boolean" && defaults[key] === value) continue;

    data[key] = value;
  }

  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === "boolean" && defaults[key] === value) delete data[key];
    else data[key] = value;
  }

  return { data, hooks, resolve };
}

function wrap(mode: Wrap, given: unknown) {
  const base = { openapi: "3.1.0", info: { title: "Test", version: "1.0.0" } };

  if (mode === "document" || recordOf(given)?.openapi !== undefined) return given;

  switch (mode) {
    case "schema":
      return { ...base, components: { schemas: { Subject: given } } };
    case "components":
      return { ...base, components: given };
    case "paths":
    case "paths-enum":
      return { ...base, paths: given };
    case "webhooks":
      return { ...base, webhooks: given };
    case "operation":
      return { ...base, paths: { "/get-item": { get: given } } };
    case "path-item":
      return { ...base, paths: { "/get-item": given } };
    case "request-body":
      return {
        ...base,
        paths: {
          "/get-item": {
            post: { requestBody: given, responses: { "204": { description: "No Content" } } },
          },
        },
      };
    case "response":
      return { ...base, paths: { "/get-item": { get: { responses: { "200": given } } } } };
    case "header":
      return { ...base, components: { headers: { Header: given } } };
    default:
      return given;
  }
}

function yamlKey(key: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}

function yamlScalar(value: string) {
  if (
    value.length === 0 ||
    /[\n\r:#{}[\],&*!|>%@`'"\\]/.test(value) ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(value) ||
    /^-?\d/.test(value) ||
    /^\s|\s$/.test(value)
  ) {
    return JSON.stringify(value);
  }

  return value;
}

function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return yamlScalar(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    return value
      .map((item) => {
        if (item !== null && typeof item === "object") {
          const body = toYaml(item, indent + 1);

          if (!body.includes("\n")) return `${pad}- ${body}`;

          const extra = "  ".repeat(indent + 1);

          const lines = body
            .split("\n")
            .map((line) => (line.startsWith(extra) ? line.slice(extra.length) : line));

          return [`${pad}- ${lines[0]}`, ...lines.slice(1).map((line) => `${pad}  ${line}`)].join(
            "\n",
          );
        }

        return `${pad}- ${toYaml(item)}`;
      })
      .join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, child]) => child !== undefined,
    );

    if (entries.length === 0) return "{}";

    return entries
      .map(([key, child]) => {
        const rendered = toYaml(child, indent + 1);

        if (!rendered.includes("\n")) return `${pad}${yamlKey(key)}: ${rendered}`;

        return `${pad}${yamlKey(key)}:\n${rendered}`;
      })
      .join("\n");
  }

  return JSON.stringify(value);
}

function writeSchema(directory: string, document: unknown, extension: "yaml" | "json") {
  const file = path.join(directory, `schema.${extension}`);

  const text =
    extension === "json" ? `${JSON.stringify(document, null, 2)}\n` : `${toYaml(document)}\n`;

  if (extension === "yaml") parseYaml(text);

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

const refFile = /\$ref:\s*["']?(?:\.\.\/|\.\/)?([^"'#\s]+\.(?:yaml|yml|json))/g;

function copyRelated(text: string, fromDir: string, toDir: string, seen: Set<string>) {
  for (const match of text.matchAll(refFile)) {
    const name = match[1];

    if (!name || seen.has(name)) continue;

    const source = path.join(fromDir, name);

    if (!fs.existsSync(source)) continue;

    seen.add(name);
    const body = fs.readFileSync(source, "utf8");
    fs.writeFileSync(path.join(toDir, path.basename(name)), body);
    copyRelated(body, path.dirname(source), toDir, seen);
  }
}

function hookModule(directory: string, hooks: Record<string, unknown>) {
  const entries = Object.entries(hooks);

  if (entries.length === 0) return;

  const body = entries
    .map(([key, value]) => {
      const source = (value as () => unknown).toString();
      return source.startsWith("function") || source.includes("=>") ? `${key}: ${source}` : source;
    })
    .join(",\n");

  const lines = [`import ts from "#compiler";`];

  if (body.includes("NULL")) {
    const relative = path
      .relative(directory, path.join(packageRoot, "src/lib/ts.ts"))
      .replaceAll("\\", "/")
      .replace(/\.ts$/, ".js");

    lines.push(`import { NULL } from "${relative}";`);
  }

  if (body.includes("DATE")) {
    lines.push(
      `const DATE = ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Date"));`,
    );
  }

  if (body.includes("BLOB")) {
    lines.push(`const BLOB = ts.factory.createTypeReferenceNode("Blob");`);
  }

  lines.push("", "export default {", body, "};", "");
  fs.writeFileSync(path.join(directory, "options.ts"), lines.join("\n"));
}

const used = new Set<string>();
const failures: string[] = [];
let written = 0;

function allocate(group: string, title: string) {
  const base = slug(title);
  let directory = path.join(casesRoot, group, base);
  let suffix = 2;

  while (used.has(directory)) {
    directory = path.join(casesRoot, group, `${base}-${suffix}`);
    suffix++;
  }

  used.add(directory);
  return directory;
}

async function writeCase(options: {
  readonly group: string;
  readonly title: string;
  readonly given: unknown;
  readonly rawOptions: unknown;
  readonly wrap: Wrap;
  readonly extra?: OpenAPITSOptions;
}) {
  if (options.given instanceof URL) {
    const source = fileURLToPath(options.given);

    if (source.includes(`${path.sep}examples${path.sep}`)) return;
  } else if (typeof options.given === "string") {
    if (options.given.startsWith("http://") || options.given.startsWith("https://")) return;
  } else if (Buffer.isBuffer(options.given)) {
    return;
  }

  const directory = allocate(options.group, options.title);
  const extracted = extractOptions(options.rawOptions, options.extra);
  fs.mkdirSync(directory, { recursive: true });

  let schemaFile: string;

  if (options.given instanceof URL) {
    const source = fileURLToPath(options.given);
    const extension = path.extname(source) === ".json" ? "json" : "yaml";
    schemaFile = path.join(directory, `schema.${extension}`);
    fs.copyFileSync(source, schemaFile);
    copyRelated(fs.readFileSync(schemaFile, "utf8"), path.dirname(source), directory, new Set());
  } else if (typeof options.given === "string") {
    const extension = options.given.trim().startsWith("{") ? "json" : "yaml";
    schemaFile = path.join(directory, `schema.${extension}`);

    fs.writeFileSync(
      schemaFile,
      options.given.endsWith("\n") ? options.given : `${options.given}\n`,
    );
  } else {
    const document = wrap(options.wrap, options.given);

    if (!document || typeof document !== "object") {
      throw new Error("Schema is not an object");
    }

    inlineRefs(document as Record<string, unknown>, extracted.resolve);

    try {
      schemaFile = writeSchema(directory, document, "yaml");
    } catch {
      schemaFile = writeSchema(directory, document, "json");
    }
  }

  if (Object.keys(extracted.data).length > 0) {
    fs.writeFileSync(
      path.join(directory, "options.json"),
      `${JSON.stringify(extracted.data, null, 2)}\n`,
    );
  }

  hookModule(directory, extracted.hooks);

  const types = await Effect.runPromise(
    render(pathToFileURL(schemaFile), {
      ...extracted.data,
      ...extracted.hooks,
      silent: true,
    } as OpenAPITSOptions),
  );

  fs.writeFileSync(path.join(directory, "types.ts"), types);
  written++;
  console.log(`✔ ${path.relative(casesRoot, directory)}`);
}

installStubs();

for (const source of sources) {
  const cases = await loadCases(source.file);

  for (const [name, item] of cases) {
    if (source.skip?.(name)) continue;

    const { group, title } = groupFor(source, name);

    try {
      await writeCase({
        group,
        title,
        given: item.given,
        rawOptions: item.options,
        wrap: source.wrap,
        extra: source.extra,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failures.push(`${source.file} :: ${name}\n${message}`);
      console.error(`✘ ${group} ${title}: ${message.split("\n")[0]}`);
    }
  }
}

for (const [title, file] of [
  ["merge", "yaml-merge.yaml"],
  ["path-item-components", "path-item-components.yaml"],
] as const) {
  try {
    await writeCase({
      group: "yaml",
      title,
      given: pathToFileURL(path.join(fixturesRoot, file)),
      rawOptions: undefined,
      wrap: "document",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    failures.push(`yaml :: ${title}\n${message}`);
    console.error(`✘ yaml ${title}: ${message.split("\n")[0]}`);
  }
}

console.log(`Wrote ${written} cases.`);

if (failures.length > 0) {
  console.error(`\n${failures.length} cases failed:\n${failures.join("\n\n")}`);
  process.exit(1);
}

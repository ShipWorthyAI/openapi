import * as Yaml from "effect/unstable/encoding/Yaml";
import type { FileInfo, Plugin } from "../types/index.js";
import { ParserError } from "../util/errors.js";

const mergeKeys = ["<<", "!!merge <<"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyYamlMerge(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => applyYamlMerge(item, seen));

  const mergeKey = mergeKeys.find((key) => Object.prototype.hasOwnProperty.call(value, key));
  const merged: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === mergeKey || key === "__proto__") continue;
    merged[key] = applyYamlMerge(child, seen);
  }
  if (!mergeKey) return merged;

  const raw = value[mergeKey];
  const sources = Array.isArray(raw) ? raw : [raw];
  for (const source of sources) {
    const resolved = applyYamlMerge(source, seen);
    if (!isRecord(resolved)) continue;
    for (const [key, child] of Object.entries(resolved)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (!Object.prototype.hasOwnProperty.call(merged, key)) merged[key] = child;
    }
  }
  return merged;
}

function isBlankDocument(input: string): boolean {
  return input.split("\n").every((line) => {
    const trimmed = line.trim();
    return trimmed === "" || trimmed === "---" || trimmed === "..." || trimmed.startsWith("#");
  });
}

export default {
  order: 200,
  allowEmpty: true,
  canParse: [".yaml", ".yml", ".json"],

  async parse(file: FileInfo) {
    let data = file.data;
    if (Buffer.isBuffer(data)) {
      data = data.toString();
    }

    if (typeof data === "string") {
      if (
        file.extension &&
        file.extension !== ".yaml" &&
        file.extension !== ".yml" &&
        file.extension !== ".json"
      ) {
        throw new ParserError("Not a YAML file", file.url);
      }
      try {
        const parsed = applyYamlMerge(Yaml.parse(data));
        if (parsed === null && isBlankDocument(data)) return undefined;
        return parsed;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Parser Error";
        throw new ParserError(message, file.url);
      }
    }

    return data;
  },
} as Plugin;

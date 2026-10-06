import * as Yaml from "effect/encoding/Yaml";
import { dump, type DumpOptions } from "js-yaml";

const mergeKeys = ["<<", "!!merge <<"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Effect's YAML decoder resolves aliases and leaves merge keys in place. */
export function applyYamlMerge(value: unknown, seen = new WeakSet<object>()): unknown {
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

export const parseYaml = (str: string, _options?: unknown): unknown => applyYamlMerge(Yaml.parse(str));

export const stringifyYaml = (obj: unknown, opts?: DumpOptions): string => dump(obj, opts);

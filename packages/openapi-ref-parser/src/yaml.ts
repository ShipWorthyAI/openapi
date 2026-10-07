import * as Yaml from "effect/encoding/Yaml";

const blockScalar = /^[|>](?:[1-9]?[+-]?|[+-]?[1-9]?)$/;

/**
 * Effect's YAML decoder rejects `- - value` and treats `<<` as a normal key.
 * OpenAPI fixtures in this repo use both, so expand those forms before parsing.
 */
export function parseYamlDocument(source: string): unknown {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  if (text.trim().length === 0) return null;
  return applyMergeKeys(Yaml.parse(expandCompactNestedSequences(relaxIndentTabs(text))));
}

/** Effect rejects a tab after leading spaces, including inside block scalars. */
function relaxIndentTabs(source: string): string {
  return source.replace(/^( *)\t+/gm, (match, spaces: string) => spaces + "  ".repeat(match.length - spaces.length));
}

export function expandCompactNestedSequences(source: string): string {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let blockIndent = -1;
  for (const line of lines) {
    let raw = line;
    while (true) {
      const indent = leadingSpaces(raw);
      if (blockIndent >= 0) {
        if (raw.trim().length > 0 && indent <= blockIndent) blockIndent = -1;
        else break;
      }
      const text = stripComment(raw.slice(indent)).trimEnd();
      const compact = compactRest(raw, indent);
      if (compact === undefined) {
        if (isBlockScalar(text)) blockIndent = indent;
        break;
      }
      output.push(`${" ".repeat(indent)}-`);
      raw = `${" ".repeat(indent + 2)}${compact}`;
    }
    output.push(raw);
  }
  return output.join("\n");
}

function compactRest(raw: string, indent: number): string | undefined {
  const body = raw.slice(indent);
  if (!body.startsWith("- ")) return undefined;
  const rest = body.slice(2);
  const text = stripComment(rest).trimEnd();
  if (text === "-" || text.startsWith("- ")) return rest;
  return undefined;
}

function isBlockScalar(text: string): boolean {
  if (blockScalar.test(text)) return true;
  const separator = mappingSeparator(text);
  if (separator !== -1) return blockScalar.test(text.slice(separator + 1).trim());
  if (text === "-" || text.startsWith("- ")) {
    const item = text.slice(1).trimStart();
    const nested = mappingSeparator(item);
    if (nested === -1) return blockScalar.test(item);
    return blockScalar.test(item.slice(nested + 1).trim());
  }
  return false;
}

function applyMergeKeys(value: unknown, seen = new Set<object>()): unknown {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) value[index] = applyMergeKeys(value[index], seen);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) record[key] = applyMergeKeys(record[key], seen);
  if (!Object.keys(record).some(isMergeKey)) return record;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!isMergeKey(key)) {
      next[key] = record[key];
      continue;
    }
    const source = record[key];
    const entries = Array.isArray(source) ? source : [source];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      for (const [mergedKey, mergedValue] of Object.entries(entry)) {
        if (isMergeKey(mergedKey) || Object.hasOwn(next, mergedKey)) continue;
        next[mergedKey] = mergedValue;
      }
    }
  }
  for (const key of Object.keys(record)) delete record[key];
  Object.assign(record, next);
  return record;
}

function isMergeKey(key: string): boolean {
  const text = key.trim();
  return text === "<<" || /^!!\S+\s+<<$/.test(text) || /^!<[^>]+>\s+<<$/.test(text);
}

function leadingSpaces(raw: string): number {
  let index = 0;
  while (raw.charCodeAt(index) === 32) index++;
  return index;
}

const closingQuote = (input: string, quote: string, start: number): number => {
  for (let index = start; index < input.length; index++) {
    const character = input[index];
    if (quote === '"' && character === "\\") index++;
    else if (character === quote) {
      if (quote === "'" && input[index + 1] === quote) index++;
      else return index;
    }
  }
  return -1;
};

const findIndicator = (input: string, indicator: "#" | ":"): number => {
  let depth = 0;
  let tokenStart = true;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (tokenStart && (character === "'" || character === '"')) {
      index = closingQuote(input, character, index + 1);
      if (index === -1) return -1;
      tokenStart = false;
    } else if (tokenStart && character === "&") {
      while (index + 1 < input.length && !/[\s,[\]{}]/.test(input[index + 1] ?? "")) index++;
    } else if (character === "#" && (index === 0 || /\s/.test(input[index - 1] ?? ""))) {
      return indicator === "#" ? index : -1;
    } else if (tokenStart && (character === "[" || character === "{")) {
      depth++;
    } else if (depth > 0 && (character === "]" || character === "}")) {
      depth--;
      tokenStart = false;
    } else if (depth > 0 && character === ",") {
      tokenStart = true;
    } else if (character === ":" && (depth > 0 || input[index + 1] === undefined || /\s/.test(input[index + 1] ?? ""))) {
      if (depth === 0 && indicator === ":") return index;
      tokenStart = true;
    } else if (tokenStart && character === "-" && /\s/.test(input[index + 1] ?? "")) {
      continue;
    } else if (!/\s/.test(character ?? "")) {
      tokenStart = false;
    }
  }
  return -1;
};

const stripComment = (input: string): string => {
  const index = findIndicator(input, "#");
  return index === -1 ? input : input.slice(0, index).trimEnd();
};

const mappingSeparator = (input: string): number => findIndicator(input, ":");

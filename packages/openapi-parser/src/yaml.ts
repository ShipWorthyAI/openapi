import { Array as Arr, pipe, Predicate, Record as Rec, String as Str } from "effect";
import * as Yaml from "effect/encoding/Yaml";

const blockScalar = /^[|>](?:[1-9]?[+-]?|[+-]?[1-9]?)$/;

/**
 * Effect's YAML decoder rejects `- - value` and treats `<<` as a normal key.
 * OpenAPI fixtures in this repo use both, so expand those forms before parsing.
 */
export function parseYamlDocument(source: string): unknown {
  const text = Str.startsWith("\uFEFF")(source) ? Str.slice(1)(source) : source;
  if (isBlank(text)) return null;

  return applyMergeKeys(
    Yaml.parse(expandCompactNestedSequences(deepenShallowBlockScalars(relaxIndentTabs(text)))),
  );
}

/**
 * Effect closes a block scalar when the next line is not indented past the header.
 * `- |2` followed by text at the same column is that case. Indent the content and
 * drop the explicit indicator so auto-detection keeps the scalar text.
 */
function deepenShallowBlockScalars(source: string): string {
  const lines = pipe(source, Str.replace(/\r\n?/g, "\n"), Str.split("\n"));
  const output: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const indent = leadingSpaces(line);
    const text = pipe(line, Str.slice(indent), stripComment, Str.trimEnd);

    if (!isExplicitBlockScalar(text) || !hasShallowContent(lines, index, indent)) {
      output.push(line);
      continue;
    }

    output.push(dropExplicitIndent(line));
    index++;

    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (!isBlank(next) && leadingSpaces(next) < indent) break;
      output.push(isBlank(next) ? next : `  ${next}`);
      index++;
    }

    index--;
  }

  return Arr.join(output, "\n");
}

function isExplicitBlockScalar(text: string): boolean {
  return /^[|>](?:[+-]?[1-9]|[1-9][+-])$/.test(scalarToken(text));
}

function scalarToken(text: string): string {
  const separator = mappingSeparator(text);
  const token = separator === -1 ? text : afterIndex(text, separator);

  if (token === "-" || Str.startsWith("- ")(token)) {
    const item = pipe(token, Str.slice(1), Str.trimStart);
    const nested = mappingSeparator(item);
    return nested === -1 ? item : afterIndex(item, nested);
  }

  return token;
}

function hasShallowContent(lines: readonly string[], header: number, indent: number): boolean {
  for (let index = header + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (isBlank(line)) continue;
    return leadingSpaces(line) <= indent;
  }

  return false;
}

function dropExplicitIndent(line: string): string {
  return Str.replace(/([|>])(\+|-)?[1-9](\+|-)?(\s*(?:#.*)?)?$/, "$1$2$3$4")(line);
}

/**
 * Effect rejects a tab after leading spaces, including inside block scalars.
 * Replace each tab in a line's leading run of spaces then tabs with two spaces.
 */
function relaxIndentTabs(source: string): string {
  return Str.replace(/(?<=^ *\t*)\t/gm, "  ")(source);
}

export function expandCompactNestedSequences(source: string): string {
  const lines = pipe(
    source,
    Str.replace(/^\uFEFF/, ""),
    Str.replace(/\r\n?/g, "\n"),
    Str.split("\n"),
  );

  const output: string[] = [];
  let blockIndent = -1;

  for (const line of lines) {
    let raw = line;

    while (true) {
      const indent = leadingSpaces(raw);

      if (blockIndent >= 0) {
        if (!isBlank(raw) && indent <= blockIndent) blockIndent = -1;
        else break;
      }

      const text = pipe(raw, Str.slice(indent), stripComment, Str.trimEnd);
      const compact = compactRest(raw, indent);

      if (compact === undefined) {
        if (isBlockScalar(text)) blockIndent = indent;
        break;
      }

      output.push(`${Str.repeat(indent)(" ")}-`);
      raw = `${Str.repeat(indent + 2)(" ")}${compact}`;
    }

    output.push(raw);
  }

  return Arr.join(output, "\n");
}

function compactRest(raw: string, indent: number): string | undefined {
  const body = Str.slice(indent)(raw);
  if (!Str.startsWith("- ")(body)) return undefined;
  const rest = Str.slice(2)(body);
  const text = Str.trimEnd(stripComment(rest));
  if (text === "-" || Str.startsWith("- ")(text)) return rest;
  return undefined;
}

function isBlockScalar(text: string): boolean {
  if (blockScalar.test(text)) return true;
  const separator = mappingSeparator(text);
  if (separator !== -1) return blockScalar.test(afterIndex(text, separator));

  if (text === "-" || Str.startsWith("- ")(text)) {
    const item = pipe(text, Str.slice(1), Str.trimStart);
    const nested = mappingSeparator(item);
    if (nested === -1) return blockScalar.test(item);
    return blockScalar.test(afterIndex(item, nested));
  }

  return false;
}

function applyMergeKeys(value: unknown, seen = new Set<object>()): unknown {
  if (!Predicate.isObjectOrArray(value) || seen.has(value)) return value;
  seen.add(value);

  if (Arr.isArray(value)) {
    for (let index = 0; index < value.length; index++)
      value[index] = applyMergeKeys(value[index], seen);
    return value;
  }

  const record: Record<string, unknown> = value;
  for (const key of Rec.keys(record)) record[key] = applyMergeKeys(record[key], seen);
  if (!Arr.some(Rec.keys(record), isMergeKey)) return record;
  const next: Record<string, unknown> = {};

  for (const key of Rec.keys(record)) {
    if (!isMergeKey(key)) {
      next[key] = record[key];
      continue;
    }

    const source = record[key];
    const entries = Arr.isArray(source) ? source : [source];

    for (const entry of entries) {
      if (!Predicate.isObject(entry)) continue;

      for (const [mergedKey, mergedValue] of Rec.toEntries(entry)) {
        if (isMergeKey(mergedKey) || Rec.has(next, mergedKey)) continue;
        next[mergedKey] = mergedValue;
      }
    }
  }

  for (const key of Rec.keys(record)) delete record[key];
  Object.assign(record, next);
  return record;
}

function isMergeKey(key: string): boolean {
  const text = Str.trim(key);
  return text === "<<" || /^!!\S+\s+<<$/.test(text) || /^!<[^>]+>\s+<<$/.test(text);
}

function leadingSpaces(raw: string): number {
  let index = 0;
  while (raw[index] === " ") index++;
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
    } else if (
      character === ":" &&
      (depth > 0 || input[index + 1] === undefined || /\s/.test(input[index + 1] ?? ""))
    ) {
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
  return index === -1 ? input : pipe(input, Str.slice(0, index), Str.trimEnd);
};

const mappingSeparator = (input: string): number => findIndicator(input, ":");

/** The trimmed text after `index`. */
const afterIndex = (input: string, index: number): string =>
  pipe(input, Str.slice(index + 1), Str.trim);

const isBlank = (input: string): boolean => Str.isEmpty(Str.trim(input));

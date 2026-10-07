import { Effect } from "effect";
import { ParserFailure } from "./errors.js";
import type { EffectPlugin, FileInfo, Options, ParserPlugin } from "./plugins.js";
import { promisePlugin } from "./plugins.js";
import { extensionOf } from "./url.js";
import { parseYamlDocument } from "./yaml.js";

export function decodeData(data: Uint8Array | string | undefined): string {
  if (data === undefined) return "";
  if (typeof data === "string") return data;
  return new TextDecoder().decode(data);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parserPlugins(options: Options): EffectPlugin<unknown>[] {
  const plugins: EffectPlugin<unknown>[] = [];
  if (options.parse?.json !== false) plugins.push(jsonParser());
  if (options.parse?.yaml !== false) plugins.push(yamlParser());

  for (const [index, plugin] of (options.parsers ?? []).entries()) {
    plugins.push(customParser(plugin, index));
  }

  return plugins;
}

function jsonParser(): EffectPlugin<unknown> {
  return {
    order: 100,
    can: (file) => extensionOf(file.url) === ".json" || extensionOf(file.url) === "",
    run(file) {
      return Effect.try({
        try: () => parseJson(file),
        catch: (cause) =>
          new ParserFailure({
            message: cause instanceof Error ? cause.message : "Parser Error",
            source: file.url,
            cause,
          }),
      });
    },
  };
}

function parseJson(file: FileInfo): unknown {
  const text = stripBom(decodeData(file.data));
  if (text.trim().length === 0) return null;
  return JSON.parse(text);
}

function yamlParser(): EffectPlugin<unknown> {
  return {
    order: 200,
    can: (file) => {
      const extension = extensionOf(file.url);

      return (
        extension === ".yaml" || extension === ".yml" || extension === ".json" || extension === ""
      );
    },
    run(file) {
      return Effect.try({
        try: () => parseYaml(file),
        catch: (cause) =>
          new ParserFailure({
            message: cause instanceof Error ? cause.message : "Parser Error",
            source: file.url,
            cause,
          }),
      });
    },
  };
}

function parseYaml(file: FileInfo): unknown {
  return parseYamlDocument(stripBom(decodeData(file.data)));
}

function customParser(plugin: ParserPlugin, index: number): EffectPlugin<unknown> {
  return promisePlugin(
    plugin.order ?? 300 + index,
    (file) => plugin.canParse(file),
    (file) => plugin.parse(file),
    (cause, file) =>
      new ParserFailure({
        message: cause instanceof Error ? cause.message : "Parser Error",
        source: file.url,
        cause,
      }),
  );
}

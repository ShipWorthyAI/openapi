import { Effect, Predicate, Schema, String as Str } from "effect";
import { ParseError, ParserFailure } from "./errors.ts";
import type { EffectPlugin, FileInfo, Options, ParserPlugin } from "./plugins.ts";
import { promisePlugin } from "./plugins.ts";
import { extensionOf } from "./url.ts";
import { parseYamlDocument } from "./yaml.ts";

function decodeData(data: Uint8Array | string | undefined): string {
  if (data === undefined) return "";
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  return Str.replace(/^\uFEFF/, "")(text);
}

const decodeJsonText = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

function parseJsonText(text: string) {
  return Str.isEmpty(Str.trim(text)) ? Effect.succeed(null) : decodeJsonText(text);
}

export const parseText = Effect.fnUntraced(function* (source: string | Uint8Array) {
  const text = decodeData(source);
  const first = Str.trimStart(text)[0];
  const yaml = () => Effect.try({ try: () => parseYamlDocument(text), catch: parseFailure });

  if (first === "{" || first === "[") {
    return yield* parseJsonText(text).pipe(Effect.catch(yaml));
  }

  return yield* yaml();
});

function parseFailure(cause: unknown): ParseError {
  return new ParseError({
    message: Predicate.isError(cause) ? cause.message : String(cause),
    cause,
  });
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
      return parseJsonText(decodeData(file.data)).pipe(
        Effect.mapError(
          (cause) => new ParserFailure({ message: cause.message, source: file.url, cause }),
        ),
      );
    },
  };
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
  return parseYamlDocument(decodeData(file.data));
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

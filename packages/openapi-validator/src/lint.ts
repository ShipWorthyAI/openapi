import { Document, Spectral, type RulesetDefinition } from "@stoplight/spectral-core";
import { oas3 } from "@stoplight/spectral-formats";
// spectral-parsers is CommonJS without statically detectable named exports, so Node needs a default import.
import spectralParsers from "@stoplight/spectral-parsers";
import { oas } from "@stoplight/spectral-rulesets";
import { Array as EffectArray, Config, Console, Context, Effect, Layer, Predicate } from "effect";
import { LintError } from "./errors.ts";

/** Same TTY and `NO_COLOR` check as `CliOutput.defaultFormatter`. */
const colorsEnabled = Effect.gen(function* () {
  const noColor = yield* Config.String("NO_COLOR").pipe(Config.withDefault(""), Effect.orDie);
  const current = globalThis.process;

  if (typeof current !== "object" || current === null) return false;

  const stdout = current.stdout;

  if (typeof stdout !== "object" || stdout === null) return false;

  return stdout.isTTY === true && !noColor;
});

function paint(code: string, enabled: boolean) {
  return (text: string) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : text);
}

function spectralRules(strict: boolean): Record<string, "off" | "warn" | "error"> {
  const rules: Record<string, "off" | "warn" | "error"> = {
    // Lint can inspect partial documents; the parser owns structural validation.
    "oas3-schema": "off",
  };

  if (strict) return rules;

  for (const [id, rule] of Object.entries(oas.rules ?? {})) {
    if (id === "operation-operationId-unique") continue;

    if (Predicate.isObject(rule) && "severity" in rule && rule.severity === 0) {
      rules[id] = "warn";
    }
  }

  return rules;
}

function isExampleRefRead(result: {
  code: unknown;
  message: string;
  path: readonly unknown[];
}): boolean {
  return (
    result.code === "invalid-ref" &&
    result.message.startsWith("ReadError:") &&
    result.path.includes("examples")
  );
}

interface LintOptions {
  readonly sourceUrl?: string;
  readonly silent?: boolean;
  /** Keep Spectral's `oas` severities and fail on YAML/JSON syntax errors. */
  readonly strict?: boolean;
}

function makeSpectral(strict: boolean): Spectral {
  const spectral = new Spectral();

  spectral.setRuleset({
    extends: [oas as unknown as RulesetDefinition],
    formats: [oas3],
    parserOptions: {
      // OpenAPI status codes are YAML numbers (`200:`). Spectral's parser can flag that.
      incompatibleValues: "off",
    },
    rules: spectralRules(strict),
  });

  return spectral;
}

function spectralTarget(source: string | Record<string, unknown>, sourceUrl: string | undefined) {
  if (typeof source !== "string") return source;

  if (source.trimStart().startsWith("{")) {
    return new Document(source, spectralParsers.Json, sourceUrl);
  }

  return new Document(source, spectralParsers.Yaml, sourceUrl);
}

function thrownMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function pathSegments(path: readonly unknown[]): Array<string | number> {
  return path.filter(
    (segment): segment is string | number =>
      Predicate.isString(segment) || Predicate.isNumber(segment),
  );
}

export class Linter extends Context.Service<
  Linter,
  {
    readonly lintDocument: (
      source: string | Record<string, unknown>,
      options?: LintOptions,
    ) => Effect.Effect<void, LintError>;
  }
>()("@shipworthy/openapi-validator/Linter") {
  static readonly layer = Layer.sync(Linter, () => {
    const lenient = makeSpectral(false);
    const strict = makeSpectral(true);

    const lintDocument = Effect.fn("Linter.lintDocument")(function* (
      source: string | Record<string, unknown>,
      options: LintOptions = {},
    ): Effect.fn.Return<void, LintError> {
      const isStrict = options.strict === true;
      const spectral = isStrict ? strict : lenient;

      const target = yield* Effect.try({
        try: () => spectralTarget(source, options.sourceUrl),
        catch: (cause) => new LintError({ message: thrownMessage(cause), diagnostics: [], cause }),
      });

      if (!oas3(target instanceof Document ? target.data : target, options.sourceUrl ?? null)) {
        const message = "Expected an OpenAPI 3.x document";

        return yield* new LintError({
          message,
          diagnostics: [{ code: "unsupported-format", message, path: [] }],
        });
      }

      const results = yield* Effect.tryPromise({
        try: () => spectral.run(target),
        catch: (cause) =>
          new LintError({
            message: thrownMessage(cause),
            diagnostics: [],
            cause,
          }),
      });

      const useColors = yield* colorsEnabled;
      const red = paint("31", useColors);
      const yellow = paint("33", useColors);

      const failures = yield* Effect.forEach(
        results,
        Effect.fnUntraced(function* (result) {
          const location = result.path.length ? ` at #/${result.path.join("/")}` : "";
          const message = `${result.message}${location}`;

          // Spectral's parser rejects merge tags this repo accepts, and example payloads
          // use `$ref` as data. Those diagnostics are not document errors unless strict.
          const blocking =
            result.severity === 0 &&
            (isStrict || result.code !== "parser") &&
            !isExampleRefRead(result);

          if (blocking) {
            yield* Console.error(red(` ✘  ${message}`));
            return { code: result.code, message, path: pathSegments(result.path) };
          } else if (!options.silent) {
            yield* Console.warn(yellow(` ⚠  ${message}`));
          }

          return undefined;
        }),
      ).pipe(Effect.map(EffectArray.filter(Predicate.isNotUndefined)));

      if (failures.length > 0) {
        return yield* new LintError({
          message: failures.map((diagnostic) => diagnostic.message).join("\n"),
          diagnostics: failures,
        });
      }
    });

    return Linter.of({ lintDocument });
  });
}

import { Document, Spectral, type RulesetDefinition } from "@stoplight/spectral-core";
import { oas3 } from "@stoplight/spectral-formats";
import { Json, Yaml } from "@stoplight/spectral-parsers";
import { oas } from "@stoplight/spectral-rulesets";
import { Console, Context, Effect, Layer, Predicate } from "effect";
import { LintError } from "./errors.js";

/** Same TTY and `NO_COLOR` check as `CliOutput.defaultFormatter`. */
function colorsEnabled(): boolean {
  const current = globalThis.process;

  if (typeof current !== "object" || current === null) return false;

  const stdout = current.stdout;

  if (typeof stdout !== "object" || stdout === null) return false;

  return stdout.isTTY === true && !current.env?.NO_COLOR;
}

function paint(code: string) {
  return (text: string) => (colorsEnabled() ? `\x1b[${code}m${text}\x1b[0m` : text);
}

const red = paint("31");
const yellow = paint("33");

function spectralRules(): Record<string, "off" | "warn" | "error"> {
  const rules: Record<string, "off" | "warn" | "error"> = {
    // Lint can inspect partial documents; the parser owns structural validation.
    "oas3-schema": "off",
  };

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
}

function spectralTarget(source: string | Record<string, unknown>, sourceUrl: string | undefined) {
  if (typeof source !== "string") return source;

  if (source.trimStart().startsWith("{")) {
    return new Document(source, Json, sourceUrl);
  }

  return new Document(source, Yaml, sourceUrl);
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

    const lintDocument = Effect.fn("Linter.lintDocument")(function* (
      source: string | Record<string, unknown>,
      options: LintOptions = {},
    ): Effect.fn.Return<void, LintError> {
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

      const failures: Array<{
        code: string | number;
        message: string;
        path: Array<string | number>;
      }> = [];

      for (const result of results) {
        const location = result.path.length ? ` at #/${result.path.join("/")}` : "";
        const message = `${result.message}${location}`;

        // Spectral's parser rejects merge tags this repo accepts, and example payloads
        // use `$ref` as data. Those diagnostics are not document errors.
        if (result.severity === 0 && result.code !== "parser" && !isExampleRefRead(result)) {
          failures.push({ code: result.code, message, path: pathSegments(result.path) });
          yield* Console.error(red(` ✘  ${message}`));
        } else if (!options.silent) {
          yield* Console.warn(yellow(` ⚠  ${message}`));
        }
      }

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

import type { ParameterLocation, ParsedParameter } from "@shipworthy/openapi-transformer";
import { Effect, Predicate } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import {
  addJSDocComment,
  annotationsOf,
  NEVER,
  QUESTION_TOKEN,
  refType,
  tsModifiers,
  tsPropertyIndex,
} from "../lib/ts.ts";
import { createRef } from "../lib/utils.ts";
import { transformParameter } from "./parameter.ts";

const PATH_PARAM_RE = /\{([^}]+)\}/g;

const locations: readonly ParameterLocation[] = ["query", "header", "path", "cookie"];

/** A string path parameter for a `{name}` in the URL template that no parameter declares. */
function syntheticPathParameter(name: string, path: string): ParsedParameter {
  return {
    id: createRef([path, "parameters", "path", name]),
    name,
    in: "path",
    style: "simple",
    required: true,
    deprecated: false,
    schema: { type: "string" },
    contents: [],
    examples: [],
    extensions: {},
  };
}

/**
 * Transform the parameters of an operation or path item into
 * `parameters: { query; header; path; cookie }`.
 *
 * `url` is the URL template the parameters belong to. With `generatePathParams`, its `{name}`s
 * become path parameters when nothing declares them.
 */
export const transformParameters = Effect.fnUntraced(function* (
  parameters: readonly ParsedParameter[],
  path: string,
  url?: string,
): Effect.fn.Return<ts.PropertySignature, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;
  let working = [...parameters];

  if (ctx.generatePathParams && url !== undefined) {
    for (const [, name = ""] of url.matchAll(PATH_PARAM_RE)) {
      if (!working.some((parameter) => parameter.in === "path" && parameter.name === name)) {
        working.push(syntheticPathParameter(name, path));
      }
    }
  }

  // this is the only array in the spec, so it is sorted here
  if (ctx.alphabetize) {
    working.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (ctx.excludeDeprecated) {
    working = working.filter(
      (parameter) =>
        !parameter.deprecated &&
        !(Predicate.isObject(parameter.schema) && parameter.schema.deprecated),
    );
  }

  const byLocation = yield* Effect.forEach(
    locations,
    Effect.fnUntraced(function* (location) {
      let allOptional = true;

      const members = yield* Effect.forEach(
        working.filter((parameter) => parameter.in === location),
        Effect.fnUntraced(function* (parameter) {
          const optional = location !== "path" && !parameter.required;
          allOptional &&= optional;

          const property = ts.factory.createPropertySignature(
            /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
            /* name          */ tsPropertyIndex(parameter.name),
            /* questionToken */ optional ? QUESTION_TOKEN : undefined,
            /* type          */ parameter.reference
              ? yield* refType(parameter.reference.$ref, parameter)
              : yield* transformParameter(
                  parameter,
                  createRef([path, "parameters", location, parameter.name]),
                ),
          );

          // a referenced parameter still documents the property it becomes
          addJSDocComment(annotationsOf(parameter, { inherit: true }), property);
          return property;
        }),
      );

      return ts.factory.createPropertySignature(
        /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
        /* name          */ tsPropertyIndex(location),
        /* questionToken */ allOptional ? QUESTION_TOKEN : undefined,
        /* type          */ members.length ? ts.factory.createTypeLiteralNode(members) : NEVER,
      );
    }),
  );

  return ts.factory.createPropertySignature(
    /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
    /* name          */ tsPropertyIndex("parameters"),
    /* questionToken */ undefined,
    /* type          */ ts.factory.createTypeLiteralNode(byLocation),
  );
});

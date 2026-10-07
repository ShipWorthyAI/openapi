import type { ParameterLocation, ParsedParameter } from "@shipworthy/openapi-transformer";
import { Effect, Predicate } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.js";
import type { TypegenError } from "../errors.js";
import {
  addJSDocComment,
  annotationsOf,
  NEVER,
  QUESTION_TOKEN,
  refType,
  tsModifiers,
  tsPropertyIndex,
} from "../lib/ts.js";
import { createRef } from "../lib/utils.js";
import { transformParameter } from "./parameter.js";

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

  const byLocation: ts.TypeElement[] = [];

  for (const location of locations) {
    const members: ts.PropertySignature[] = [];
    let allOptional = true;

    for (const parameter of working) {
      if (parameter.in !== location) continue;
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
      members.push(property);
    }

    byLocation.push(
      ts.factory.createPropertySignature(
        /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
        /* name          */ tsPropertyIndex(location),
        /* questionToken */ allOptional ? QUESTION_TOKEN : undefined,
        /* type          */ members.length ? ts.factory.createTypeLiteralNode(members) : NEVER,
      ),
    );
  }

  return ts.factory.createPropertySignature(
    /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
    /* name          */ tsPropertyIndex("parameters"),
    /* questionToken */ undefined,
    /* type          */ ts.factory.createTypeLiteralNode(byLocation),
  );
});

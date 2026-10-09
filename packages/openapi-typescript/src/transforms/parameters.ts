import type { ParameterLocation, ParsedParameter } from "@shipworthy/openapi-transformer";
import { Array, Effect } from "effect";
import ts from "#compiler";
import type { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import {
  addJSDocComment,
  annotationsOf,
  NEVER,
  QUESTION_TOKEN,
  refType,
  tsPropertyIndex,
} from "../lib/ts.ts";
import { createRef } from "../lib/utils.ts";
import { transformParameter } from "./parameter.ts";

const locations: readonly ParameterLocation[] = ["query", "header", "path", "cookie"];

/**
 * Transform the parameters of an operation or path item into
 * `parameters: { query; header; path; cookie }`.
 */
export const transformParameters = Effect.fnUntraced(function* (
  parameters: readonly ParsedParameter[],
  path: string,
): Effect.fn.Return<ts.PropertySignature, TypegenError, TypegenContext> {
  const byLocation = yield* Effect.forEach(
    locations,
    Effect.fnUntraced(function* (location) {
      let allOptional = true;

      const members = yield* Effect.forEach(
        Array.filter(parameters, (parameter) => parameter.in === location),
        Effect.fnUntraced(function* (parameter) {
          const optional = location !== "path" && !parameter.required;
          allOptional &&= optional;

          const property = ts.factory.createPropertySignature(
            /* modifiers     */ undefined,
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
        /* modifiers     */ undefined,
        /* name          */ tsPropertyIndex(location),
        /* questionToken */ allOptional ? QUESTION_TOKEN : undefined,
        /* type          */ members.length ? ts.factory.createTypeLiteralNode(members) : NEVER,
      );
    }),
  );

  return ts.factory.createPropertySignature(
    /* modifiers     */ undefined,
    /* name          */ tsPropertyIndex("parameters"),
    /* questionToken */ undefined,
    /* type          */ ts.factory.createTypeLiteralNode(byLocation),
  );
});

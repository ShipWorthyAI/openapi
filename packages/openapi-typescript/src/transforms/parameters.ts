import type { ParameterLocation, ParsedParameter } from "@shipworthy/openapi-transformer";
import { Array, Effect } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import { TypegenError } from "../errors.ts";
import { collidingProperties, propertyName } from "@shipworthy/openapi-transformer";
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
  const ctx = yield* TypegenContext;

  const byLocation = yield* Effect.forEach(
    locations,
    Effect.fnUntraced(function* (location) {
      let allOptional = true;
      const located = Array.filter(parameters, (parameter) => parameter.in === location);

      const collision = collidingProperties(
        Array.map(located, (parameter) => parameter.name),
        ctx.camelCase,
      );

      if (collision) {
        return yield* new TypegenError({
          message: `${path}: ${collision[0]} and ${collision[1]} both become ${propertyName(collision[0], true)} in ${location} parameters`,
        });
      }

      const members = yield* Effect.forEach(
        located,
        Effect.fnUntraced(function* (parameter) {
          const optional = location !== "path" && !parameter.required;
          allOptional &&= optional;

          const property = ts.factory.createPropertySignature(
            /* modifiers     */ undefined,
            /* name          */ tsPropertyIndex(propertyName(parameter.name, ctx.camelCase)),
            /* questionToken */ optional ? QUESTION_TOKEN : undefined,
            /* type          */ parameter.reference
              ? yield* refType(parameter.reference.$ref, parameter, { camelCase: ctx.camelCase })
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

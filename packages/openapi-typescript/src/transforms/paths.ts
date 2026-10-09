import type { ParsedParameter, ParsedPathItem } from "@shipworthy/openapi-transformer";
import { Effect, Predicate } from "effect";
import { performance } from "node:perf_hooks";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import { refType, stringToAST, tsModifiers, tsPropertyIndex } from "../lib/ts.ts";
import { createRef, debug, getEntries } from "../lib/utils.ts";
import { transformPathItem } from "./path-item.ts";

const PATH_PARAM_RE = /\{[^}]+\}/g;

/** Path parameters by name: the path item's, then each operation's. */
function pathParameters(item: ParsedPathItem): Record<string, ParsedParameter> {
  const params: Record<string, ParsedParameter> = {};

  for (const parameter of item.parameters) {
    if (parameter.in === "path") params[parameter.name] = parameter;
  }

  for (const operation of item.operations) {
    for (const parameter of operation.request.path) params[parameter.name] = parameter;
  }

  return params;
}

/** A template literal type for a URL, with each `{name}` replaced by its parameter's type. */
function templateType(url: string, item: ParsedPathItem): ts.TypeNode | undefined {
  const params = pathParameters(item);
  let rawPath = `\`${url}\``;

  for (const match of url.match(PATH_PARAM_RE) ?? []) {
    const schema = params[match.slice(1, -1)]?.schema;
    const type = Predicate.isObject(schema) ? schema.type : undefined;

    switch (type) {
      case "number":
      case "integer":
        rawPath = rawPath.replace(match, "${number}");
        break;
      case "boolean":
        rawPath = rawPath.replace(match, "${boolean}");
        break;
      default:
        rawPath = rawPath.replace(match, "${string}");
        break;
    }
  }

  // creating a template literal's AST by hand is hard, so let TypeScript parse it
  const [statement] = stringToAST(rawPath);

  return Predicate.hasProperty(statement, "expression")
    ? (statement.expression as ts.TypeNode)
    : undefined;
}

/**
 * Transform the Paths Object (4.8.8) into a type keyed by URL template.
 * @see https://spec.openapis.org/oas/v3.1.0#paths-object
 */
export const transformPaths = Effect.fnUntraced(function* (
  paths: Readonly<Record<string, ParsedPathItem>>,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;

  const type = yield* Effect.forEach(
    getEntries(paths, ctx),
    Effect.fnUntraced(function* ([url, item]) {
      const pathT = performance.now();

      if (item.reference) {
        return ts.factory.createPropertySignature(
          /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
          /* name          */ tsPropertyIndex(url),
          /* questionToken */ undefined,
          /* type          */ yield* refType(item.reference.$ref),
        );
      }

      const pathItemType = yield* transformPathItem(item, createRef(["paths", url]), url);

      const pathType =
        ctx.pathParamsAsTypes && url.includes("{") ? templateType(url, item) : undefined;

      if (pathType) {
        return ts.factory.createIndexSignature(
          /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
          /* parameters    */ [
            ts.factory.createParameterDeclaration(
              /* modifiers      */ undefined,
              /* dotDotDotToken */ undefined,
              /* name           */ "path",
              /* questionToken  */ undefined,
              /* type           */ pathType,
              /* initializer    */ undefined,
            ),
          ],
          /* type          */ pathItemType,
        );
      }

      const property = ts.factory.createPropertySignature(
        /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
        /* name          */ tsPropertyIndex(url),
        /* questionToken */ undefined,
        /* type          */ pathItemType,
      );

      yield* debug(`Transformed path "${url}"`, "ts", performance.now() - pathT);
      return property;
    }),
  );

  return ts.factory.createTypeLiteralNode(type);
});

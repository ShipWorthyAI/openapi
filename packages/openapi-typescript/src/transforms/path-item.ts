import { httpMethods } from "@shipworthy/openapi-transformer";
import type { ParsedOperation, ParsedPathItem } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import {
  addJSDocComment,
  annotationsOf,
  NEVER,
  oapiRef,
  QUESTION_TOKEN,
  tsModifiers,
  tsPropertyIndex,
} from "../lib/ts.ts";
import { createRef } from "../lib/utils.ts";
import type { GlobalContext } from "../types.ts";
import { transformOperation } from "./operation.ts";
import { transformParameters } from "./parameters.ts";

const HASH_RE = /#/g;

/** The index of the top-level `operations` interface in the footer, adding it on first use. */
function operationsIndex(ctx: GlobalContext): number {
  const index = ctx.injectFooter.findIndex(
    (node) => ts.isInterfaceDeclaration(node) && node.name.text === "operations",
  );

  if (index !== -1) return index;

  ctx.injectFooter.push(
    ts.factory.createInterfaceDeclaration(
      // important: do NOT make this immutable
      /* modifiers       */ tsModifiers({ export: true }),
      /* name            */ ts.factory.createIdentifier("operations"),
      /* typeParameters  */ undefined,
      /* heritageClauses */ undefined,
      /* members         */ [],
    ),
  );

  return ctx.injectFooter.length - 1;
}

/** Add an operation to the `operations` interface at `index`. */
function injectOperation(
  ctx: GlobalContext,
  index: number,
  operationId: string,
  members: ts.TypeElement[],
): void {
  const operations = ctx.injectFooter[index];
  if (!operations || !ts.isInterfaceDeclaration(operations)) return;

  ctx.injectFooter[index] = ts.factory.createInterfaceDeclaration(
    operations.modifiers,
    operations.name,
    operations.typeParameters,
    operations.heritageClauses,
    [
      ...operations.members,
      ts.factory.createPropertySignature(
        /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
        /* name          */ tsPropertyIndex(operationId),
        /* questionToken */ undefined,
        /* type          */ ts.factory.createTypeLiteralNode(members),
      ),
    ],
  );
}

/**
 * Transform a Path Item Object (4.8.9) into its `parameters` and one entry per method.
 * Operations with an `operationId` move to the `operations` interface and are referenced here.
 *
 * `url` is the URL template, for `generatePathParams`.
 * @see https://spec.openapis.org/oas/v3.1.0#path-item-object
 */
export const transformPathItem = Effect.fnUntraced(function* (
  item: ParsedPathItem,
  path: string,
  url?: string,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;

  const type: ts.TypeElement[] = [
    yield* transformParameters(item.parameters, createRef([path, "parameters"]), url),
  ];

  for (const method of httpMethods) {
    const operation: ParsedOperation | undefined = item.operations.find(
      (entry) => entry.method.toLowerCase() === method,
    );

    if (!operation || (ctx.excludeDeprecated && operation.deprecated)) {
      type.push(
        ts.factory.createPropertySignature(
          /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
          /* name          */ tsPropertyIndex(method),
          /* questionToken */ QUESTION_TOKEN,
          /* type          */ NEVER,
        ),
      );

      continue;
    }

    const operationPath = createRef([path, method]);
    let operationType: ts.TypeNode;

    if (operation.operationId) {
      // Operation ids can contain "#" when a ref was parsed as part of the id.
      const operationId = operation.operationId.replace(HASH_RE, "/");
      // the interface comes before anything the operation adds to the footer
      const index = operationsIndex(ctx);
      injectOperation(ctx, index, operationId, yield* transformOperation(operation, operationPath));
      operationType = oapiRef(createRef(["operations", operationId]));
    } else {
      operationType = ts.factory.createTypeLiteralNode(
        yield* transformOperation(operation, operationPath),
      );
    }

    const property = ts.factory.createPropertySignature(
      /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
      /* name          */ tsPropertyIndex(method),
      /* questionToken */ undefined,
      /* type          */ operationType,
    );

    addJSDocComment(annotationsOf(operation), property);
    type.push(property);
  }

  return ts.factory.createTypeLiteralNode(type);
});

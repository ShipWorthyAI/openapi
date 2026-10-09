import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Array, Effect, pipe, Predicate, Record, Result, String } from "effect";
import { performance } from "node:perf_hooks";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import {
  NEVER,
  oapiRef,
  STRING,
  stringToAST,
  tsModifiers,
  tsPropertyIndex,
  tsRecord,
} from "../lib/ts.ts";
import { createRef, debug } from "../lib/utils.ts";
import { transformApiPaths } from "./api-paths.ts";
import { transformComponents } from "./components.ts";
import { transformPaths } from "./paths.ts";
import { transformSchema } from "./schema.ts";
import { transformWebhooks } from "./webhooks.ts";

// Inline helper types for readOnly/writeOnly markers (when readWriteMarkers is enabled)
const READ_WRITE_HELPER_TYPES = `
export type $Read<T> = { readonly $read: T };
export type $Write<T> = { readonly $write: T };
export type Readable<T> = T extends $Write<any> ? never : T extends $Read<infer U> ? Readable<U> : T extends (infer E)[] ? Readable<E>[] : T extends object ? { [K in keyof T as NonNullable<T[K]> extends $Write<any> ? never : K]: Readable<T[K]> } : T;
export type Writable<T> = T extends $Read<any> ? never : T extends $Write<infer U> ? Writable<U> : T extends (infer E)[] ? Writable<E>[] : T extends object ? { [K in keyof T as NonNullable<T[K]> extends $Read<any> ? never : K]: Writable<T[K]> } & { [K in keyof T as NonNullable<T[K]> extends $Read<any> ? K : never]?: never } : T;
`;

/** Root aliases for the operations that were emitted, including webhooks and shared path items. */
function operationRootTypes(declarations: readonly ts.Node[]): ts.TypeAliasDeclaration[] {
  const names = new Set([
    "ApiPaths",
    ...Array.filterMap(declarations, (node) =>
      Predicate.hasProperty(node, "name") &&
      Predicate.hasProperty(node.name, "text") &&
      Predicate.isString(node.name.text)
        ? Result.succeed(node.name.text)
        : Result.fail(undefined),
    ),
  ]);

  return pipe(
    declarations,
    Array.filter(ts.isInterfaceDeclaration),
    Array.filter((node) => node.name.text === "operations"),
    Array.flatMap((node) => Array.filter(node.members, ts.isPropertySignature)),
    Array.filterMap((property) => {
      if (
        !Predicate.hasProperty(property.name, "text") ||
        !Predicate.isString(property.name.text)
      ) {
        return Result.fail(undefined);
      }

      const operationId = property.name.text;
      const capitalized = String.capitalize(operationId).replace(/[^a-zA-Z\d_$]/g, "_");
      const baseName = /^\d/.test(capitalized) ? `_${capitalized}` : capitalized;
      let aliasName = baseName;

      for (let counter = 2; names.has(aliasName); counter++) {
        aliasName = `${baseName}_${counter}`;
      }

      names.add(aliasName);

      return Result.succeed(
        ts.factory.createTypeAliasDeclaration(
          /* modifiers      */ tsModifiers({ export: true }),
          /* name           */ aliasName,
          /* typeParameters */ undefined,
          /* type           */ oapiRef(createRef(["operations", operationId])),
        ),
      );
    }),
  );
}

/** The root `$defs`, keyed by name. */
const transformDefs = Effect.fnUntraced(function* (
  $defs: ParsedService["$defs"],
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const members = yield* Effect.forEach(
    Record.toEntries($defs),
    Effect.fnUntraced(function* ([name, schema]) {
      return ts.factory.createPropertySignature(
        /* modifiers     */ undefined,
        /* name          */ tsPropertyIndex(name),
        /* questionToken */ undefined,
        /* type          */ yield* transformSchema(schema, createRef(["$defs", name])),
      );
    }),
  );

  return ts.factory.createTypeLiteralNode(members);
});

/**
 * Transform a parsed document into the declarations of the generated file: `paths`, `webhooks`,
 * `components`, `$defs`, `operations`, and any helpers the types use.
 */
export const transformDocument = Effect.fnUntraced(function* (
  model: ParsedService,
): Effect.fn.Return<ts.Node[], TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;
  const type: ts.Node[] = [];

  if (ctx.readWriteMarkers) {
    type.push(...(stringToAST(READ_WRITE_HELPER_TYPES) as ts.Node[]));
  }

  if (ctx.inject) {
    type.push(...(stringToAST(ctx.inject) as ts.Node[]));
  }

  const roots: readonly [
    string,
    Effect.Effect<ts.Node | ts.Node[], TypegenError, TypegenContext>,
  ][] = [
    ["paths", transformPaths(model.paths)],
    ["webhooks", transformWebhooks(model.webhooks)],
    ["components", transformComponents(model.components)],
    ["$defs", transformDefs(model.$defs)],
  ];

  const rootTypes = yield* Effect.forEach(
    roots,
    Effect.fnUntraced(function* ([root, transform]) {
      const rootT = performance.now();
      const nodes = [yield* transform].flat();

      return yield* Effect.forEach(
        nodes,
        Effect.fnUntraced(function* (node) {
          if (ts.isTypeLiteralNode(node) && node.members.length) {
            const declaration = ctx.exportType
              ? ts.factory.createTypeAliasDeclaration(
                  /* modifiers      */ tsModifiers({ export: true }),
                  /* name           */ root,
                  /* typeParameters */ undefined,
                  /* type           */ node,
                )
              : ts.factory.createInterfaceDeclaration(
                  /* modifiers       */ tsModifiers({ export: true }),
                  /* name            */ root,
                  /* typeParameters  */ undefined,
                  /* heritageClauses */ undefined,
                  /* members         */ node.members,
                );

            yield* debug(`${root} done`, "ts", performance.now() - rootT);
            return declaration;
          } else if (ts.isTypeAliasDeclaration(node)) {
            return node;
          } else {
            const declaration = ts.factory.createTypeAliasDeclaration(
              /* modifiers      */ tsModifiers({ export: true }),
              /* name           */ root,
              /* typeParameters */ undefined,
              /* type           */ tsRecord(STRING, NEVER),
            );

            yield* debug(`${root} done (skipped)`, "ts", 0);
            return declaration;
          }
        }),
      );
    }),
  );

  type.push(...rootTypes.flat());

  type.push(...ctx.injectFooter);

  // if no operations were created, add an empty operations type
  if (
    !ctx.injectFooter.some(
      (node) => ts.isInterfaceDeclaration(node) && node.name.text === "operations",
    )
  ) {
    type.push(
      ts.factory.createTypeAliasDeclaration(
        /* modifiers      */ tsModifiers({ export: true }),
        /* name           */ "operations",
        /* typeParameters */ undefined,
        /* type           */ tsRecord(STRING, NEVER),
      ),
    );
  }

  type.push(yield* transformApiPaths(model.paths));

  if (ctx.rootTypes) {
    type.push(...operationRootTypes(type));
  }

  return type;
});

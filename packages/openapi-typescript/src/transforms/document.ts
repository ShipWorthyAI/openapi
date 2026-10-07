import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import { performance } from "node:perf_hooks";
import ts from "#compiler";
import { TypegenContext } from "../context.js";
import type { TypegenError } from "../errors.js";
import { NEVER, STRING, stringToAST, tsModifiers, tsPropertyIndex, tsRecord } from "../lib/ts.js";
import { createRef, debug, getEntries } from "../lib/utils.js";
import { transformApiPaths } from "./api-paths.js";
import { transformComponents } from "./components.js";
import { transformPaths } from "./paths.js";
import { transformSchema } from "./schema.js";
import { transformWebhooks } from "./webhooks.js";

// Inline helper types for readOnly/writeOnly markers (when readWriteMarkers is enabled)
const READ_WRITE_HELPER_TYPES = `
export type $Read<T> = { readonly $read: T };
export type $Write<T> = { readonly $write: T };
export type Readable<T> = T extends $Write<any> ? never : T extends $Read<infer U> ? Readable<U> : T extends (infer E)[] ? Readable<E>[] : T extends object ? { [K in keyof T as NonNullable<T[K]> extends $Write<any> ? never : K]: Readable<T[K]> } : T;
export type Writable<T> = T extends $Read<any> ? never : T extends $Write<infer U> ? Writable<U> : T extends (infer E)[] ? Writable<E>[] : T extends object ? { [K in keyof T as NonNullable<T[K]> extends $Read<any> ? never : K]: Writable<T[K]> } & { [K in keyof T as NonNullable<T[K]> extends $Read<any> ? K : never]?: never } : T;
`;

/** The root `$defs`, keyed by name. */
const transformDefs = Effect.fnUntraced(function* (
  $defs: ParsedService["$defs"],
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;
  const members: ts.TypeElement[] = [];

  for (const [name, schema] of getEntries($defs, ctx)) {
    members.push(
      ts.factory.createPropertySignature(
        /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
        /* name          */ tsPropertyIndex(name),
        /* questionToken */ undefined,
        /* type          */ yield* transformSchema(schema, createRef(["$defs", name])),
      ),
    );
  }

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

  for (const [root, transform] of roots) {
    const rootT = performance.now();
    const nodes = [yield* transform].flat();

    for (const node of nodes) {
      if (ts.isTypeLiteralNode(node) && node.members.length) {
        type.push(
          ctx.exportType
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
              ),
        );

        debug(`${root} done`, "ts", performance.now() - rootT);
      } else if (ts.isTypeAliasDeclaration(node)) {
        type.push(node);
      } else {
        type.push(
          ts.factory.createTypeAliasDeclaration(
            /* modifiers      */ tsModifiers({ export: true }),
            /* name           */ root,
            /* typeParameters */ undefined,
            /* type           */ tsRecord(STRING, NEVER),
          ),
        );

        debug(`${root} done (skipped)`, "ts", 0);
      }
    }
  }

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

  if (ctx.makePathsEnum) {
    type.push(yield* transformApiPaths(model.paths));
  }

  return type;
});

import type { ParsedComponents, ParsedSchema } from "@shipworthy/openapi-transformer";
import { Effect, Predicate } from "effect";
import * as changeCase from "change-case";
import { performance } from "node:perf_hooks";
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
import { createRef, debug, getEntries } from "../lib/utils.js";
import { transformHeader } from "./header.js";
import { transformParameter } from "./parameter.js";
import { transformPathItem } from "./path-item.js";
import { transformRequestBody } from "./request-body.js";
import { transformResponse } from "./response.js";
import { transformSchema } from "./schema.js";

type ComponentKey =
  | "schemas"
  | "responses"
  | "parameters"
  | "requestBodies"
  | "headers"
  | "pathItems";

/**
 * True for a schema that `--enum` turns into a TypeScript enum. `--root-types` skips these so the
 * enum is not exported twice.
 */
export function isEnumSchema(schema: unknown): boolean {
  return (
    Predicate.isObject(schema) &&
    Array.isArray(schema.enum) &&
    schema.type !== "object" &&
    !("properties" in schema) &&
    !("additionalProperties" in schema)
  );
}

export function singularizeComponentKey(key: ComponentKey): string {
  // requestBodies is the only irregular plural
  return key === "requestBodies" ? "requestBody" : key.slice(0, -1);
}

interface Component {
  readonly type: ts.TypeNode;
  readonly questionToken: boolean;
  readonly doc: ParsedSchema;
}

type ComponentTransform<A> = (
  node: A,
  path: string,
) => Effect.Effect<Component, TypegenError, TypegenContext>;

const schemaComponent = Effect.fnUntraced(function* (
  schema: ParsedSchema,
  path: string,
): Effect.fn.Return<Component, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;

  const hooked = Predicate.isObject(schema)
    ? ctx.transform?.(schema, { path, schema, ctx })
    : undefined;

  if (hooked && "schema" in hooked) {
    return { type: hooked.schema, questionToken: hooked.questionToken, doc: schema };
  }

  return {
    type: hooked ?? (yield* transformSchema(schema, path)),
    questionToken: false,
    doc: schema,
  };
});

/** A component that may alias another through `$ref`, which prints as a reference. */
function sharedComponent<A extends Parameters<typeof annotationsOf>[0]>(
  transform: (node: A, path: string) => Effect.Effect<ts.TypeNode, TypegenError, TypegenContext>,
): ComponentTransform<A> {
  return Effect.fnUntraced(function* (node, path) {
    const type = node.reference
      ? yield* refType(node.reference.$ref)
      : yield* transform(node, path);

    return { type, questionToken: false, doc: annotationsOf(node) };
  });
}

/** The members of one component group, such as `schemas`. Root type aliases go into `rootTypeAliases`. */
function transformGroup<A>(
  key: ComponentKey,
  nodes: Readonly<Record<string, A>>,
  transform: ComponentTransform<A>,
  rootTypeAliases: Record<string, ts.TypeAliasDeclaration>,
): Effect.Effect<ts.PropertySignature, TypegenError, TypegenContext> {
  return Effect.gen(function* () {
    const ctx = yield* TypegenContext;
    const componentT = performance.now();
    const items: ts.TypeElement[] = [];

    for (const [name, node] of getEntries(nodes, ctx)) {
      const { type, questionToken, doc } = yield* transform(
        node,
        createRef(["components", key, name]),
      );

      const property = ts.factory.createPropertySignature(
        /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
        /* name          */ tsPropertyIndex(name),
        /* questionToken */ questionToken ? QUESTION_TOKEN : undefined,
        /* type          */ type,
      );

      addJSDocComment(doc, property);
      items.push(property);

      // with --enum, an enum schema is already exported as a TypeScript enum
      if (ctx.rootTypes && !(ctx.enum && key === "schemas" && isEnumSchema(node))) {
        const componentKey = changeCase.pascalCase(singularizeComponentKey(key));

        const componentName =
          ctx.rootTypesKeepCasing && key === "schemas" ? name : changeCase.pascalCase(name);

        let aliasName = `${componentKey}${componentName}`;

        // Add counter suffix (e.g. "_2") if conflict in name
        for (let counter = 2; rootTypeAliases[aliasName] !== undefined; counter++) {
          aliasName = `${componentKey}${componentName}_${counter}`;
        }

        const ref = ts.factory.createTypeReferenceNode(`components['${key}']['${name}']`);

        if (ctx.rootTypesNoSchemaPrefix && key === "schemas") {
          aliasName = aliasName.replace(componentKey, "");
        }

        rootTypeAliases[aliasName] = ts.factory.createTypeAliasDeclaration(
          /* modifiers      */ tsModifiers({ export: true }),
          /* name           */ aliasName,
          /* typeParameters */ undefined,
          /* type           */ ref,
        );
      }
    }

    debug(`Transformed components → ${key}`, "ts", performance.now() - componentT);

    return ts.factory.createPropertySignature(
      /* modifiers     */ undefined,
      /* name          */ tsPropertyIndex(key),
      /* questionToken */ undefined,
      /* type          */ items.length ? ts.factory.createTypeLiteralNode(items) : NEVER,
    );
  });
}

/**
 * Transform the Components Object (4.8.7) into the `components` type, plus root type aliases
 * with `rootTypes`.
 * @see https://spec.openapis.org/oas/latest.html#components-object
 */
export const transformComponents = Effect.fnUntraced(function* (
  components: ParsedComponents,
): Effect.fn.Return<ts.Node[], TypegenError, TypegenContext> {
  const aliases: Record<string, ts.TypeAliasDeclaration> = {};

  const type = [
    yield* transformGroup("schemas", components.schemas, schemaComponent, aliases),
    yield* transformGroup(
      "responses",
      components.responses,
      sharedComponent(transformResponse),
      aliases,
    ),
    yield* transformGroup(
      "parameters",
      components.parameters,
      sharedComponent(transformParameter),
      aliases,
    ),
    yield* transformGroup(
      "requestBodies",
      components.requestBodies,
      sharedComponent(transformRequestBody),
      aliases,
    ),
    yield* transformGroup("headers", components.headers, sharedComponent(transformHeader), aliases),
    yield* transformGroup(
      "pathItems",
      components.pathItems,
      sharedComponent(transformPathItem),
      aliases,
    ),
  ];

  return [ts.factory.createTypeLiteralNode(type), ...Object.values(aliases)];
});

import type { ParsedSchema } from "@shipworthy/openapi-transformer";
import { Effect, type JsonSchema, Predicate } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import { parseRef } from "../lib/ref.ts";
import {
  addJSDocComment,
  BOOLEAN,
  NEVER,
  NULL,
  NUMBER,
  oapiRef,
  QUESTION_TOKEN,
  refType,
  STRING,
  tsArrayLiteralExpression,
  tsEnum,
  tsIntersection,
  tsIsPrimitive,
  tsLiteral,
  tsModifiers,
  tsOmit,
  tsPropertyIndex,
  tsRecord,
  tsUnion,
  tsWithRequired,
  UNDEFINED,
  UNKNOWN,
} from "../lib/ts.ts";
import {
  discriminatorOf,
  stringList,
  subschema,
  subschemaList,
  subschemaMap,
} from "../lib/schema.ts";
import { createDiscriminatorProperty, createRef, getEntries } from "../lib/utils.ts";
import type { GlobalContext, TransformObject } from "../types.ts";

type Transformed = Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext>;

/**
 * Transform a Schema Object (4.8.24) into a type.
 * @see https://spec.openapis.org/oas/v3.1.0#schema-object
 */
export const transformSchema = Effect.fnUntraced(function* (
  schema: ParsedSchema | undefined,
  path: string,
  fromAdditionalProperties = false,
): Transformed {
  const ctx = yield* TypegenContext;
  const type = yield* transformComposition(schema, path, fromAdditionalProperties);

  return (
    ctx.postTransform?.(type, { path, ctx, ...(schema === undefined ? {} : { schema }) }) ?? type
  );
});

/** A `transform` hook result as a type, or `undefined` when the hook does not handle the schema. */
function hookType(result: ts.TypeNode | TransformObject | undefined): ts.TypeNode | undefined {
  if (!result) return undefined;
  if (!("schema" in result)) return result;

  return result.questionToken
    ? ts.factory.createUnionTypeNode([result.schema, UNDEFINED])
    : result.schema;
}

/** The schema a `$ref` points to, if it is an object schema. */
function resolveSchema(ctx: GlobalContext, $ref: string): JsonSchema.JsonSchema | undefined {
  const resolved = ctx.resolve($ref);
  return Predicate.isObject(resolved) ? resolved : undefined;
}

function stringAt(value: unknown, index: number): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const entry: unknown = value[index];
  return typeof entry === "string" ? entry : undefined;
}

/** Should this enum become a TypeScript `enum`? */
function shouldTransformToTsEnum(
  ctx: GlobalContext,
  schema: JsonSchema.JsonSchema,
  values: readonly unknown[],
): boolean {
  if (!ctx.enum) {
    return false;
  }

  if (!values.every((value) => typeof value === "string" || typeof value === "number")) {
    return false;
  }

  // With conditionalEnums, only convert when x-enum-* metadata is present
  if (ctx.conditionalEnums) {
    return ["x-enum-varnames", "x-enumNames", "x-enum-descriptions", "x-enumDescriptions"].some(
      (key) => Array.isArray(schema[key]),
    );
  }

  return true;
}

function applyAdditionalPropertiesToEnum(
  hasAdditionalProperties: boolean,
  unionType: ts.TypeNode,
  schema: JsonSchema.JsonSchema,
): ts.TypeNode {
  // If additionalProperties is true, add (string & {}) to the union
  if (hasAdditionalProperties && schema.type === "string") {
    const stringAndEmptyObject = tsIntersection([STRING, ts.factory.createTypeLiteralNode([])]);
    return tsUnion([unionType, stringAndEmptyObject]);
  }

  return unionType;
}

/** Wrap a type with a `$Read` or `$Write` marker when `readWriteMarkers` is on. */
function wrapWithReadWriteMarker(
  type: ts.TypeNode,
  readOnly: boolean,
  writeOnly: boolean,
  ctx: GlobalContext,
): ts.TypeNode {
  if (!ctx.readWriteMarkers || (readOnly && writeOnly)) {
    return type;
  }

  if (readOnly) {
    return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("$Read"), [type]);
  }

  if (writeOnly) {
    return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("$Write"), [type]);
  }

  return type;
}

/** The pointer of an enum's type, skipping `anyOf`/`oneOf` indexes, and the properties after them that need `Extract<>`. */
function enumValuesRef(path: string): { ref: string; extractProperties: string[] } {
  const pointer = parseRef(path).pointer;
  const cleaned: string[] = [];
  // Every property after a union index gets Extract<> narrowing: a no-op when all variants have
  // the property, and the right narrowing when only some do.
  const extractProperties: string[] = [];

  for (let index = 0; index < pointer.length; index++) {
    const segment = pointer[index] ?? "";
    const next = pointer[index + 1];

    if ((segment === "anyOf" || segment === "oneOf") && next !== undefined && /^\d+$/.test(next)) {
      index++;

      for (const rest of pointer.slice(index + 1)) {
        if (rest !== "anyOf" && rest !== "oneOf" && !/^\d+$/.test(rest)) {
          extractProperties.push(rest);
        }
      }

      continue;
    }

    cleaned.push(segment);
  }

  return { ref: createRef(cleaned), extractProperties };
}

/** `enum` on a non-object schema. `undefined` when the enum does not decide the type. */
function transformEnum(
  ctx: GlobalContext,
  schema: JsonSchema.JsonSchema,
  values: readonly unknown[],
  path: string,
  fromAdditionalProperties: boolean,
): ts.TypeNode | undefined {
  const hasAdditionalProperties = !!schema.additionalProperties;

  if (hasAdditionalProperties && schema.type !== "string") {
    return undefined;
  }

  // hoist enum to top level if string/number enum and option is enabled
  if (shouldTransformToTsEnum(ctx, schema, values)) {
    // allow #/components/schemas to have simpler names
    const enumName = parseRef(path).pointer.join("/").replace("components/schemas", "");

    const metadata = values.map((_, index) => ({
      name: stringAt(schema["x-enum-varnames"], index) ?? stringAt(schema["x-enumNames"], index),
      description:
        stringAt(schema["x-enum-descriptions"], index) ??
        stringAt(schema["x-enumDescriptions"], index),
    }));

    const members = values.filter(
      (value): value is string | number => typeof value === "string" || typeof value === "number",
    );

    const enumType = tsEnum(enumName, members, metadata, {
      shouldCache: ctx.dedupeEnums,
      export: true,
      // readonly: TS enum do not support the readonly modifier
    });

    if (!ctx.injectFooter.includes(enumType)) {
      ctx.injectFooter.push(enumType);
    }

    const ref = ts.factory.createTypeReferenceNode(enumType.name);
    return applyAdditionalPropertiesToEnum(hasAdditionalProperties, ref, schema);
  }

  const enumType = values.map(tsLiteral);

  if (Array.isArray(schema.type) && schema.type.includes("null")) {
    enumType.push(NULL);
  }

  const unionType = applyAdditionalPropertiesToEnum(
    hasAdditionalProperties,
    tsUnion(enumType),
    schema,
  );

  // hoist array with valid enum values to top level if string/number enum and option is enabled
  if (
    ctx.enumValues &&
    values.every((value) => typeof value === "string" || typeof value === "number")
  ) {
    // allow #/components/schemas to have simpler names
    const name = `${parseRef(path).pointer.join("/").replace("components/schemas", "")}Values`;
    const { ref, extractProperties } = enumValuesRef(path);
    const valuesType = oapiRef(ref, undefined, { deep: true, extractProperties });

    const enumValuesArray = tsArrayLiteralExpression(
      name,
      // a record's values are indexed with [string]
      fromAdditionalProperties
        ? ts.factory.createIndexedAccessTypeNode(
            valuesType,
            ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("string")),
          )
        : valuesType,
      values as (string | number)[],
      {
        export: true,
        readonly: true,
        injectFooter: ctx.injectFooter,
      },
    );

    ctx.injectFooter.push(enumValuesArray);
  }

  return unionType;
}

const transformComposition = Effect.fnUntraced(function* (
  schema: ParsedSchema | undefined,
  path: string,
  fromAdditionalProperties: boolean,
): Transformed {
  const ctx = yield* TypegenContext;

  // a missing schema or `false` accepts nothing
  if (schema === undefined || schema === false) {
    return NEVER;
  }

  // `true` accepts anything
  if (schema === true) {
    return UNKNOWN;
  }

  if (Predicate.isString(schema.$ref)) {
    return yield* refType(schema.$ref);
  }

  // const (valid for any type)
  if (schema.const !== null && schema.const !== undefined) {
    return tsLiteral(schema.const);
  }

  const values = Array.isArray(schema.enum) ? schema.enum : undefined;

  // enum (non-objects). Object enums are handled with oneOf below.
  if (values && schema.type !== "object" && !schema.properties) {
    const enumType = transformEnum(ctx, schema, values, path, fromAdditionalProperties);

    if (enumType) return enumType;
  }

  let finalType: ts.TypeNode | undefined;
  // a list of types transforms each non-null type with the schema's allOf/anyOf already applied
  const perType = Array.isArray(schema.type) && schema.type.some((type) => type !== "null");

  // core + allOf: intersect
  const coreObjectType = yield* transformCore(schema, path);

  const allOfType = perType
    ? []
    : yield* collectAllOf(
        subschemaList(schema.allOf) ?? [],
        stringList(schema.required) ?? [],
        path,
      );

  if (coreObjectType || allOfType.length) {
    finalType = tsIntersection([
      ...(coreObjectType ? [coreObjectType] : []),
      ...(allOfType.length ? [tsIntersection(allOfType)] : []),
    ]);
  }

  // anyOf: union
  // (TypeScript’s unions are not true XORs, so they behave closer to anyOf than oneOf)
  const anyOfType = perType
    ? []
    : yield* collectUnion(subschemaList(schema.anyOf) ?? [], "anyOf", path);

  if (anyOfType.length) {
    finalType = tsUnion([...(finalType ? [finalType] : []), ...anyOfType]);
  }

  // oneOf: union (within intersection with other types, if any). An object enum lists its values.
  const oneOf = subschemaList(schema.oneOf);

  const oneOfType = oneOf
    ? yield* collectUnion(oneOf, "oneOf", path)
    : schema.type === "object" && values
      ? values.map(tsLiteral)
      : [];

  if (oneOfType.length) {
    // note: oneOf is the only type that may include primitives
    finalType = oneOfType.every(tsIsPrimitive)
      ? tsUnion([...(finalType ? [finalType] : []), ...oneOfType])
      : tsIntersection([...(finalType ? [finalType] : []), tsUnion(oneOfType)]);
  }

  // When no type can be generated, fall back to unknown (or related variants)
  if (!finalType) {
    finalType =
      schema.type !== undefined
        ? tsRecord(STRING, ctx.emptyObjectsUnknown ? UNKNOWN : NEVER)
        : UNKNOWN;
  }

  return finalType;
});

/** Collect oneOf/anyOf members. */
const collectUnion = Effect.fnUntraced(function* (
  items: readonly ParsedSchema[],
  unionKey: "anyOf" | "oneOf",
  path: string,
): Effect.fn.Return<ts.TypeNode[], TypegenError, TypegenContext> {
  // The index keeps generated names of nested enums unique.
  return yield* Effect.forEach(items, (item, index) =>
    transformSchema(item, createRef([path, unionKey, String(index)])),
  );
});

/** Collect allOf members, with WithRequired<> for the parent's required keys and Omit<> for discriminators. */
const collectAllOf = Effect.fnUntraced(function* (
  items: readonly ParsedSchema[],
  required: readonly string[],
  path: string,
): Effect.fn.Return<ts.TypeNode[], TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;

  return yield* Effect.forEach(
    items,
    Effect.fnUntraced(function* (item) {
      let itemType: ts.TypeNode;

      const $ref =
        Predicate.isObject(item) && Predicate.isString(item.$ref) ? item.$ref : undefined;

      if ($ref !== undefined) {
        itemType = yield* transformSchema(item, path);
        const properties = subschemaMap(resolveSchema(ctx, $ref)?.properties);

        // make keys required, unless the discriminator scan already did
        if (properties && !ctx.discriminators.refsHandled.includes($ref)) {
          const validRequired = required.filter((key) => properties[key] !== undefined);

          if (validRequired.length) {
            itemType = tsWithRequired(itemType, validRequired, ctx.injectFooter);
          }
        }
      } else if (Predicate.isObject(item)) {
        // combine the parent's `required` with the item's own
        itemType = yield* transformSchema(
          { ...item, required: [...required, ...(stringList(item.required) ?? [])] },
          path,
        );
      } else {
        itemType = yield* transformSchema(item, path);
      }

      const discriminator = Predicate.isObject(item)
        ? (($ref !== undefined ? ctx.discriminators.objects[$ref] : undefined) ??
          discriminatorOf(item.discriminator))
        : undefined;

      return discriminator ? tsOmit(itemType, [discriminator.propertyName]) : itemType;
    }),
  );
});

/** `type: array`, with tuples and `arrayLength`. */
const transformArray = Effect.fnUntraced(function* (
  schema: JsonSchema.JsonSchema,
  path: string,
): Transformed {
  const ctx = yield* TypegenContext;
  // default to `unknown[]`
  let itemType: ts.TypeNode = UNKNOWN;

  const prefixItems = subschemaList(schema.prefixItems);
  const items = subschema(schema.items);

  if (prefixItems) {
    const elements = yield* Effect.forEach(prefixItems, (item) => transformSchema(item, path));
    itemType = ts.factory.createTupleTypeNode(elements);
  } else if (items !== undefined) {
    const itemsType = yield* transformSchema(items, path);

    itemType =
      Predicate.isObject(items) && items.type === "array"
        ? ts.factory.createArrayTypeNode(itemsType)
        : itemsType;
  }

  const { minItems, maxItems } = schema;
  const min = Predicate.isNumber(minItems) && minItems >= 0 ? minItems : 0;

  const max =
    Predicate.isNumber(maxItems) && maxItems >= 0 && min <= maxItems ? maxItems : undefined;

  const estimateCodeSize = typeof max !== "number" ? min : (max * (max + 1) - min * (min - 1)) / 2;

  // "30" is roughly where TS starts to struggle with tuple inference
  if (ctx.arrayLength && (min !== 0 || max !== undefined) && estimateCodeSize < 30) {
    if (min === max) {
      return tsUnion([ts.factory.createTupleTypeNode(Array.from({ length: min }, () => itemType))]);
    }

    if (max !== undefined && max > 0) {
      // a union of every tuple length from min to max
      const members: ts.TypeNode[] = [];

      for (let length = min; length <= max; length++) {
        members.push(
          ts.factory.createTupleTypeNode(Array.from({ length: length - min }, () => itemType)),
        );
      }

      return tsUnion(members);
    }

    // without maxItems, a tuple of `min` items and a rest element
    return ts.factory.createTupleTypeNode([
      ...Array.from({ length: min }, () => itemType),
      ts.factory.createRestTypeNode(ts.factory.createArrayTypeNode(itemType)),
    ]);
  }

  // wrap itemType in array type, but only if not a tuple or array already
  const finalType =
    ts.isTupleTypeNode(itemType) || ts.isArrayTypeNode(itemType)
      ? itemType
      : ts.factory.createArrayTypeNode(itemType);

  return ctx.immutable
    ? ts.factory.createTypeOperatorNode(ts.SyntaxKind.ReadonlyKeyword, finalType)
    : finalType;
});

/** A schema without its allOf/anyOf/oneOf. */
const transformCore = Effect.fnUntraced(function* (
  schema: JsonSchema.JsonSchema,
  path: string,
): Effect.fn.Return<ts.TypeNode | undefined, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;

  if (schema.type !== undefined) {
    const hooked = hookType(ctx.transform?.(schema, { path, schema, ctx }));
    if (hooked) return hooked;

    switch (schema.type) {
      case "null":
        return NULL;
      case "string":
        return STRING;
      case "number":
      case "integer":
        return NUMBER;
      case "boolean":
        return BOOLEAN;
      case "array":
        return yield* transformArray(schema, path);
    }

    // a list of types, which is also how 3.1 spells nullable
    const types = stringList(schema.type);

    if (types) {
      const oneOf = subschemaList(schema.oneOf);

      const members = yield* Effect.forEach(
        types,
        Effect.fnUntraced(function* (type) {
          // skip primitive types that oneOf also lists, and don't stack oneOf transforms
          if (
            oneOf &&
            type !== "object" &&
            type !== "array" &&
            oneOf.some((item) => Predicate.isObject(item) && item.type === type)
          ) {
            return undefined;
          }

          return type === "null"
            ? NULL
            : yield* transformSchema(
                oneOf ? { ...schema, type, oneOf: undefined } : { ...schema, type },
                path,
              );
        }),
      );

      return tsUnion(members.filter(Predicate.isNotUndefined));
    }
  }

  // type: object
  const coreObjectType: ts.TypeElement[] = [];

  // discriminators: for inheritance gathered by the discriminator scan. A schema that declares
  // a discriminator for its children does not reference it, and patched refs are already done.
  if ((schema.allOf || schema.anyOf) && !schema.discriminator) {
    const discriminator = ctx.discriminators.refsHandled.includes(path)
      ? undefined
      : ctx.discriminators.objects[path];

    if (discriminator) {
      coreObjectType.unshift(
        createDiscriminatorProperty(discriminator, { path, readonly: ctx.immutable }),
      );
    }
  }

  const properties = subschemaMap(schema.properties) ?? {};
  const $defs = subschemaMap(schema.$defs) ?? {};

  if (
    !Object.keys(properties).length &&
    !schema.additionalProperties &&
    !schema.patternProperties &&
    !schema.$defs
  ) {
    return coreObjectType.length ? ts.factory.createTypeLiteralNode(coreObjectType) : undefined;
  }

  const propertyTypes = yield* Effect.forEach(getEntries(properties, ctx), ([key, value]) =>
    transformProperty(schema, key, value, path),
  );

  coreObjectType.push(...propertyTypes.filter(Predicate.isNotUndefined));

  if (Object.keys($defs).length) {
    const defKeys = yield* Effect.forEach(
      Object.entries($defs),
      Effect.fnUntraced(function* ([key, value]) {
        const defPath = createRef([path, "$defs", key]);
        const readOnly = Predicate.isObject(value) && value.readOnly === true;
        const writeOnly = Predicate.isObject(value) && value.writeOnly === true;

        const defType = wrapWithReadWriteMarker(
          yield* transformSchema(value, defPath),
          readOnly,
          writeOnly,
          ctx,
        );

        let property = ts.factory.createPropertySignature(
          /* modifiers     */ tsModifiers({
            readonly: ctx.immutable || (!ctx.readWriteMarkers && readOnly),
          }),
          /* name          */ tsPropertyIndex(key),
          /* questionToken */ undefined,
          /* type          */ defType,
        );

        if (Predicate.isObject(value)) {
          property = ctx.transformProperty?.(property, value, { path: defPath, ctx }) ?? property;
        }

        addJSDocComment(value, property);
        return property;
      }),
    );

    coreObjectType.push(
      ts.factory.createPropertySignature(
        /* modifiers     */ undefined,
        /* name          */ tsPropertyIndex("$defs"),
        /* questionToken */ undefined,
        /* type          */ ts.factory.createTypeLiteralNode(defKeys),
      ),
    );
  }

  // additionalProperties / patternProperties
  const additionalProperties = subschema(schema.additionalProperties);

  const additionalKeys = Predicate.isObject(additionalProperties)
    ? Object.keys(additionalProperties).length
    : 0;

  const stringIndexTypes: ts.TypeNode[] = [];

  if (Predicate.isObject(additionalProperties) && additionalKeys > 0) {
    stringIndexTypes.push(yield* transformSchema(additionalProperties, path, true));
  }

  if (
    additionalProperties === true ||
    (Predicate.isObject(additionalProperties) && additionalKeys === 0) ||
    (!additionalProperties && ctx.additionalProperties)
  ) {
    stringIndexTypes.push(UNKNOWN);
  }

  const patternTypes = yield* Effect.forEach(
    getEntries(subschemaMap(schema.patternProperties) ?? {}, ctx),
    ([, value]) => transformSchema(value, path),
  );

  stringIndexTypes.push(...patternTypes);

  if (stringIndexTypes.length === 0) {
    return coreObjectType.length ? ts.factory.createTypeLiteralNode(coreObjectType) : undefined;
  }

  return tsIntersection([
    ...(coreObjectType.length ? [ts.factory.createTypeLiteralNode(coreObjectType)] : []),
    ts.factory.createTypeLiteralNode([
      ts.factory.createIndexSignature(
        /* modifiers  */ tsModifiers({ readonly: ctx.immutable }),
        /* parameters */ [
          ts.factory.createParameterDeclaration(
            /* modifiers      */ undefined,
            /* dotDotDotToken */ undefined,
            /* name           */ ts.factory.createIdentifier("key"),
            /* questionToken  */ undefined,
            /* type           */ STRING,
          ),
        ],
        /* type       */ tsUnion(stringIndexTypes),
      ),
    ]),
  ]);
});

/** One entry of `properties`, or `undefined` when `excludeDeprecated` drops it. */
const transformProperty = Effect.fnUntraced(function* (
  schema: JsonSchema.JsonSchema,
  key: string,
  value: ParsedSchema,
  path: string,
): Effect.fn.Return<ts.PropertySignature | undefined, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;
  const propertyPath = createRef([path, key]);
  const object = Predicate.isObject(value) ? value : undefined;
  const $ref = Predicate.isString(object?.$ref) ? object.$ref : undefined;
  const readOnly = object?.readOnly === true;
  const writeOnly = object?.writeOnly === true;
  const hasDefault = object?.default !== undefined;

  if (ctx.excludeDeprecated) {
    const resolved = $ref !== undefined ? resolveSchema(ctx, $ref) : object;
    if (resolved?.deprecated) return undefined;
  }

  // a property with a default is always present, except in parameters and request bodies
  const requiredKeys = stringList(schema.required);

  const required =
    requiredKeys?.includes(key) ||
    (requiredKeys === undefined && ctx.propertiesRequiredByDefault) ||
    (hasDefault &&
      ctx.defaultNonNullable &&
      !path.includes("parameters") &&
      !path.includes("requestBody") &&
      !path.includes("requestBodies"));

  let optional = required ? undefined : QUESTION_TOKEN;

  let type =
    $ref !== undefined ? yield* refType($ref) : yield* transformSchema(value, propertyPath);

  if (object) {
    const result = ctx.transform?.(object, { path, schema, ctx });

    if (result && "schema" in result) {
      type = result.schema;
      optional = result.questionToken ? QUESTION_TOKEN : optional;
    } else if (result) {
      type = result;
    }
  }

  type = wrapWithReadWriteMarker(type, readOnly, writeOnly, ctx);

  let property = ts.factory.createPropertySignature(
    /* modifiers     */ tsModifiers({
      readonly: ctx.immutable || (!ctx.readWriteMarkers && readOnly),
    }),
    /* name          */ tsPropertyIndex(key),
    /* questionToken */ optional,
    /* type          */ type,
  );

  if (object) {
    property = ctx.transformProperty?.(property, object, { path: propertyPath, ctx }) ?? property;
  }

  addJSDocComment(value, property);
  return property;
});

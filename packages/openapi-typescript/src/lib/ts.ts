import type {
  ParsedExample,
  ParsedParameter,
  ParsedRef,
  ParsedSchema,
} from "@shipworthy/openapi-transformer";
import { Effect, type JsonSchema, Predicate } from "effect";
import ts, { type LiteralTypeNode, type TypeLiteralNode } from "#compiler";
import { TypegenError } from "../errors.ts";
import { parseRef } from "./ref.ts";

export const JS_PROPERTY_INDEX_RE = /^[A-Za-z_$][A-Za-z_$0-9]*$/;
export const JS_ENUM_INVALID_CHARS_RE = /[^A-Za-z_$0-9]+(.)?/g;
export const JS_PROPERTY_INDEX_INVALID_CHARS_RE = /[^A-Za-z_$0-9]+/g;
export const SPECIAL_CHARACTER_MAP: Record<string, string> = {
  "+": "Plus",
  // Add more mappings as needed
};

export const BOOLEAN = ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
export const FALSE = ts.factory.createLiteralTypeNode(ts.factory.createFalse());
export const NEVER = ts.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
export const NULL = ts.factory.createLiteralTypeNode(ts.factory.createNull());
export const NUMBER = ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
export const QUESTION_TOKEN = ts.factory.createToken(ts.SyntaxKind.QuestionToken);
export const STRING = ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
export const TRUE = ts.factory.createLiteralTypeNode(ts.factory.createTrue());
export const UNDEFINED = ts.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword);
export const UNKNOWN = ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword);

const LB_RE = /\r?\n/g;
const COMMENT_RE = /\*\//g;

/**
 * The JSDoc fields of a parsed parameter, header, response, or other non-schema node.
 *
 * A node reached through a `$ref` prints as a reference, so by default only the Reference
 * Object's own `summary` and `description` apply. With `inherit`, the target's fields fill in
 * whatever the Reference Object leaves out.
 */
export function annotationsOf(
  node: {
    readonly id?: string;
    readonly reference?: ParsedRef;
    readonly summary?: string;
    readonly description?: string;
    readonly deprecated?: boolean;
    readonly examples?: readonly ParsedExample[];
  },
  { inherit = false }: { inherit?: boolean } = {},
): JsonSchema.JsonSchema {
  const own = node.reference && !inherit ? {} : node;
  const summary = node.reference?.summary ?? own.summary;
  const description = node.reference?.description ?? own.description;
  // the `example` keyword, not a named example that happens to be called `default`
  const example = own.examples?.find((entry) => entry.id === `${node.id}/example`);

  return {
    ...(summary !== undefined ? { summary } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(own.deprecated ? { deprecated: true } : {}),
    ...(example && "value" in example ? { example: example.value } : {}),
  };
}

/**
 * Preparing comments from fields
 * @see {comment} for output examples
 * @returns void if not comments or jsdoc format comment string
 */
export function addJSDocComment(schema: ParsedSchema, node: ts.PropertySignature): void {
  if (!Predicate.isObject(schema)) {
    return;
  }

  const output: string[] = [];

  // Not JSDoc tags: [title, format]
  if (Predicate.isString(schema.title) && schema.title) {
    output.push(schema.title.trim().replace(LB_RE, "\n *     "));
  }

  if (Predicate.isString(schema.summary) && schema.summary) {
    output.push(schema.summary.trim().replace(LB_RE, "\n *     "));
  }

  if (Predicate.isString(schema.format) && schema.format) {
    output.push(`Format: ${schema.format}`);
  }

  // JSDoc tags without value
  // 'Deprecated' without value
  if (schema.deprecated) {
    output.push("@deprecated");
  }

  // JSDoc tags with value
  const supportedJsDocTags = ["description", "default", "example"] as const;

  for (const field of supportedJsDocTags) {
    const allowEmptyString = field === "default" || field === "example";
    const value = schema[field];

    if (value === undefined) {
      continue;
    }

    if (value === "" && !allowEmptyString) {
      continue;
    }

    const serialized =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value, null, 2);

    output.push(`@${field} ${serialized.trim().replace(LB_RE, "\n *     ")}`);
  }

  if (Array.isArray(schema.examples)) {
    for (const example of schema.examples) {
      const serialized = typeof example === "object" ? JSON.stringify(example, null, 2) : example;
      output.push(`@example ${String(serialized).trim().replace(LB_RE, "\n *     ")}`);
    }
  }

  // JSDoc 'Constant' without value
  if ("const" in schema) {
    output.push("@constant");
  }

  // JSDoc 'Enum' with type
  if (schema.enum) {
    let type = "unknown";

    if (Array.isArray(schema.type)) {
      type = schema.type.join("|");
    } else if (typeof schema.type === "string") {
      type = schema.type;
    }

    output.push(`@enum {${type}}`);
  }

  // attach comment if it has content

  if (output.length) {
    // Check if any output item contains multi-line content (has internal line breaks)
    const hasMultiLineContent = output.some((item) => item.includes("\n"));

    let text =
      output.length === 1 && !hasMultiLineContent
        ? `* ${output.join("\n")} `
        : `*\n * ${output.join("\n * ")}\n `;

    text = text.replace(COMMENT_RE, "*\\/"); // prevent inner comments from leaking

    ts.addSyntheticLeadingComment(
      /* node               */ node,
      /* kind               */ ts.SyntaxKind.MultiLineCommentTrivia, // note: MultiLine just refers to a "/* */" comment
      /* text               */ text,
      /* hasTrailingNewLine */ true,
    );
  }
}

function addIndexedAccess(node: ts.TypeNode, ...segments: readonly string[]) {
  return segments.reduce<ts.TypeNode>((acc, segment) => {
    return ts.factory.createIndexedAccessTypeNode(
      acc,
      ts.factory.createLiteralTypeNode(
        typeof segment === "number"
          ? ts.factory.createNumericLiteral(segment)
          : ts.factory.createStringLiteral(segment),
      ),
    );
  }, node);
}

/**
 * Wrap a type with Extract<T, { propertyName: unknown }> to narrow a union type
 * before accessing a property that only exists on some variants.
 */
function wrapWithExtract(type: ts.TypeNode, propertyName: string): ts.TypeNode {
  return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Extract"), [
    type,
    ts.factory.createTypeLiteralNode([
      ts.factory.createPropertySignature(
        /* modifiers     */ undefined,
        /* name          */ ts.factory.createIdentifier(propertyName),
        /* questionToken */ undefined,
        /* type          */ ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
      ),
    ]),
  ]);
}

export interface OapiRefOptions {
  /** Whether to wrap with FlattenedDeepRequired<> (default: false) */
  deep?: boolean;
  /** Array of property names to wrap with Extract<> when accessing */
  extractProperties?: string[];
}

/**
 * Convert OpenAPI ref into TS indexed access node (ex: `components["schemas"]["Foo"]`)
 * `path` is a JSON Pointer to a location within an OpenAPI document.
 * Transform it into a TypeScript type reference into the generated types.
 *
 * In most cases the structures of the openapi-typescript generated types and the
 * JSON Pointer paths into the OpenAPI document are the same. However, in some cases
 * special transformations are necessary to account for the ways they differ.
 *   * Object schemas
 *       $refs into the `properties` of object schemas are valid, but openapi-typescript
 *       flattens these objects, so we omit  so the index into the schema skips ["properties"]
 *   * Parameters
 *       $refs into the `parameters` of paths are valid, but openapi-ts represents
 *       them according to their type; path, query, header, etc… so in these cases we
 *       must check the parameter definition to determine the how to index into
 *       the openapi-typescript type.
 *   * Union variant properties (oneOf/anyOf)
 *       When accessing properties that may only exist on some variants of a union type,
 *       we use Extract<> to narrow the type before each property access.
 **/
export function oapiRef(
  path: string,
  resolved?: ParsedParameter,
  options: OapiRefOptions = {},
): ts.TypeNode {
  const { pointer } = parseRef(path);

  if (pointer.length === 0) {
    throw new TypegenError({ message: `Error parsing $ref: ${path}. Is this a valid $ref?` });
  }

  const extractSet = new Set(options.extractProperties ?? []);

  // Initial segments are handled in a fixed , then remaining segments are treated
  // according to heuristics based on the initial segments
  const initialSegment = pointer[0];
  const leadingSegments = pointer.slice(1, 3);
  const restSegments = pointer.slice(3);

  const leadingType = addIndexedAccess(
    ts.factory.createTypeReferenceNode(
      ts.factory.createIdentifier(
        options.deep ? `FlattenedDeepRequired<${String(initialSegment)}>` : String(initialSegment),
      ),
    ),
    ...leadingSegments,
  );

  return restSegments.reduce<ts.TypeNode>((acc, segment, index, original) => {
    // Skip `properties` items when in the middle of the pointer. Object schemas are flattened,
    // so a pointer into `properties` has to index the generated type without that segment.
    if (segment === "properties") {
      return acc;
    }

    if (resolved && index === original.length - 1) {
      return addIndexedAccess(acc, String(resolved.in), String(resolved.name));
    }

    // If this segment is in the extractProperties list,
    // wrap the current type with Extract<T, { segment: unknown }> before accessing.
    // This narrows union types to variants that have this property.
    if (extractSet.has(segment)) {
      const narrowedType = wrapWithExtract(acc, segment);
      return addIndexedAccess(narrowedType, segment);
    }

    return addIndexedAccess(acc, segment);
  }, leadingType);
}

/** {@link oapiRef} as an Effect: a `$ref` that is not a JSON Pointer fails with `TypegenError`. */
export function refType(
  path: string,
  resolved?: ParsedParameter,
  options?: OapiRefOptions,
): Effect.Effect<ts.TypeNode, TypegenError> {
  return Effect.try({
    try: () => oapiRef(path, resolved, options),
    catch: (cause) =>
      cause instanceof TypegenError ? cause : new TypegenError({ message: String(cause) }),
  });
}

export interface AstToStringOptions {
  fileName?: string;
  sourceText?: string;
  formatOptions?: ts.PrinterOptions;
}

/** Convert TypeScript AST to string */
export function astToString(
  ast: ts.Node | ts.Node[] | ts.TypeElement | ts.TypeElement[],
  options?: AstToStringOptions,
): string {
  const sourceFile = ts.createSourceFile(
    options?.fileName ?? "openapi-ts.ts",
    options?.sourceText ?? "",
    ts.ScriptTarget.ESNext,
    false,
    ts.ScriptKind.TS,
  );

  // @ts-expect-error it’s OK to overwrite statements once
  sourceFile.statements = ts.factory.createNodeArray(Array.isArray(ast) ? ast : [ast]);

  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
    ...options?.formatOptions,
  });

  return printer.printFile(sourceFile);
}

/** Convert an arbitrary string to TS (assuming it’s valid) */
export function stringToAST(source: string): unknown[] {
  return ts.createSourceFile(
    /* fileName        */ "stringInput",
    /* sourceText      */ source,
    /* languageVersion */ ts.ScriptTarget.ESNext,
    /* setParentNodes  */ undefined,
    /* scriptKind      */ undefined,
  ).statements as any;
}

/**
 * Deduplicate simple primitive types from an array of nodes
 * Note: won’t deduplicate complex types like objects
 */
export function tsDedupe(types: ts.TypeNode[]): ts.TypeNode[] {
  const encounteredTypes = new Set<number>();
  const filteredTypes: ts.TypeNode[] = [];

  for (const t of types) {
    // only mark for deduplication if this is not a const ("text" means it is a const)
    const dedupeTarget = ((t as LiteralTypeNode).literal ?? t) as object;

    if (!hasDefinedField(dedupeTarget, "text")) {
      const { kind } = dedupeTarget as { kind: number };

      if (encounteredTypes.has(kind)) {
        continue;
      }

      if (tsIsPrimitive(t)) {
        encounteredTypes.add(kind);
      }
    }

    filteredTypes.push(t);
  }

  return filteredTypes;
}

export const enumCache = new Map<string, ts.EnumDeclaration>();

/** Create a TS enum (with sanitized name and members) */
export function tsEnum(
  name: string,
  members: (string | number)[],
  metadata?: { name?: string; description?: string | null }[],
  options?: { export?: boolean; shouldCache?: boolean },
) {
  let enumName = sanitizeMemberName(name);
  enumName = `${enumName.charAt(0).toUpperCase()}${enumName.substring(1)}`;
  let key = "";

  if (options?.shouldCache) {
    key = `${members
      .slice(0)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((v, i) => {
        return `${metadata?.[i]?.name ?? String(v)}:${metadata?.[i]?.description || ""}`;
      })
      .join(",")}`;

    if (enumCache.has(key)) {
      return enumCache.get(key) as ts.EnumDeclaration;
    }
  }

  const enumDeclaration = ts.factory.createEnumDeclaration(
    /* modifiers */ options ? tsModifiers({ export: options.export ?? false }) : undefined,
    /* name      */ enumName,
    /* members   */ members.map((value, i) => tsEnumMember(value, metadata?.[i])),
  );

  if (options?.shouldCache) enumCache.set(key, enumDeclaration);
  return enumDeclaration;
}

/** Create an exported TS array literal expression  */
export function tsArrayLiteralExpression(
  name: string,
  elementType: ts.TypeNode,
  values: (string | number)[],
  options?: { export?: boolean; readonly?: boolean; injectFooter?: ts.Node[] },
) {
  let variableName = sanitizeMemberName(name);
  variableName = `${variableName.charAt(0).toLowerCase()}${variableName.substring(1)}`;

  if (
    options?.injectFooter &&
    !options.injectFooter.some(
      (node) =>
        ts.isTypeAliasDeclaration(node) && node?.name?.escapedText === "FlattenedDeepRequired",
    )
  ) {
    const helper = stringToAST(
      `type FlattenedDeepRequired<T> = {
  [K in keyof T]-?: FlattenedDeepRequired<T[K] extends unknown[] | undefined | null ? Extract<T[K], unknown[]>[number] : T[K]>;
};`,
    )[0] as any;

    options.injectFooter.push(helper);
  }

  const arrayType = options?.readonly
    ? tsReadonlyArray(elementType, options.injectFooter)
    : ts.factory.createArrayTypeNode(elementType);

  return ts.factory.createVariableStatement(
    options ? tsModifiers({ export: options.export ?? false }) : undefined,
    ts.factory.createVariableDeclarationList(
      [
        ts.factory.createVariableDeclaration(
          variableName,
          undefined,
          arrayType,
          ts.factory.createArrayLiteralExpression(
            values.map((value) => {
              if (typeof value === "number") {
                if (value < 0) {
                  return ts.factory.createPrefixUnaryExpression(
                    ts.SyntaxKind.MinusToken,
                    ts.factory.createNumericLiteral(Math.abs(value)),
                  );
                } else {
                  return ts.factory.createNumericLiteral(value);
                }
              } else {
                return ts.factory.createStringLiteral(value);
              }
            }),
          ),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}

function sanitizeMemberName(name: string) {
  let sanitizedName = name.replace(JS_ENUM_INVALID_CHARS_RE, (c) => {
    const last = c.charAt(c.length - 1);
    return JS_PROPERTY_INDEX_INVALID_CHARS_RE.test(last) ? "" : last.toUpperCase();
  });

  if (Number(name[0]) >= 0) {
    sanitizedName = `Value${name}`;
  }

  return sanitizedName;
}

/** Sanitize TS enum member expression */
export function tsEnumMember(
  value: string | number,
  metadata: { name?: string; description?: string | null } = {},
) {
  let name = metadata.name ?? String(value);

  if (!JS_PROPERTY_INDEX_RE.test(name)) {
    if (Number(name[0]) >= 0) {
      name = `Value${name}`.replace(".", "_"); // don't forged decimals;
    } else if (name[0] === "-") {
      name = `ValueMinus${name.slice(1)}`;
    }

    const invalidCharMatch = name.match(JS_PROPERTY_INDEX_INVALID_CHARS_RE);

    if (invalidCharMatch) {
      if (invalidCharMatch[0] === name) {
        name = `"${name}"`;
      } else {
        name = name.replace(JS_PROPERTY_INDEX_INVALID_CHARS_RE, (s) => {
          return SPECIAL_CHARACTER_MAP[s] ?? "_";
        });
      }
    }
  }

  let member: ts.EnumMember;

  if (typeof value === "number") {
    const literal =
      value < 0
        ? ts.factory.createPrefixUnaryExpression(
            ts.SyntaxKind.MinusToken,
            ts.factory.createNumericLiteral(Math.abs(value)),
          )
        : ts.factory.createNumericLiteral(value);

    member = ts.factory.createEnumMember(name, literal);
  } else {
    member = ts.factory.createEnumMember(name, ts.factory.createStringLiteral(value));
  }

  const trimmedDescription = metadata.description?.trim();

  if (
    trimmedDescription === undefined ||
    trimmedDescription === null ||
    trimmedDescription === ""
  ) {
    return member;
  }

  return ts.addSyntheticLeadingComment(
    member,
    ts.SyntaxKind.SingleLineCommentTrivia,
    ` ${trimmedDescription}`,
    true,
  );
}

/** Create an intersection type */
export function tsIntersection(types: ts.TypeNode[]): ts.TypeNode {
  if (types.length === 0) {
    return NEVER;
  }

  if (types.length === 1 && types[0]) {
    return types[0];
  }

  return ts.factory.createIntersectionTypeNode(tsDedupe(types));
}

/** Is this a primitive type (string, number, boolean, null, undefined)? */
/** True when a node actually stores `key`, not merely inherits a getter for it. */
function hasDefinedField(node: object, key: string): boolean {
  const record = node as { _data?: Record<string, unknown> } & Record<string, unknown>;

  if (record._data && Object.hasOwn(record._data, key) && record._data[key] !== undefined) {
    return true;
  }

  return Object.hasOwn(record, key) && record[key] !== undefined;
}

export function tsIsPrimitive(type: ts.TypeNode): boolean {
  if (!type) {
    return true;
  }

  return (
    ts.SyntaxKind[type.kind] === "BooleanKeyword" ||
    ts.SyntaxKind[type.kind] === "NeverKeyword" ||
    ts.SyntaxKind[type.kind] === "NullKeyword" ||
    ts.SyntaxKind[type.kind] === "NumberKeyword" ||
    ts.SyntaxKind[type.kind] === "StringKeyword" ||
    ts.SyntaxKind[type.kind] === "UndefinedKeyword" ||
    (hasDefinedField(type, "literal") &&
      tsIsPrimitive((type as LiteralTypeNode).literal as TypeLiteralNode))
  );
}

/** Create a literal type */
export function tsLiteral(value: unknown): ts.TypeNode {
  if (typeof value === "string") {
    // workaround for UTF-8: https://github.com/microsoft/TypeScript/issues/36174
    return ts.factory.createIdentifier(JSON.stringify(value)) as unknown as ts.TypeNode;
  }

  if (typeof value === "number") {
    const literal =
      value < 0
        ? ts.factory.createPrefixUnaryExpression(
            ts.SyntaxKind.MinusToken,
            ts.factory.createNumericLiteral(Math.abs(value)),
          )
        : ts.factory.createNumericLiteral(value);

    return ts.factory.createLiteralTypeNode(literal);
  }

  if (typeof value === "boolean") {
    return value === true ? TRUE : FALSE;
  }

  if (value === null) {
    return NULL;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return ts.factory.createArrayTypeNode(NEVER);
    }

    return ts.factory.createTupleTypeNode(value.map((v: unknown) => tsLiteral(v)));
  }

  if (typeof value === "object") {
    const keys: ts.TypeElement[] = [];

    for (const [k, v] of Object.entries(value)) {
      keys.push(
        ts.factory.createPropertySignature(
          /* modifiers     */ undefined,
          /* name          */ tsPropertyIndex(k),
          /* questionToken */ undefined,
          /* type          */ tsLiteral(v),
        ),
      );
    }

    return keys.length ? ts.factory.createTypeLiteralNode(keys) : tsRecord(STRING, NEVER);
  }

  return UNKNOWN;
}

/** Modifiers (readonly) */
export function tsModifiers(modifiers: { readonly?: boolean; export?: boolean }): ts.Modifier[] {
  const typeMods: ts.Modifier[] = [];

  if (modifiers.export) {
    typeMods.push(ts.factory.createModifier(ts.SyntaxKind.ExportKeyword));
  }

  if (modifiers.readonly) {
    typeMods.push(ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword));
  }

  return typeMods;
}

/** Create a T | null union */
export function tsNullable(types: ts.TypeNode[]): ts.TypeNode {
  return ts.factory.createUnionTypeNode([...types, NULL]);
}

/** Create a TS Omit<X, Y> type */
export function tsOmit(type: ts.TypeNode, keys: string[]): ts.TypeNode {
  return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Omit"), [
    type,
    ts.factory.createUnionTypeNode(keys.map((k) => tsLiteral(k))),
  ]);
}

/** Create a TS Record<X, Y> type */
export function tsRecord(key: ts.TypeNode, value: ts.TypeNode) {
  return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Record"), [key, value]);
}

/** Create a valid property index */
export function tsPropertyIndex(index: string | number) {
  if (
    (typeof index === "number" && !(index < 0)) ||
    (typeof index === "string" && String(Number(index)) === index && index[0] !== "-")
  ) {
    return ts.factory.createNumericLiteral(index);
  }

  return typeof index === "string" && JS_PROPERTY_INDEX_RE.test(index)
    ? ts.factory.createIdentifier(index)
    : ts.factory.createStringLiteral(String(index));
}

/** Create a union type */
export function tsUnion(types: ts.TypeNode[]): ts.TypeNode {
  if (types.length === 0) {
    return NEVER;
  }

  if (types.length === 1 && types[0]) {
    return types[0];
  }

  return ts.factory.createUnionTypeNode(tsDedupe(types));
}

/** Create a WithRequired<X, Y> type */
export function tsWithRequired(
  type: ts.TypeNode,
  keys: string[],
  injectFooter: ts.Node[], // needed to inject type helper if used
): ts.TypeNode {
  if (keys.length === 0) {
    return type;
  }

  // inject helper, if needed
  if (
    !injectFooter.some(
      (node) => ts.isTypeAliasDeclaration(node) && node?.name?.escapedText === "WithRequired",
    )
  ) {
    const helper = stringToAST(
      `type WithRequired<T, K extends keyof T> = T & {
  [P in K]-?: T[P];
};`,
    )[0] as any;

    injectFooter.push(helper);
  }

  return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("WithRequired"), [
    type,
    tsUnion(keys.map((k) => tsLiteral(k))),
  ]);
}

/**
 * Enhanced ReadonlyArray.
 * eg: type Foo = ReadonlyArray<T>; type Bar = ReadonlyArray<T[]>
 * Foo and Bar are both of type `readonly T[]`
 */
export function tsReadonlyArray(type: ts.TypeNode, injectFooter?: ts.Node[]): ts.TypeNode {
  if (
    injectFooter &&
    !injectFooter.some(
      (node) => ts.isTypeAliasDeclaration(node) && node?.name?.escapedText === "ReadonlyArray",
    )
  ) {
    const helper = stringToAST(
      `type ReadonlyArray<T> = [
  Exclude<T, undefined>
] extends [
  unknown[]
] ? Readonly<Exclude<T, undefined>> : Readonly<Exclude<T, undefined>[]>;`,
    )[0] as any;

    injectFooter.push(helper);
  }

  return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("ReadonlyArray"), [type]);
}

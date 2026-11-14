/**
 * TypeScript 7 does not ship the classic compiler API. This module exposes the
 * slice of that API the generator and CLIs use, built on `typescript/unstable`.
 */
import {
  NodeFlags as ImportedNodeFlags,
  ScriptKind as ImportedScriptKind,
  ScriptTarget as ImportedScriptTarget,
  SyntaxKind as ImportedSyntaxKind,
  TokenFlags,
  type Identifier,
  type Node,
} from "typescript/unstable/ast";
import * as tsFactory from "typescript/unstable/ast/factory";
import {
  isArrayTypeNode as importedIsArrayTypeNode,
  isIdentifier as importedIsIdentifier,
  isIndexedAccessTypeNode as importedIsIndexedAccessTypeNode,
  isInterfaceDeclaration as importedIsInterfaceDeclaration,
  isLiteralTypeNode as importedIsLiteralTypeNode,
  isPropertySignatureDeclaration,
  isStringLiteral as importedIsStringLiteral,
  isTupleTypeNode as importedIsTupleTypeNode,
  isTypeAliasDeclaration as importedIsTypeAliasDeclaration,
  isTypeLiteralNode as importedIsTypeLiteralNode,
  isTypeNode as importedIsTypeNode,
  isTypeReferenceNode as importedIsTypeReferenceNode,
} from "typescript/unstable/ast/is";
import {
  visitEachChild as visitEachChildNode,
  visitNode as visitNodeChild,
} from "typescript/unstable/ast/visitor";
import { Array as Arr, Formatter, Option, pipe, String as Str } from "effect";

const SyntaxKind = ImportedSyntaxKind;
type SyntaxKind = (typeof ImportedSyntaxKind)[keyof typeof ImportedSyntaxKind];

export type {
  EnumDeclaration,
  EnumMember,
  InterfaceDeclaration,
  LiteralTypeNode,
  PropertySignatureDeclaration as PropertySignature,
  QuestionToken,
  TypeAliasDeclaration,
  TypeElement,
  TypeLiteralNode,
  TypeNode,
} from "typescript/unstable/ast";

const rawText = new WeakMap<Node, string>();
const typeParameterText = new WeakMap<Node, string>();

const leadingComments = new WeakMap<
  Node,
  { kind: SyntaxKind; text: string; hasTrailingNewLine: boolean }[]
>();

const KEYWORDS: Partial<Record<SyntaxKind, string>> = {
  [SyntaxKind.AnyKeyword]: "any",
  [SyntaxKind.BigIntKeyword]: "bigint",
  [SyntaxKind.BooleanKeyword]: "boolean",
  [SyntaxKind.ExportKeyword]: "export",
  [SyntaxKind.FalseKeyword]: "false",
  [SyntaxKind.NeverKeyword]: "never",
  [SyntaxKind.NullKeyword]: "null",
  [SyntaxKind.NumberKeyword]: "number",
  [SyntaxKind.ObjectKeyword]: "object",
  [SyntaxKind.ReadonlyKeyword]: "readonly",
  [SyntaxKind.StringKeyword]: "string",
  [SyntaxKind.SymbolKeyword]: "symbol",
  [SyntaxKind.TrueKeyword]: "true",
  [SyntaxKind.UndefinedKeyword]: "undefined",
  [SyntaxKind.UnknownKeyword]: "unknown",
  [SyntaxKind.VoidKeyword]: "void",
};

export const NewLineKind = {
  CarriageReturnLineFeed: 0,
  LineFeed: 1,
} as const;

export interface PrinterOptions {
  newLine?: number;
  removeComments?: boolean;
}

export type Visitor = (node: Node) => Node | undefined;

function createIdentifier(text: string) {
  const node = tsFactory.createIdentifier(text) as Identifier & { escapedText?: string };
  node.escapedText = text;
  return node;
}

function asName(name: string | number | Node): any {
  if (typeof name === "string") {
    return createIdentifier(name);
  }

  if (typeof name === "number") {
    return tsFactory.createNumericLiteral(String(name), TokenFlags.None);
  }

  return name;
}

function aliasQuestionToken<T extends object>(node: T): T {
  Object.defineProperty(node, "questionToken", {
    configurable: true,
    enumerable: true,
    get(this: { postfixToken?: Node }) {
      return this.postfixToken;
    },
  });

  return node;
}

function createPropertySignature(
  modifiers: unknown,
  name: unknown,
  questionToken: unknown,
  type: unknown,
) {
  return aliasQuestionToken(
    tsFactory.createPropertySignatureDeclaration(
      modifiers as never,
      asName(name as string | number | Node),
      questionToken as never,
      type as never,
      undefined as never,
    ),
  );
}

function keywordFromText(text: string): Node {
  if (text === "string") {
    return tsFactory.createKeywordTypeNode(SyntaxKind.StringKeyword);
  }

  if (text === "number") {
    return tsFactory.createKeywordTypeNode(SyntaxKind.NumberKeyword);
  }

  if (text === "boolean") {
    return tsFactory.createKeywordTypeNode(SyntaxKind.BooleanKeyword);
  }

  return tsFactory.createTypeReferenceNode(createIdentifier(Str.trim(text)));
}

function parseTemplateType(source: string): Node {
  const body = Str.slice(1, -1)(source);
  const pieces = Str.split(body, /\$\{([^}]+)\}/);

  if (pieces.length === 1) {
    return tsFactory.createNoSubstitutionTemplateLiteral(body, TokenFlags.None);
  }

  const head = pieces[0] ?? "";
  const spans = [];

  for (let index = 1; index < pieces.length; index += 2) {
    const literalText = pieces[index + 1] ?? "";
    const isLast = index + 2 >= pieces.length;

    const literal = isLast
      ? tsFactory.createTemplateTail(literalText, literalText, TokenFlags.None)
      : tsFactory.createTemplateMiddle(literalText, literalText, TokenFlags.None);

    spans.push(
      tsFactory.createTemplateLiteralTypeSpan(
        keywordFromText(pieces[index] ?? "string") as never,
        literal,
      ),
    );
  }

  return tsFactory.createTemplateLiteralTypeNode(
    tsFactory.createTemplateHead(head, head, TokenFlags.None),
    spans,
  );
}

function splitStatements(source: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      current += character;

      if (character === "\\") {
        current += source[index + 1] ?? "";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "`" || character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "{" || character === "(" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === ")" || character === "]") {
      depth -= 1;
    }

    if (character === ";" && depth === 0) {
      const statement = Str.trim(current);

      if (statement) {
        parts.push(Str.endsWith(";")(statement) ? statement : `${statement};`);
      }

      current = "";
      continue;
    }

    current += character;
  }

  const tail = Str.trim(current);

  if (tail) {
    parts.push(tail);
  }

  return parts;
}

function typeAliasFromStatement(statement: string): Node | undefined {
  const found = Str.match(/^(export\s+)?type\s+([A-Za-z0-9_$]+)([\s\S]*?)\s*=\s*([\s\S]+)$/)(
    statement,
  );

  if (Option.isNone(found)) {
    return undefined;
  }

  const match = found.value;
  const exported = Boolean(match[1]);
  const name = match[2] ?? "";
  const parameters = Str.trim(match[3] ?? "");
  const typeText = pipe(match[4] ?? "", Str.trim, Str.replace(/;$/, ""));
  const typeNode = tsFactory.createKeywordTypeNode(SyntaxKind.AnyKeyword);
  rawText.set(typeNode, typeText);

  const alias = tsFactory.createTypeAliasDeclaration(
    exported ? [tsFactory.createToken(SyntaxKind.ExportKeyword)] : undefined,
    createIdentifier(name),
    undefined,
    typeNode,
  );

  if (parameters) {
    typeParameterText.set(alias, parameters);
  }

  return alias;
}

function statementsFromSource(source: string): Node[] {
  const trimmed = Str.trim(source);

  if (!trimmed) {
    return [];
  }

  if (Str.startsWith("`")(trimmed) && Str.endsWith("`")(trimmed)) {
    return [
      {
        kind: SyntaxKind.ExpressionStatement,
        expression: parseTemplateType(trimmed),
      } as unknown as Node,
    ];
  }

  return Arr.map(splitStatements(trimmed), (statement) => {
    const alias = typeAliasFromStatement(statement);

    if (alias) {
      return alias;
    }

    const node = tsFactory.createNotEmittedStatement();
    rawText.set(node, Str.endsWith(";")(statement) ? statement : `${statement};`);
    return node;
  });
}

function parseSourceFile(
  fileName: string,
  sourceText = "",
  _languageVersion?: unknown,
  _setParentNodes?: unknown,
  _scriptKind?: unknown,
) {
  return {
    kind: SyntaxKind.SourceFile,
    fileName,
    text: sourceText,
    statements: statementsFromSource(sourceText),
  };
}

function addLeadingComment(
  node: Node,
  kind: SyntaxKind,
  text: string,
  hasTrailingNewLine: boolean,
) {
  const comments = leadingComments.get(node) ?? [];
  comments.push({ kind, text, hasTrailingNewLine });
  leadingComments.set(node, comments);
  return node;
}

function formatComments(node: Node, indent: number, removeComments: boolean): string {
  if (removeComments) {
    return "";
  }

  const comments = leadingComments.get(node);

  if (!comments?.length) {
    return "";
  }

  const pad = Str.repeat(indent)(" ");

  return pipe(
    comments,
    Arr.map((comment) => {
      if (comment.kind === SyntaxKind.SingleLineCommentTrivia) {
        return `${pad}//${comment.text}`;
      }

      return pipe(
        `${pad}/*${Str.replaceAll("\n", `\n${pad}`)(comment.text)}*/`,
        Str.split("\n"),
        Arr.map((line) => Str.trimEnd(line)),
        Arr.join("\n"),
      );
    }),
    Arr.join("\n"),
  );
}

function printModifiers(modifiers: readonly { kind: SyntaxKind }[] | undefined): string {
  if (!modifiers?.length) {
    return "";
  }

  return `${pipe(
    modifiers,
    Arr.map((modifier) => KEYWORDS[modifier.kind]),
    Arr.filter((keyword): keyword is string => Boolean(keyword)),
    Arr.join(" "),
  )} `;
}

function printName(name: Node | undefined): string {
  if (!name) {
    return "";
  }

  if (name.kind === SyntaxKind.Identifier || name.kind === SyntaxKind.NumericLiteral) {
    return (name as Identifier).text;
  }

  if (name.kind === SyntaxKind.StringLiteral) {
    return Formatter.formatJson((name as Identifier).text);
  }

  if (name.kind === SyntaxKind.ComputedPropertyName) {
    return `[${render((name as unknown as { expression: Node }).expression, 0)}]`;
  }

  return render(name, 0);
}

function render(
  node: Node | undefined,
  indent: number,
  removeComments = false,
  broken = true,
): string {
  if (!node) {
    return "";
  }

  const raw = rawText.get(node);

  if (raw !== undefined) {
    return raw;
  }

  const comments = formatComments(node, indent, removeComments);
  const body = printBody(node, indent, removeComments, broken);
  return comments ? `${comments}\n${body}` : body;
}

function printBody(node: Node, indent: number, removeComments: boolean, broken = true): string {
  const keyword = KEYWORDS[node.kind];

  if (
    keyword &&
    node.kind !== SyntaxKind.ExportKeyword &&
    node.kind !== SyntaxKind.ReadonlyKeyword
  ) {
    return keyword;
  }

  const pad = Str.repeat(indent)(" ");
  const next = indent + 2;
  const record = node as unknown as Record<string, any>;

  switch (node.kind) {
    case SyntaxKind.InterfaceDeclaration:
      return `${pad}${printModifiers(record.modifiers)}interface ${printName(record.name)} {${printMembers(record.members, next, removeComments)}\n${pad}}`;
    case SyntaxKind.TypeAliasDeclaration:
      return `${pad}${printModifiers(record.modifiers)}type ${printName(record.name)}${typeParameterText.get(node) ?? ""} = ${render(record.type, indent, removeComments)};`;
    case SyntaxKind.EnumDeclaration: {
      const members = [...(record.members ?? [])] as Node[];
      const modifiers = printModifiers(record.modifiers);
      const name = printName(record.name);

      if (members.length === 0) {
        return `${pad}${modifiers}enum ${name} {\n${pad}}`;
      }

      const body = Arr.join(
        Arr.map(members, (member) => render(member, next, removeComments)),
        ",\n",
      );

      return `${pad}${modifiers}enum ${name} {\n${body}\n${pad}}`;
    }

    case SyntaxKind.EnumMember:
      return `${pad}${printName(record.name)}${record.initializer ? ` = ${render(record.initializer, 0, removeComments)}` : ""}`;
    case SyntaxKind.VariableStatement: {
      const list = record.declarationList;
      const keywordName = list?.flags & ImportedNodeFlags.Const ? "const" : "let";
      const declaration = list?.declarations?.[0];
      return `${pad}${printModifiers(record.modifiers)}${keywordName} ${printName(declaration?.name)}${declaration?.type ? `: ${render(declaration.type, 0, removeComments)}` : ""}${declaration?.initializer ? ` = ${render(declaration.initializer, indent, removeComments)}` : ""};`;
    }

    case SyntaxKind.PropertySignature: {
      const optional = record.postfixToken || record.questionToken ? "?" : "";
      const printed = render(record.type, indent, removeComments);
      const separator = Str.startsWith("\n")(printed) ? "" : " ";
      return `${pad}${printModifiers(record.modifiers)}${printName(record.name)}${optional}:${separator}${printed};`;
    }

    case SyntaxKind.TypeLiteral:
      if (!record.members?.length) {
        return "{}";
      }

      return `{${printMembers(record.members, next, removeComments)}\n${pad}}`;
    case SyntaxKind.UnionType: {
      const types = [...(record.types ?? [])] as Node[];
      const parts = Arr.map(types, (type) => printUnionOperand(type, indent + 4, removeComments));
      const laterBreaks = Arr.some(Arr.drop(parts, 1), Str.includes("\n"));

      if (broken && parts[0] && !Str.includes("\n")(parts[0]) && laterBreaks) {
        const bar = Str.repeat(indent + 2)(" ");

        return `\n${Arr.join(
          Arr.map(parts, (part) => `${bar}| ${part}`),
          "\n",
        )}`;
      }

      return Arr.join(
        Arr.map(types, (type) => printUnionOperand(type, indent, removeComments)),
        " | ",
      );
    }

    case SyntaxKind.IntersectionType:
      return Arr.join(
        Arr.map<readonly Node[], string>(record.types, (type) =>
          printUnionOperand(type, indent, removeComments),
        ),
        " & ",
      );
    case SyntaxKind.TypeReference: {
      const argumentsText = record.typeArguments?.length
        ? `<${Arr.join(
            Arr.map<readonly Node[], string>(record.typeArguments, (type) =>
              render(type, indent, removeComments),
            ),
            ", ",
          )}>`
        : "";

      return `${printName(record.typeName)}${argumentsText}`;
    }

    case SyntaxKind.ArrayType: {
      const element = record.elementType as Node;
      const printed = render(element, indent, removeComments);

      const parenthesize =
        element.kind === SyntaxKind.UnionType || element.kind === SyntaxKind.IntersectionType;

      return `${parenthesize ? `(${printed})` : printed}[]`;
    }

    case SyntaxKind.TupleType: {
      const elements = [...(record.elements ?? [])] as Node[];

      if (elements.length === 0) {
        return `[\n${pad}]`;
      }

      const printed = Arr.map(elements, (element) => render(element, 0, removeComments));

      const body = Arr.join(
        Arr.map(printed, (element) => indentPrinted(element, next)),
        ",\n",
      );

      return `[\n${body}\n${pad}]`;
    }

    case SyntaxKind.IndexedAccessType:
      return `${render(record.objectType, indent, removeComments)}[${render(record.indexType, 0, removeComments)}]`;
    case SyntaxKind.IndexSignature: {
      const parameter = record.parameters?.[0];
      return `${pad}${printModifiers(record.modifiers)}[${printName(parameter?.name)}: ${render(parameter?.type, 0, removeComments)}]: ${render(record.type, indent, removeComments)};`;
    }

    case SyntaxKind.TypeOperator:
      return `${KEYWORDS[record.operator as SyntaxKind] ?? "keyof"} ${render(record.type, indent, removeComments)}`;
    case SyntaxKind.RestType:
      return `...${render(record.type, indent, removeComments)}`;
    case SyntaxKind.LiteralType:
      return render(record.literal, indent, removeComments);
    case SyntaxKind.StringLiteral:
      return Formatter.formatJson(record.text);
    case SyntaxKind.NumericLiteral:
    case SyntaxKind.Identifier:
      return record.text;
    case SyntaxKind.PrefixUnaryExpression:
      return `${KEYWORDS[record.operator as SyntaxKind] ?? "-"}${render(record.operand, 0, removeComments)}`;
    case SyntaxKind.ArrayLiteralExpression: {
      const elements = [...(record.elements ?? [])] as Node[];

      if (elements.length === 0) {
        return "[]";
      }

      const printed = Arr.map(elements, (element) => render(element, 0, removeComments));

      if (Arr.every(printed, (element) => !Str.includes("\n")(element))) {
        return `[${Arr.join(printed, ", ")}]`;
      }

      const body = Arr.join(
        Arr.map(printed, (element) => indentPrinted(element, next)),
        ",\n",
      );

      return `[\n${body}\n${pad}]`;
    }

    case SyntaxKind.ParenthesizedType:
      return `(${render(record.type, indent, removeComments)})`;
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return `\`${record.text ?? ""}\``;
    case SyntaxKind.TemplateLiteralType: {
      const spans = [...(record.templateSpans ?? [])] as {
        type: Node;
        literal: { text?: string };
      }[];

      const body = pipe(
        spans,
        Arr.map((span) => `\${${render(span.type, 0, removeComments)}}${span.literal?.text ?? ""}`),
        Arr.join(""),
      );

      return `\`${record.head?.text ?? ""}${body}\``;
    }

    default:
      throw new Error(`Unable to print SyntaxKind ${node.kind}`);
  }
}

function printUnionOperand(type: Node, indent: number, removeComments: boolean): string {
  const parenthesize =
    type.kind === SyntaxKind.UnionType ||
    (type.kind === SyntaxKind.IntersectionType && containsTypeLiteral(type));

  if (parenthesize) return `(${render(type, indent, removeComments, false)})`;
  return render(type, indent, removeComments, false);
}

function containsTypeLiteral(type: Node): boolean {
  if (type.kind === SyntaxKind.TypeLiteral) return true;
  const record = type as unknown as { types?: Node[] };
  if (type.kind !== SyntaxKind.UnionType && type.kind !== SyntaxKind.IntersectionType) return false;
  return Arr.some(record.types ?? [], (child) => containsTypeLiteral(child));
}

function indentPrinted(printed: string, indent: number): string {
  const pad = Str.repeat(indent)(" ");

  if (Str.startsWith(pad)(printed) || Str.includes("\n")(printed)) {
    return printed;
  }

  return `${pad}${printed}`;
}

function printMembers(
  members: readonly Node[] | undefined,
  indent: number,
  removeComments: boolean,
): string {
  if (!members?.length) {
    return "";
  }

  return `\n${Arr.join(
    Arr.map([...members], (member) => render(member, indent, removeComments)),
    "\n",
  )}`;
}

function makePrinter(options: PrinterOptions = {}) {
  const removeComments = options.removeComments ?? false;

  return {
    printFile(sourceFile: { statements?: readonly Node[] }) {
      const text = Arr.join(
        Arr.map(sourceFile.statements ?? [], (statement) => render(statement, 0, removeComments)),
        "\n",
      );

      return Str.endsWith("\n")(text) ? text : `${text}\n`;
    },
    printNode(node: Node) {
      return render(node, 0, removeComments);
    },
  };
}

function transformNodes(
  nodes: Node | readonly Node[],
  transformers: ((context: object) => (node: Node) => Node | undefined)[],
) {
  const list = Arr.isArray<typeof nodes>(nodes) ? [...nodes] : [nodes as Node];
  let current = list;

  for (const transformer of transformers) {
    const visit = transformer({});
    current = Arr.map(current, (node) => visit(node) ?? node);
  }

  return {
    transformed: Arr.isArray(nodes) ? current : current[0],
    dispose() {},
  };
}

// Bundled declarations inline TypeScript's AST types under their own names. Aliases with distinct
// names keep the namespace members below from referring to themselves.
type AstEnumDeclaration = import("typescript/unstable/ast").EnumDeclaration;
type AstEnumMember = import("typescript/unstable/ast").EnumMember;
type AstInterfaceDeclaration = import("typescript/unstable/ast").InterfaceDeclaration;
type AstLiteralTypeNode = import("typescript/unstable/ast").LiteralTypeNode;
type AstNode = import("typescript/unstable/ast").Node;

type AstPropertySignatureDeclaration =
  import("typescript/unstable/ast").PropertySignatureDeclaration;

type AstQuestionToken = import("typescript/unstable/ast").QuestionToken;
type AstTypeAliasDeclaration = import("typescript/unstable/ast").TypeAliasDeclaration;
type AstTypeElement = import("typescript/unstable/ast").TypeElement;
type AstTypeLiteralNode = import("typescript/unstable/ast").TypeLiteralNode;
type AstTypeNode = import("typescript/unstable/ast").TypeNode;
type AstModifierLike = import("typescript/unstable/ast").ModifierLike;
const astNodeFlags = ImportedNodeFlags;
const astScriptKind = ImportedScriptKind;
const astScriptTarget = ImportedScriptTarget;
const astSyntaxKind = ImportedSyntaxKind;
const astVisitEachChild = visitEachChildNode;
const astVisitNode = visitNodeChild;
const astIsArrayTypeNode = importedIsArrayTypeNode;
const astIsIdentifier = importedIsIdentifier;
const astIsIndexedAccessTypeNode = importedIsIndexedAccessTypeNode;
const astIsInterfaceDeclaration = importedIsInterfaceDeclaration;
const astIsLiteralTypeNode = importedIsLiteralTypeNode;
const astIsStringLiteral = importedIsStringLiteral;
const astIsTupleTypeNode = importedIsTupleTypeNode;
const astIsTypeAliasDeclaration = importedIsTypeAliasDeclaration;
const astIsTypeLiteralNode = importedIsTypeLiteralNode;
const astIsTypeNode = importedIsTypeNode;
const astIsTypeReferenceNode = importedIsTypeReferenceNode;
const astIsPropertySignature = isPropertySignatureDeclaration;

namespace ts {
  export type EnumDeclaration = AstEnumDeclaration;
  export type EnumMember = AstEnumMember;
  export type InterfaceDeclaration = AstInterfaceDeclaration;
  export type LiteralTypeNode = AstLiteralTypeNode;
  export type Node = AstNode;
  export type PropertySignature = AstPropertySignatureDeclaration;
  export type QuestionToken = AstQuestionToken;
  export type TypeAliasDeclaration = AstTypeAliasDeclaration;
  export type TypeElement = AstTypeElement;
  export type TypeLiteralNode = AstTypeLiteralNode;
  export type TypeNode = AstTypeNode;
  export type Modifier = AstModifierLike;
  export type Visitor = (node: Node) => Node | undefined;
  export interface PrinterOptions {
    newLine?: number;
    removeComments?: boolean;
  }
  export const NodeFlags: typeof astNodeFlags = astNodeFlags;
  export const ScriptKind: typeof astScriptKind = astScriptKind;
  export const ScriptTarget: typeof astScriptTarget = astScriptTarget;
  export const SyntaxKind: typeof astSyntaxKind = astSyntaxKind;
  export const NewLineKind = {
    CarriageReturnLineFeed: 0,
    LineFeed: 1,
  } as const;
  export const factory = {
    createArrayLiteralExpression: tsFactory.createArrayLiteralExpression,
    createArrayTypeNode: tsFactory.createArrayTypeNode,
    createEnumDeclaration(modifiers: unknown, name: unknown, members: unknown) {
      return tsFactory.createEnumDeclaration(
        modifiers as never,
        asName(name as string | Node) as Identifier,
        members as never,
      );
    },
    createEnumMember(name: unknown, initializer?: unknown) {
      return tsFactory.createEnumMember(asName(name as string | Node), initializer as never);
    },
    createFalse: () => tsFactory.createKeywordExpression(SyntaxKind.FalseKeyword),
    createIdentifier,
    createIndexedAccessTypeNode: tsFactory.createIndexedAccessTypeNode,
    createIndexSignature(modifiers: unknown, parameters: unknown, type: unknown) {
      return tsFactory.createIndexSignatureDeclaration(
        modifiers as never,
        parameters as never,
        type as never,
      );
    },
    createInterfaceDeclaration(
      modifiers: unknown,
      name: unknown,
      typeParameters: unknown,
      heritageClauses: unknown,
      members: unknown,
    ) {
      return tsFactory.createInterfaceDeclaration(
        modifiers as never,
        asName(name as string | Node) as Identifier,
        typeParameters as never,
        heritageClauses as never,
        members as never,
      );
    },
    createIntersectionTypeNode: tsFactory.createIntersectionTypeNode,
    createKeywordTypeNode: tsFactory.createKeywordTypeNode,
    createLiteralTypeNode: tsFactory.createLiteralTypeNode,
    createModifier: (kind: SyntaxKind) => tsFactory.createToken(kind as never) as never,
    createNodeArray: tsFactory.createNodeArray,
    createNull: () => tsFactory.createKeywordExpression(SyntaxKind.NullKeyword),
    createNumericLiteral(value: string | number) {
      return tsFactory.createNumericLiteral(String(value), TokenFlags.None);
    },
    createParameterDeclaration(
      modifiers: unknown,
      dotDotDotToken: unknown,
      name: unknown,
      questionToken?: unknown,
      type?: unknown,
      initializer?: unknown,
    ) {
      return tsFactory.createParameterDeclaration(
        modifiers as never,
        dotDotDotToken as never,
        asName(name as string | Node),
        questionToken as never,
        type as never,
        initializer as never,
      );
    },
    createPrefixUnaryExpression: tsFactory.createPrefixUnaryExpression,
    createPropertySignature,
    createRestTypeNode: tsFactory.createRestTypeNode,
    createStringLiteral(text: string) {
      return tsFactory.createStringLiteral(text, TokenFlags.None);
    },
    createToken: tsFactory.createToken,
    createTrue: () => tsFactory.createKeywordExpression(SyntaxKind.TrueKeyword),
    createTupleTypeNode: tsFactory.createTupleTypeNode,
    createTypeAliasDeclaration(
      modifiers: unknown,
      name: unknown,
      typeParameters: unknown,
      type: unknown,
    ) {
      return tsFactory.createTypeAliasDeclaration(
        modifiers as never,
        asName(name as string | Node) as Identifier,
        typeParameters as never,
        type as never,
      );
    },
    createTypeLiteralNode: tsFactory.createTypeLiteralNode,
    createTypeOperatorNode: tsFactory.createTypeOperatorNode,
    createTypeReferenceNode(name: string | Node, typeArguments?: readonly Node[]) {
      const typeName = typeof name === "string" ? createIdentifier(name) : name;

      return tsFactory.createTypeReferenceNode(
        typeName as Identifier,
        typeArguments?.length ? (typeArguments as never) : undefined,
      );
    },
    createUnionTypeNode: tsFactory.createUnionTypeNode,
    createVariableDeclaration(
      name: unknown,
      exclamationToken?: unknown,
      type?: unknown,
      initializer?: unknown,
    ) {
      return tsFactory.createVariableDeclaration(
        asName(name as string | Node),
        exclamationToken as never,
        type as never,
        initializer as never,
      );
    },
    createVariableDeclarationList: tsFactory.createVariableDeclarationList,
    createVariableStatement: tsFactory.createVariableStatement,
    updatePropertySignature(
      node: { initializer?: Node },
      modifiers: unknown,
      name: unknown,
      questionToken: unknown,
      type: unknown,
    ) {
      return aliasQuestionToken(
        tsFactory.updatePropertySignatureDeclaration(
          node as never,
          modifiers as never,
          asName(name as string | Node),
          questionToken as never,
          type as never,
          node.initializer as never,
        ),
      );
    },
  };
  export const visitEachChild: typeof astVisitEachChild = astVisitEachChild;
  export const visitNode: typeof astVisitNode = astVisitNode;
  export const addSyntheticLeadingComment = addLeadingComment;
  export const createPrinter = makePrinter;
  export const createSourceFile = parseSourceFile;
  export const isArrayTypeNode: typeof astIsArrayTypeNode = astIsArrayTypeNode;
  export const isIdentifier: typeof astIsIdentifier = astIsIdentifier;
  export const isIndexedAccessTypeNode: typeof astIsIndexedAccessTypeNode =
    astIsIndexedAccessTypeNode;
  export const isInterfaceDeclaration: typeof astIsInterfaceDeclaration = astIsInterfaceDeclaration;
  export const isLiteralTypeNode: typeof astIsLiteralTypeNode = astIsLiteralTypeNode;
  export const isStringLiteral: typeof astIsStringLiteral = astIsStringLiteral;
  export const isTupleTypeNode: typeof astIsTupleTypeNode = astIsTupleTypeNode;
  export const isTypeAliasDeclaration: typeof astIsTypeAliasDeclaration = astIsTypeAliasDeclaration;
  export const isTypeLiteralNode: typeof astIsTypeLiteralNode = astIsTypeLiteralNode;
  export const isTypeNode: typeof astIsTypeNode = astIsTypeNode;
  export const isTypeReferenceNode: typeof astIsTypeReferenceNode = astIsTypeReferenceNode;
  export const transform = transformNodes;
  export const isPropertySignature: typeof astIsPropertySignature = astIsPropertySignature;
}

export default ts;

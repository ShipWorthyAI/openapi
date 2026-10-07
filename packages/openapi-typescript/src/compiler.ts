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

declare module "typescript/unstable/ast" {
  interface Identifier {
    escapedText?: string;
  }
}

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

  return tsFactory.createTypeReferenceNode(createIdentifier(text.trim()));
}

function parseTemplateType(source: string): Node {
  const body = source.slice(1, -1);
  const pieces = body.split(/\$\{([^}]+)\}/);

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
      const statement = current.trim();

      if (statement) {
        parts.push(statement.endsWith(";") ? statement : `${statement};`);
      }

      current = "";
      continue;
    }

    current += character;
  }

  const tail = current.trim();

  if (tail) {
    parts.push(tail);
  }

  return parts;
}

function typeAliasFromStatement(statement: string): Node | undefined {
  const match = statement.match(/^(export\s+)?type\s+([A-Za-z0-9_$]+)([\s\S]*?)\s*=\s*([\s\S]+)$/);

  if (!match) {
    return undefined;
  }

  const exported = Boolean(match[1]);
  const name = match[2] ?? "";
  const parameters = (match[3] ?? "").trim();
  const typeText = (match[4] ?? "").trim().replace(/;$/, "");
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
  const trimmed = source.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return [
      {
        kind: SyntaxKind.ExpressionStatement,
        expression: parseTemplateType(trimmed),
      } as unknown as Node,
    ];
  }

  return splitStatements(trimmed).map((statement) => {
    const alias = typeAliasFromStatement(statement);

    if (alias) {
      return alias;
    }

    const node = tsFactory.createNotEmittedStatement();
    rawText.set(node, statement.endsWith(";") ? statement : `${statement};`);
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

  const pad = " ".repeat(indent);

  return comments
    .map((comment) => {
      if (comment.kind === SyntaxKind.SingleLineCommentTrivia) {
        return `${pad}//${comment.text}`;
      }

      return `${pad}/*${comment.text.replaceAll("\n", `\n${pad}`)}*/`;
    })
    .join("\n");
}

function printModifiers(modifiers: readonly { kind: SyntaxKind }[] | undefined): string {
  if (!modifiers?.length) {
    return "";
  }

  return `${modifiers
    .map((modifier) => KEYWORDS[modifier.kind])
    .filter(Boolean)
    .join(" ")} `;
}

function printName(name: Node | undefined): string {
  if (!name) {
    return "";
  }

  if (name.kind === SyntaxKind.Identifier || name.kind === SyntaxKind.NumericLiteral) {
    return (name as Identifier).text;
  }

  if (name.kind === SyntaxKind.StringLiteral) {
    return JSON.stringify((name as Identifier).text);
  }

  if (name.kind === SyntaxKind.ComputedPropertyName) {
    return `[${render((name as unknown as { expression: Node }).expression, 0)}]`;
  }

  return render(name, 0);
}

function render(node: Node | undefined, indent: number, removeComments = false): string {
  if (!node) {
    return "";
  }

  const raw = rawText.get(node);

  if (raw !== undefined) {
    return raw;
  }

  const comments = formatComments(node, indent, removeComments);
  const body = printBody(node, indent, removeComments);
  return comments ? `${comments}\n${body}` : body;
}

function printBody(node: Node, indent: number, removeComments: boolean): string {
  const keyword = KEYWORDS[node.kind];

  if (
    keyword &&
    node.kind !== SyntaxKind.ExportKeyword &&
    node.kind !== SyntaxKind.ReadonlyKeyword
  ) {
    return keyword;
  }

  const pad = " ".repeat(indent);
  const next = indent + 4;
  const record = node as unknown as Record<string, any>;

  switch (node.kind) {
    case SyntaxKind.InterfaceDeclaration:
      return `${pad}${printModifiers(record.modifiers)}interface ${printName(record.name)} {${printMembers(record.members, next, removeComments)}\n${pad}}`;
    case SyntaxKind.TypeAliasDeclaration:
      return `${pad}${printModifiers(record.modifiers)}type ${printName(record.name)}${typeParameterText.get(node) ?? ""} = ${render(record.type, indent, removeComments)};`;
    case SyntaxKind.EnumDeclaration: {
      const members = [...(record.members ?? [])] as Node[];
      const body = members.map((member) => render(member, next, removeComments)).join(",\n");
      return `${pad}${printModifiers(record.modifiers)}enum ${printName(record.name)} {\n${body}\n${pad}}`;
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
      return `${pad}${printModifiers(record.modifiers)}${printName(record.name)}${optional}: ${render(record.type, indent, removeComments)};`;
    }

    case SyntaxKind.TypeLiteral:
      if (!record.members?.length) {
        return "{}";
      }

      return `{${printMembers(record.members, next, removeComments)}\n${pad}}`;
    case SyntaxKind.UnionType:
      return record.types.map((type: Node) => render(type, indent, removeComments)).join(" | ");
    case SyntaxKind.IntersectionType:
      return record.types.map((type: Node) => render(type, indent, removeComments)).join(" & ");
    case SyntaxKind.TypeReference: {
      const argumentsText = record.typeArguments?.length
        ? `<${record.typeArguments.map((type: Node) => render(type, indent, removeComments)).join(", ")}>`
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
        return "[]";
      }

      const body = elements
        .map((element) => indentPrinted(render(element, next, removeComments), next))
        .join(",\n");

      return `[\n${body}\n${pad}]`;
    }

    case SyntaxKind.IndexedAccessType:
      return `${render(record.objectType, indent, removeComments)}[${render(record.indexType, 0, removeComments)}]`;
    case SyntaxKind.IndexSignature: {
      const parameter = record.parameters?.[0];
      return `${pad}${printModifiers(record.modifiers)}[${printName(parameter?.name)}: ${render(parameter?.type, 0, removeComments)}]: ${render(record.type, next, removeComments)};`;
    }

    case SyntaxKind.TypeOperator:
      return `${KEYWORDS[record.operator as SyntaxKind] ?? "keyof"} ${render(record.type, indent, removeComments)}`;
    case SyntaxKind.RestType:
      return `...${render(record.type, indent, removeComments)}`;
    case SyntaxKind.LiteralType:
      return render(record.literal, indent, removeComments);
    case SyntaxKind.StringLiteral:
      return JSON.stringify(record.text);
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

      const body = elements
        .map((element) => indentPrinted(render(element, next, removeComments), next))
        .join(",\n");

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
      const body = spans
        .map((span) => `\${${render(span.type, 0, removeComments)}}${span.literal?.text ?? ""}`)
        .join("");
      return `\`${record.head?.text ?? ""}${body}\``;
    }

    default:
      throw new Error(`Unable to print SyntaxKind ${node.kind}`);
  }
}

function indentPrinted(printed: string, indent: number): string {
  const pad = " ".repeat(indent);

  if (printed.startsWith(pad) || printed.includes("\n")) {
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

  return `\n${[...members].map((member) => render(member, indent, removeComments)).join("\n")}`;
}

function makePrinter(options: PrinterOptions = {}) {
  const removeComments = options.removeComments ?? false;

  return {
    printFile(sourceFile: { statements?: readonly Node[] }) {
      const text = (sourceFile.statements ?? [])
        .map((statement) => render(statement, 0, removeComments))
        .join("\n");
      return text.endsWith("\n") ? text : `${text}\n`;
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
  const list = Array.isArray(nodes) ? [...nodes] : [nodes as Node];
  let current = list;

  for (const transformer of transformers) {
    const visit = transformer({});
    current = current.map((node) => visit(node) ?? node);
  }

  return {
    transformed: Array.isArray(nodes) ? current : current[0],
    dispose() {},
  };
}

namespace ts {
  export type EnumDeclaration = import("typescript/unstable/ast").EnumDeclaration;
  export type EnumMember = import("typescript/unstable/ast").EnumMember;
  export type InterfaceDeclaration = import("typescript/unstable/ast").InterfaceDeclaration;
  export type LiteralTypeNode = import("typescript/unstable/ast").LiteralTypeNode;
  export type Node = import("typescript/unstable/ast").Node;
  export type PropertySignature = import("typescript/unstable/ast").PropertySignatureDeclaration;
  export type QuestionToken = import("typescript/unstable/ast").QuestionToken;
  export type TypeAliasDeclaration = import("typescript/unstable/ast").TypeAliasDeclaration;
  export type TypeElement = import("typescript/unstable/ast").TypeElement;
  export type TypeLiteralNode = import("typescript/unstable/ast").TypeLiteralNode;
  export type TypeNode = import("typescript/unstable/ast").TypeNode;
  export type Modifier = import("typescript/unstable/ast").ModifierLike;
  export type Visitor = (node: Node) => Node | undefined;
  export interface PrinterOptions {
    newLine?: number;
    removeComments?: boolean;
  }
  export const NodeFlags = ImportedNodeFlags;
  export const ScriptKind = ImportedScriptKind;
  export const ScriptTarget = ImportedScriptTarget;
  export const SyntaxKind = ImportedSyntaxKind;
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
  export const visitEachChild = visitEachChildNode;
  export const visitNode = visitNodeChild;
  export const addSyntheticLeadingComment = addLeadingComment;
  export const createPrinter = makePrinter;
  export const createSourceFile = parseSourceFile;
  export const isArrayTypeNode = importedIsArrayTypeNode;
  export const isIdentifier = importedIsIdentifier;
  export const isIndexedAccessTypeNode = importedIsIndexedAccessTypeNode;
  export const isInterfaceDeclaration = importedIsInterfaceDeclaration;
  export const isLiteralTypeNode = importedIsLiteralTypeNode;
  export const isStringLiteral = importedIsStringLiteral;
  export const isTupleTypeNode = importedIsTupleTypeNode;
  export const isTypeAliasDeclaration = importedIsTypeAliasDeclaration;
  export const isTypeLiteralNode = importedIsTypeLiteralNode;
  export const isTypeNode = importedIsTypeNode;
  export const isTypeReferenceNode = importedIsTypeReferenceNode;
  export const transform = transformNodes;
  export const isPropertySignature = isPropertySignatureDeclaration;
}

export default ts;

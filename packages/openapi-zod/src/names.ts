import { ZodGenerationError } from "./errors";

const reservedWords = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "implements",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Reject names that cannot be emitted as `export const` bindings. */
export function assertExportName(name: string, blocked: readonly string[]): void {
  if (
    !identifier.test(name) ||
    reservedWords.has(name) ||
    blocked.includes(name) ||
    name === "__proto__" ||
    name === "constructor" ||
    name === "prototype"
  ) {
    throw new ZodGenerationError({
      message: `${name}: Cannot emit this name as a schema export`,
    });
  }
}

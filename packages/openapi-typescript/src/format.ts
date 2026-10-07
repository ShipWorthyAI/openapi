import { format } from "oxfmt";

/** Format generated TypeScript the same way the committed examples are formatted. */
export async function formatTypeScript(source: string): Promise<string> {
  const result = await format("openapi.ts", source, { printWidth: 100 });
  const failure = result.errors.find((error) => error.severity === "Error");

  if (failure) throw new Error(failure.message);

  return result.code.endsWith("\n") ? result.code : `${result.code}\n`;
}

import type { OpenApiSchema } from "@shipworthy/openapi-parser";
import type { ParsedSchema } from "../../model/index.js";

/** JSON Schema keywords and references already have the parser's canonical representation. */
export function transformSchemaMap(
  value: Readonly<Record<string, OpenApiSchema>> | undefined,
): Readonly<Record<string, ParsedSchema>> {
  return value ?? {};
}

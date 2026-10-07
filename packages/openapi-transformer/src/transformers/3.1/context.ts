import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import type {
  ParsedSecurityRequirement,
  ParsedSecurityScheme,
  ParsedServer,
  ParsedTag,
} from "../../model/index.js";

/** Document-level values every operation inherits. */
export interface ParseContext {
  readonly document: OpenAPIDocument;
  readonly securitySchemes: Readonly<Record<string, ParsedSecurityScheme>>;
  readonly security: readonly ParsedSecurityRequirement[];
  readonly tags: readonly ParsedTag[];
  readonly servers: readonly ParsedServer[];
}

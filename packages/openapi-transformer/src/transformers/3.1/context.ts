import type { ParsedOpenApi } from "@shipworthy/openapi-parser/schemas/3.1";
import type {
  ParsedSecurityRequirement,
  ParsedSecurityScheme,
  ParsedServer,
  ParsedTag,
} from "../../model/index.js";

/** Document-level values every operation inherits. */
export interface TransformContext {
  readonly document: ParsedOpenApi;
  readonly securitySchemes: Readonly<Record<string, typeof ParsedSecurityScheme.Encoded>>;
  readonly security: readonly (typeof ParsedSecurityRequirement.Encoded)[];
  readonly tags: readonly (typeof ParsedTag.Encoded)[];
  readonly servers: readonly (typeof ParsedServer.Encoded)[];
}

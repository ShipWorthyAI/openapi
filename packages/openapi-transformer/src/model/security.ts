import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.js";
import { node, shareable } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";

export const ParsedOAuthFlow = Schema.Struct({
  authorizationUrl: optionalString,
  tokenUrl: optionalString,
  refreshUrl: optionalString,
  scopes: Schema.Record(Schema.String, Schema.String),
  extensions: ParsedExtensions,
});

export type ParsedOAuthFlow = typeof ParsedOAuthFlow.Type;

export const ParsedOAuthFlows = Schema.Struct({
  implicit: optionalField(ParsedOAuthFlow),
  password: optionalField(ParsedOAuthFlow),
  clientCredentials: optionalField(ParsedOAuthFlow),
  authorizationCode: optionalField(ParsedOAuthFlow),
  extensions: ParsedExtensions,
});

export type ParsedOAuthFlows = typeof ParsedOAuthFlows.Type;

const securityScheme = {
  ...node,
  ...shareable,
  /** The scheme's name in `components.securitySchemes`. */
  key: Schema.String,
  description: optionalString,
};

export const ParsedSecurityScheme = Schema.Union([
  Schema.Struct({
    ...securityScheme,
    type: Schema.Literal("apiKey"),
    name: Schema.String,
    in: Schema.Literals(["query", "header", "cookie"]),
  }),
  Schema.Struct({
    ...securityScheme,
    type: Schema.Literal("http"),
    scheme: Schema.String,
    bearerFormat: optionalString,
  }),
  Schema.Struct({ ...securityScheme, type: Schema.Literal("oauth2"), flows: ParsedOAuthFlows }),
  Schema.Struct({
    ...securityScheme,
    type: Schema.Literal("openIdConnect"),
    openIdConnectUrl: Schema.String,
  }),
  Schema.Struct({ ...securityScheme, type: Schema.Literal("mutualTLS") }),
]);

export type ParsedSecurityScheme = typeof ParsedSecurityScheme.Type;

/** One scheme in a security requirement, with the scopes the requirement asks for. */
export const ParsedSecurityUse = Schema.Struct({
  scheme: ParsedSecurityScheme,
  scopes: Schema.Array(Schema.String),
});

export type ParsedSecurityUse = typeof ParsedSecurityUse.Type;

/**
 * Schemes that must all be satisfied. An operation's `security` lists alternatives, so any one
 * requirement is enough. An empty requirement makes authentication optional.
 */
export const ParsedSecurityRequirement = Schema.Array(ParsedSecurityUse);

export type ParsedSecurityRequirement = typeof ParsedSecurityRequirement.Type;

export const SecurityDeclaration = Schema.Literals(["none", "declared", "inheritedFromService"]);

export type SecurityDeclaration = typeof SecurityDeclaration.Type;

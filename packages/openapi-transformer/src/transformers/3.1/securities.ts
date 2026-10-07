import { Option, Predicate, Schema } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { child, resolve } from "./pointer.js";
import { readEntries, readExtensions, readString } from "./read.js";
import {
  ParsedOAuthFlow,
  ParsedOAuthFlows,
  type ParsedSecurityRequirement,
  ParsedSecurityScheme,
  type ParsedSecurityUse,
} from "../../model/index.js";

function parseScopes(value: unknown) {
  return Object.fromEntries(
    readEntries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function parseOAuthFlow(value: unknown) {
  if (!Predicate.isObject(value)) return undefined;

  return Schema.decodeSync(ParsedOAuthFlow)({
    authorizationUrl: readString(value.authorizationUrl),
    tokenUrl: readString(value.tokenUrl),
    refreshUrl: readString(value.refreshUrl),
    scopes: parseScopes(value.scopes),
    extensions: readExtensions(value),
  });
}

function parseOAuthFlows(value: unknown) {
  const source = Predicate.isObject(value) ? value : {};

  return Schema.decodeSync(ParsedOAuthFlows)({
    implicit: parseOAuthFlow(source.implicit),
    password: parseOAuthFlow(source.password),
    clientCredentials: parseOAuthFlow(source.clientCredentials),
    authorizationCode: parseOAuthFlow(source.authorizationCode),
    extensions: readExtensions(source),
  });
}

const decodeScheme = Schema.decodeUnknownOption(ParsedSecurityScheme);

/** A security scheme, or `undefined` when its type or required fields are missing. */
export function parseSecurityScheme(
  document: OpenAPIDocument,
  key: string,
  value: unknown,
  at: string,
) {
  const { value: scheme, id, reference } = resolve(document, value, at);
  if (!Predicate.isObject(scheme)) return undefined;

  // the scheme's own fields decide which member of the union it is
  return decodeScheme({
    ...scheme,
    id,
    key,
    reference,
    description: readString(scheme.description),
    flows: scheme.type === "oauth2" ? parseOAuthFlows(scheme.flows) : undefined,
    extensions: readExtensions(scheme),
  }).pipe(Option.getOrUndefined);
}

export function parseSecuritySchemeMap(document: OpenAPIDocument, value: unknown, at: string) {
  return Object.fromEntries(
    readEntries(value).flatMap(([key, entry]) => {
      const scheme = parseSecurityScheme(document, key, entry, child(at, key));
      return scheme ? [[key, scheme] as const] : [];
    }),
  );
}

/** Security requirements. Schemes the document does not declare are left out. */
export function parseSecurityRequirements(
  value: unknown,
  schemes: Readonly<Record<string, ParsedSecurityScheme>>,
): readonly ParsedSecurityRequirement[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!Predicate.isObject(entry)) return [];
    const uses: ParsedSecurityUse[] = [];

    for (const [key, scopes] of Object.entries(entry)) {
      const scheme = schemes[key];
      if (!scheme || !Array.isArray(scopes)) continue;

      uses.push({
        scheme,
        scopes: scopes.filter((scope): scope is string => typeof scope === "string"),
      });
    }

    return [uses];
  });
}

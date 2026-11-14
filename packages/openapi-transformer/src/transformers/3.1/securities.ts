import {
  OpenApiSecurityScheme,
  type OpenApiComponents,
  type OpenApiOAuthFlow,
  type OpenApiOAuthFlows,
  type OpenApiReference,
  type OpenApiSecurityRequirement,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser/schemas/3.1";
import { Array, Effect, Record } from "effect";
import { child, resolve } from "./pointer.ts";
import { readExtensions } from "./extensions.ts";
import type {
  ParsedOAuthFlow,
  ParsedOAuthFlows,
  ParsedSecurityRequirement,
  ParsedSecurityScheme,
  ParsedSecurityUse,
} from "../../model/index.ts";

const transformOAuthFlow = (value: OpenApiOAuthFlow | undefined) =>
  Effect.sync(() => {
    if (value === undefined) return undefined;

    return {
      authorizationUrl: value.authorizationUrl,
      tokenUrl: value.tokenUrl,
      refreshUrl: value.refreshUrl,
      scopes: value.scopes,
      extensions: readExtensions(value),
    } satisfies typeof ParsedOAuthFlow.Encoded;
  });

const transformOAuthFlows = Effect.fnUntraced(function* (value: OpenApiOAuthFlows) {
  return {
    implicit: yield* transformOAuthFlow(value.implicit),
    password: yield* transformOAuthFlow(value.password),
    clientCredentials: yield* transformOAuthFlow(value.clientCredentials),
    authorizationCode: yield* transformOAuthFlow(value.authorizationCode),
    extensions: readExtensions(value),
  } satisfies typeof ParsedOAuthFlows.Encoded;
});

const transformSecurityScheme = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  key: string,
  value: OpenApiSecurityScheme | OpenApiReference,
  at: string,
) {
  const {
    value: scheme,
    id,
    reference,
  } = yield* resolve(document, OpenApiSecurityScheme, value, at);

  const common = {
    id,
    key,
    reference,
    description: reference?.description ?? scheme.description,
    extensions: readExtensions(scheme),
  };

  if (scheme.type === "oauth2") {
    return {
      ...common,
      type: scheme.type,
      flows: yield* transformOAuthFlows(scheme.flows),
    } satisfies typeof ParsedSecurityScheme.Encoded;
  }

  return { ...scheme, ...common } satisfies typeof ParsedSecurityScheme.Encoded;
});

export const transformSecuritySchemeMap = Effect.fnUntraced(function* (
  document: ParsedOpenApi,
  value: OpenApiComponents["securitySchemes"],
  at: string,
) {
  return Record.fromEntries(
    yield* Effect.forEach(
      Record.toEntries(value ?? {}),
      Effect.fnUntraced(function* ([key, entry]) {
        return [key, yield* transformSecurityScheme(document, key, entry, child(at, key))] as const;
      }),
    ),
  );
});

export const transformSecurityRequirements = (
  value: readonly OpenApiSecurityRequirement[] | undefined,
  schemes: Readonly<Record<string, typeof ParsedSecurityScheme.Encoded>>,
) =>
  Effect.sync(() => {
    return Array.map(value ?? [], (entry) => {
      const uses: (typeof ParsedSecurityUse.Encoded)[] = [];

      for (const [key, scopes] of Record.toEntries(entry)) {
        const scheme = schemes[key];
        if (scheme) uses.push({ scheme, scopes });
      }

      return uses;
    }) satisfies readonly (typeof ParsedSecurityRequirement.Encoded)[];
  });

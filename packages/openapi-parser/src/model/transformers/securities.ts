import { Predicate } from "effect";
import { extensionsOf, text } from "../read.js";
import type {
  ParsedOAuthFlow,
  ParsedOAuthFlows,
  ParsedSecurityRequirement,
  ParsedSecurityScheme,
} from "../types.js";

const flowNames = ["implicit", "password", "clientCredentials", "authorizationCode"] as const;

function scopesOf(value: unknown): Readonly<Record<string, string>> {
  if (!Predicate.isObject(value)) return {};
  const scopes: Record<string, string> = {};

  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry === "string") scopes[name] = entry;
  }

  return scopes;
}

function flowOf(value: unknown): ParsedOAuthFlow | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const authorizationUrl = text(value.authorizationUrl);
  const tokenUrl = text(value.tokenUrl);
  const refreshUrl = text(value.refreshUrl);

  return {
    ...(authorizationUrl !== undefined ? { authorizationUrl } : {}),
    ...(tokenUrl !== undefined ? { tokenUrl } : {}),
    ...(refreshUrl !== undefined ? { refreshUrl } : {}),
    scopes: scopesOf(value.scopes),
    extensions: extensionsOf(value),
  };
}

function flowsOf(value: unknown): ParsedOAuthFlows {
  const source = Predicate.isObject(value) ? value : {};
  const flows: ParsedOAuthFlows = { extensions: extensionsOf(source) };

  for (const name of flowNames) {
    const flow = flowOf(source[name]);
    if (flow) Object.assign(flows, { [name]: flow });
  }

  return flows;
}

function requirementOf(value: unknown): ParsedSecurityRequirement | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const requirement: Record<string, readonly string[]> = {};

  for (const [name, entry] of Object.entries(value)) {
    if (!Array.isArray(entry) || !entry.every((scope) => typeof scope === "string")) return undefined;
    requirement[name] = entry;
  }

  return requirement;
}

export function securityRequirements(value: unknown): readonly ParsedSecurityRequirement[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const requirement = requirementOf(entry);
    return requirement ? [requirement] : [];
  });
}

export function securitySchemeOf(value: unknown): ParsedSecurityScheme | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const description = text(value.description);
  const extensions = extensionsOf(value);
  const described = description !== undefined ? { description } : {};

  if (value.type === "apiKey") {
    const name = text(value.name);
    const location = value.in;
    if (name === undefined) return undefined;
    if (location !== "query" && location !== "header" && location !== "cookie") return undefined;

    return { type: "apiKey", name, in: location, ...described, extensions };
  }

  if (value.type === "http") {
    const scheme = text(value.scheme);
    if (scheme === undefined) return undefined;
    const bearerFormat = text(value.bearerFormat);

    return {
      type: "http",
      scheme,
      ...(bearerFormat !== undefined ? { bearerFormat } : {}),
      ...described,
      extensions,
    };
  }

  if (value.type === "oauth2") {
    return { type: "oauth2", flows: flowsOf(value.flows), ...described, extensions };
  }

  if (value.type === "openIdConnect") {
    const openIdConnectUrl = text(value.openIdConnectUrl);
    if (openIdConnectUrl === undefined) return undefined;

    return { type: "openIdConnect", openIdConnectUrl, ...described, extensions };
  }

  if (value.type === "mutualTLS") {
    return { type: "mutualTLS", ...described, extensions };
  }

  return undefined;
}

export function securitySchemeMap(value: unknown): Readonly<Record<string, ParsedSecurityScheme>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedSecurityScheme> = {};

  for (const [name, entry] of Object.entries(value)) {
    const scheme = securitySchemeOf(entry);
    if (scheme) record[name] = scheme;
  }

  return record;
}

import type {
  OpenApiExternalDocs,
  OpenApiServer,
  OpenApiServerVariable,
} from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import { child } from "./pointer.js";
import { readExtensions } from "./extensions.js";
import type { ParsedExternalDocs, ParsedServer, ParsedServerVariable } from "../../model/index.js";

export const transformExternalDocs = (value: OpenApiExternalDocs | undefined) =>
  Effect.sync(() => {
    if (value === undefined) return undefined;

    return {
      url: value.url,
      description: value.description,
      extensions: readExtensions(value),
    } satisfies typeof ParsedExternalDocs.Encoded;
  });

const transformServerVariable = (value: OpenApiServerVariable) =>
  Effect.sync(() => {
    return {
      default: value.default,
      enum: value.enum,
      description: value.description,
      extensions: readExtensions(value),
    } satisfies typeof ParsedServerVariable.Encoded;
  });

export const transformServer = Effect.fnUntraced(function* (value: OpenApiServer, at: string) {
  const variables = Object.fromEntries(
    yield* Effect.forEach(Object.entries(value.variables ?? {}), ([name, entry]) =>
      transformServerVariable(entry).pipe(Effect.map((variable) => [name, variable] as const)),
    ),
  );

  return {
    id: at,
    url: value.url,
    name: typeof value.name === "string" ? value.name : undefined,
    description: value.description,
    variables: value.variables === undefined ? undefined : variables,
    extensions: readExtensions(value),
  } satisfies typeof ParsedServer.Encoded;
});

/** Absence is preserved so operation and path-item inheritance remains explicit. */
export const transformServerList = Effect.fnUntraced(function* (
  value: readonly OpenApiServer[] | undefined,
  at: string,
) {
  if (value === undefined) return undefined;
  return yield* Effect.forEach(value, (entry, index) => transformServer(entry, child(at, index)));
});

import type { OpenApiContact, OpenApiLicense, OpenApiTag } from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import { transformExternalDocs } from "./servers.js";
import { child } from "./pointer.js";
import { readExtensions } from "./extensions.js";
import type { ParsedContact, ParsedLicense, ParsedTag } from "../../model/index.js";

export const transformContact = (value: OpenApiContact | undefined) =>
  Effect.sync(() => {
    if (value === undefined) return undefined;

    return {
      name: value.name,
      url: value.url,
      email: value.email,
      extensions: readExtensions(value),
    } satisfies typeof ParsedContact.Encoded;
  });

export const transformLicense = (value: OpenApiLicense | undefined) =>
  Effect.sync(() => {
    if (value === undefined) return undefined;

    return {
      name: value.name,
      url: value.url,
      identifier: value.identifier,
      extensions: readExtensions(value),
    } satisfies typeof ParsedLicense.Encoded;
  });

export const transformTagList = Effect.fnUntraced(function* (
  value: readonly OpenApiTag[] | undefined,
  at: string,
) {
  return yield* Effect.forEach(
    value ?? [],
    Effect.fnUntraced(function* (entry, index) {
      return {
        id: child(at, index),
        name: entry.name,
        description: entry.description,
        externalDocs: yield* transformExternalDocs(entry.externalDocs),
        extensions: readExtensions(entry),
      } satisfies typeof ParsedTag.Encoded;
    }),
  );
});

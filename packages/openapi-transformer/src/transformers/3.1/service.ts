import type {
  OpenApiContact,
  OpenApiLicense,
  OpenApiTag,
} from "@shipworthy/openapi-parser/schemas/3.1";
import { Effect } from "effect";
import { transformExternalDocs } from "./servers.ts";
import { child } from "./pointer.ts";
import { readExtensions } from "./extensions.ts";
import type { ParsedContact, ParsedLicense, ParsedTag } from "../../model/index.ts";

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

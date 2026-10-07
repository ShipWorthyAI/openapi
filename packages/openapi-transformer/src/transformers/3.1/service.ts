import { Predicate, Schema } from "effect";
import { parseExternalDocs } from "./servers.js";
import { child } from "./pointer.js";
import { readExtensions, readString } from "./read.js";
import { ParsedContact, ParsedLicense, ParsedTag } from "../../model/index.js";

export function parseContact(value: unknown) {
  if (!Predicate.isObject(value)) return undefined;

  return Schema.decodeSync(ParsedContact)({
    name: readString(value.name),
    url: readString(value.url),
    email: readString(value.email),
    extensions: readExtensions(value),
  });
}

export function parseLicense(value: unknown) {
  if (!Predicate.isObject(value)) return undefined;
  const name = readString(value.name);
  if (name === undefined) return undefined;

  return Schema.decodeSync(ParsedLicense)({
    name,
    url: readString(value.url),
    identifier: readString(value.identifier),
    extensions: readExtensions(value),
  });
}

export function parseTagList(value: unknown, at: string) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index) => {
    if (!Predicate.isObject(entry)) return [];
    const name = readString(entry.name);
    if (name === undefined) return [];

    return [
      Schema.decodeSync(ParsedTag)({
        id: child(at, index),
        name,
        description: readString(entry.description),
        externalDocs: parseExternalDocs(entry.externalDocs),
        extensions: readExtensions(entry),
      }),
    ];
  });
}
